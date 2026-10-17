/**
 * サイドカー IPC クライアント
 * Python HID サイドカープロセスとの stdio NDJSON 通信を管理する
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const currentDir: string = (() => {
	if (typeof __dirname !== "undefined") {
		return __dirname;
	}
	if (typeof import.meta !== "undefined" && import.meta.url) {
		try {
			return path.dirname(url.fileURLToPath(import.meta.url));
		} catch {
			// 無視して cwd にフォールバック
		}
	}
	return process.cwd();
})();

import {
	IPC_PROTOCOL_VERSION,
	type HelloMessage,
	type StateMessage,
	type HeartbeatMessage,
	type SidecarOutboundCommand,
	type SidecarClientState,
	type SidecarClientOptions,
	type ILogger,
} from "./types.js";

const defaultLogger: ILogger = {
	debug: (msg: string, ...args: unknown[]) => console.debug(`[SidecarClient:DEBUG] ${msg}`, ...args),
	info: (msg: string, ...args: unknown[]) => console.info(`[SidecarClient:INFO] ${msg}`, ...args),
	warn: (msg: string, ...args: unknown[]) => console.warn(`[SidecarClient:WARN] ${msg}`, ...args),
	error: (msg: string, ...args: unknown[]) => console.error(`[SidecarClient:ERROR] ${msg}`, ...args),
};

export interface SidecarClientInternalOptions extends SidecarClientOptions {
	spawnFn?: typeof spawn;
	existsSyncFn?: (path: fs.PathLike) => boolean;
}

export class SidecarClient extends EventEmitter {
	private child: ChildProcess | null = null;
	private status: SidecarClientState = "stopped";
	private lastState: StateMessage | null = null;
	private lastHello: HelloMessage | null = null;

	private stdoutBuffer = "";
	private stderrBuffer = "";

	private heartbeatTimer: NodeJS.Timeout | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private currentBackoffMs: number;

	private isExplicitStop = false;
	private shutdownPromise: Promise<void> | null = null;

	private readonly options: Required<Omit<SidecarClientOptions, "executablePath" | "args" | "pythonPath" | "cwd">> & {
		executablePath?: string;
		args: string[];
		pythonPath: string;
		cwd?: string;
	};
	private readonly logger: ILogger;
	private readonly spawnFn: typeof spawn;
	private readonly existsSyncFn: (path: fs.PathLike) => boolean;

	constructor(options: SidecarClientInternalOptions = {}) {
		super();
		this.logger = options.logger ?? defaultLogger;
		this.spawnFn = options.spawnFn ?? spawn;
		this.existsSyncFn = options.existsSyncFn ?? fs.existsSync;

		this.options = {
			executablePath: options.executablePath,
			args: options.args ?? [],
			pythonPath: options.pythonPath ?? (process.platform === "win32" ? "python" : "python3"),
			cwd: options.cwd,
			heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 15000,
			gracefulShutdownTimeoutMs: options.gracefulShutdownTimeoutMs ?? 2500,
			minBackoffMs: options.minBackoffMs ?? 1000,
			maxBackoffMs: options.maxBackoffMs ?? 30000,
			maxLineLength: options.maxLineLength ?? 65536,
			logger: this.logger,
		};

		this.currentBackoffMs = this.options.minBackoffMs;
	}

	public getStatus(): SidecarClientState {
		return this.status;
	}

	public getState(): StateMessage | null {
		return this.lastState;
	}

	public getHello(): HelloMessage | null {
		return this.lastHello;
	}

	public getPid(): number | undefined {
		return this.child?.pid;
	}

	public onStateChange(callback: (state: StateMessage) => void): () => void {
		this.on("state", callback);
		if (this.lastState) {
			try {
				callback(this.lastState);
			} catch (err) {
				this.logger.error("onStateChange コールバック実行エラー:", err);
			}
		}
		return () => {
			this.off("state", callback);
		};
	}

	/**
	 * サイドカーの実行ファイルパスと引数を解決する
	 */
	public resolveCommand(): { cmd: string; args: string[] } {
		let exe = this.options.executablePath;

		if (!exe) {
			const projectRoot = process.cwd();
			const candidateExePaths = [
				path.join(projectRoot, "bin", "sidecar", "thornv2-sidecar.exe"),
				path.join(projectRoot, "com.jun0b.thornv2-battery-monitor.sdPlugin", "bin", "sidecar", "thornv2-sidecar.exe"),
				path.join(currentDir, "..", "bin", "sidecar", "thornv2-sidecar.exe"),
				path.join(currentDir, "sidecar", "thornv2-sidecar.exe"),
			];

			if (this.options.cwd && this.options.cwd !== projectRoot) {
				candidateExePaths.unshift(
					path.join(this.options.cwd, "bin", "sidecar", "thornv2-sidecar.exe"),
					path.join(this.options.cwd, "com.jun0b.thornv2-battery-monitor.sdPlugin", "bin", "sidecar", "thornv2-sidecar.exe"),
				);
			}

			for (const cand of candidateExePaths) {
				if (this.existsSyncFn(cand)) {
					exe = cand;
					break;
				}
			}

			// EXE がない場合は Python スクリプトを探す
			if (!exe) {
				const pythonScriptCandidates = [
					path.join(projectRoot, "sidecar", "main.py"),
					path.join(currentDir, "..", "sidecar", "main.py"),
				];
				if (this.options.cwd && this.options.cwd !== projectRoot) {
					pythonScriptCandidates.unshift(path.join(this.options.cwd, "sidecar", "main.py"));
				}
				for (const pyCand of pythonScriptCandidates) {
					if (this.existsSyncFn(pyCand)) {
						exe = pyCand;
						break;
					}
				}
			}

			if (!exe) {
				exe = candidateExePaths[0];
			}
		}

		if (exe.endsWith(".py")) {
			return {
				cmd: this.options.pythonPath,
				args: [exe, ...this.options.args],
			};
		}

		return {
			cmd: exe,
			args: this.options.args,
		};
	}

	private setStatus(newStatus: SidecarClientState): void {
		if (this.status !== newStatus) {
			this.status = newStatus;
			this.emit("status", newStatus);
		}
	}

	/**
	 * サイドカープロセスを起動する
	 */
	public start(): void {
		if (this.status === "running" || this.status === "starting") {
			this.logger.warn("サイドカーは既に起動中です。");
			return;
		}

		this.isExplicitStop = false;
		this.shutdownPromise = null;
		this.clearReconnectTimer();
		this.setStatus("starting");

		const { cmd, args } = this.resolveCommand();
		this.logger.info(`サイドカーを起動します: ${cmd} ${args.join(" ")}`);

		try {
			const child = this.spawnFn(cmd, args, {
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
				cwd: this.options.cwd,
			});

			this.child = child;

			if (!child.pid) {
				throw new Error("子プロセスの生成に失敗しました（PID 未取得）");
			}

			child.stdout?.setEncoding("utf-8");
			child.stdout?.on("data", (chunk: string | Buffer) => {
				this.handleStdoutData(chunk.toString());
			});

			child.stderr?.setEncoding("utf-8");
			child.stderr?.on("data", (chunk: string | Buffer) => {
				this.handleStderrData(chunk.toString());
			});

			child.on("error", (err: Error) => {
				this.logger.error("サイドカープロセスエラー:", err);
				this.emit("error", err);
				this.handleProcessTermination();
			});

			child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
				this.logger.info(`サイドカープロセス終了 (code: ${code}, signal: ${signal})`);
				this.emit("exit", code, signal);
				this.handleProcessTermination();
			});

			this.resetHeartbeatTimer();
		} catch (err) {
			this.logger.error("サイドカーの起動に失敗しました:", err);
			this.setStatus("error");
			this.emit("error", err instanceof Error ? err : new Error(String(err)));
			this.scheduleReconnect();
		}
	}

	/**
	 * stdout の受信データを改行単位で切り出して処理する
	 */
	public handleStdoutData(chunk: string): void {
		this.stdoutBuffer += chunk;

		// 未完結のバッファが上限を超えた場合は破棄する
		if (Buffer.byteLength(this.stdoutBuffer, "utf-8") > this.options.maxLineLength) {
			const newlineIdx = this.stdoutBuffer.indexOf("\n");
			if (newlineIdx === -1) {
				this.logger.warn(
					`受信バッファが上限（${this.options.maxLineLength} バイト）を超えたため破棄します。`,
				);
				this.stdoutBuffer = "";
				return;
			}
		}

		let newlineIndex: number;
		while ((newlineIndex = this.stdoutBuffer.indexOf("\n")) !== -1) {
			const rawLine = this.stdoutBuffer.slice(0, newlineIndex);
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
			if (!line.trim()) {
				continue;
			}

			if (Buffer.byteLength(line, "utf-8") > this.options.maxLineLength) {
				this.logger.warn(`最大行長を超えた行を破棄しました（${Buffer.byteLength(line, "utf-8")} バイト）`);
				continue;
			}

			this.parseAndDispatchMessage(line);
		}
	}

	/**
	 * 1行の NDJSON メッセージをパースしてイベントを発火する
	 */
	private parseAndDispatchMessage(line: string): void {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch (err) {
			this.logger.warn(`JSON パース失敗のためスキップしました: ${line}`, err);
			return;
		}

		if (!message || typeof message !== "object") {
			this.logger.warn("オブジェクト以外のメッセージを無視しました:", message);
			return;
		}

		const msg = message as Record<string, unknown>;

		if (msg.v !== IPC_PROTOCOL_VERSION) {
			this.logger.warn(`未対応のプロトコルバージョンです (v: ${msg.v}):`, message);
			return;
		}

		const msgType = msg.type;
		if (typeof msgType !== "string") {
			this.logger.warn("type フィールドのないメッセージを無視しました:", message);
			return;
		}

		this.resetHeartbeatTimer();

		switch (msgType) {
			case "hello": {
				const helloMsg = msg as unknown as HelloMessage;
				this.lastHello = helloMsg;
				this.currentBackoffMs = this.options.minBackoffMs;
				this.setStatus("running");
				this.emit("hello", helloMsg);
				break;
			}
			case "state": {
				const stateMsg = msg as unknown as StateMessage;
				this.lastState = stateMsg;
				this.currentBackoffMs = this.options.minBackoffMs;
				if (this.status === "starting" || this.status === "reconnecting") {
					this.setStatus("running");
				}
				this.emit("state", stateMsg);
				break;
			}
			case "heartbeat": {
				const hbMsg = msg as unknown as HeartbeatMessage;
				this.emit("heartbeat", hbMsg);
				break;
			}
			default:
				this.logger.debug(`未知のメッセージタイプです (type: ${msgType}):`, message);
				break;
		}
	}

	/**
	 * stderr の出力を行単位でログに記録する
	 */
	public handleStderrData(chunk: string): void {
		this.stderrBuffer += chunk;
		let newlineIndex: number;
		while ((newlineIndex = this.stderrBuffer.indexOf("\n")) !== -1) {
			const rawLine = this.stderrBuffer.slice(0, newlineIndex);
			this.stderrBuffer = this.stderrBuffer.slice(newlineIndex + 1);
			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
			if (line.trim()) {
				this.logger.info(`[Sidecar:stderr] ${line}`);
			}
		}
	}

	private resetHeartbeatTimer(): void {
		this.clearHeartbeatTimer();

		if (this.isExplicitStop || this.status === "stopped" || this.status === "stopping") {
			return;
		}

		this.heartbeatTimer = setTimeout(() => {
			this.handleHeartbeatTimeout();
		}, this.options.heartbeatTimeoutMs);
	}

	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private handleHeartbeatTimeout(): void {
		this.logger.warn(
			`サイドカーのハートビートがタイムアウトしました（${this.options.heartbeatTimeoutMs}ms）。再起動します。`,
		);
		this.setStatus("error");

		if (this.child) {
			try {
				this.child.kill();
			} catch (e) {
				this.logger.error("プロセス終了エラー:", e);
			}
		}
	}

	private handleProcessTermination(): void {
		this.clearHeartbeatTimer();
		this.child = null;

		if (this.isExplicitStop) {
			this.setStatus("stopped");
			return;
		}

		this.setStatus("reconnecting");
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (this.isExplicitStop || this.reconnectTimer) {
			return;
		}

		const delay = this.currentBackoffMs;
		this.logger.info(`サイドカー再接続を ${delay}ms 後に試行します...`);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.isExplicitStop) {
				this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.options.maxBackoffMs);
				this.start();
			}
		}, delay);
	}

	/**
	 * サイドカーへ制御コマンドを送信する
	 */
	public sendCommand(cmd: SidecarOutboundCommand): boolean {
		if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
			this.logger.warn("コマンド送信失敗: stdin が利用できません。", cmd);
			return false;
		}

		try {
			const line = JSON.stringify(cmd) + "\n";
			return this.child.stdin.write(line, "utf-8");
		} catch (err) {
			this.logger.error("コマンド送信エラー:", err);
			return false;
		}
	}

	/**
	 * サイドカープロセスを停止する
	 */
	public async stop(): Promise<void> {
		if (this.shutdownPromise) {
			return this.shutdownPromise;
		}

		this.isExplicitStop = true;
		this.clearHeartbeatTimer();
		this.clearReconnectTimer();

		if (!this.child) {
			this.setStatus("stopped");
			return Promise.resolve();
		}

		this.setStatus("stopping");
		const currentChild = this.child;

		this.shutdownPromise = new Promise<void>((resolve) => {
			let isResolved = false;
			let forceKillTimer: NodeJS.Timeout | null = null;

			const onDone = () => {
				if (isResolved) return;
				isResolved = true;
				if (forceKillTimer) {
					clearTimeout(forceKillTimer);
					forceKillTimer = null;
				}
				this.child = null;
				this.setStatus("stopped");
				resolve();
			};

			currentChild.once("close", onDone);
			currentChild.once("exit", onDone);

			try {
				if (currentChild.stdin && currentChild.stdin.writable) {
					currentChild.stdin.end(JSON.stringify({ cmd: "shutdown" }) + "\n", "utf-8");
				}
			} catch (err) {
				this.logger.warn("shutdown コマンド送信エラー:", err);
			}

			forceKillTimer = setTimeout(() => {
				if (isResolved) return;
				this.logger.warn(
					`サイドカーが ${this.options.gracefulShutdownTimeoutMs}ms 以内に終了しなかったため kill します。`,
				);
				try {
					currentChild.kill();
				} catch (err) {
					this.logger.error("プロセス強制終了エラー:", err);
				}
				setTimeout(onDone, 500);
			}, this.options.gracefulShutdownTimeoutMs);
		});

		return this.shutdownPromise;
	}
}
