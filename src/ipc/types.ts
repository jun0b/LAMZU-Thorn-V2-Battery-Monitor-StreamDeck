/**
 * サイドカー IPC 通信プロトコル型定義
 */

/** プロトコルバージョン */
export const IPC_PROTOCOL_VERSION = 1 as const;

/**
 * バッテリー受信ステータス
 */
export type BatteryReceiveState =
	| "INITIALIZING"
	| "WAITING_DATA"
	| "NORMAL"
	| "SLEEP_SUSPECTED"
	| "DONGLE_DISCONNECTED";

/**
 * 充電状態
 */
export type ChargingState = "UNKNOWN" | "DISCHARGING" | "CHARGING";

/**
 * 起動通知メッセージ (hello)
 */
export interface HelloMessage {
	v: typeof IPC_PROTOCOL_VERSION;
	type: "hello";
	pid: number;
	version: string;
	mode: "hid" | "demo" | string;
}

/**
 * 状態通知メッセージ (state)
 */
export interface StateMessage {
	v: typeof IPC_PROTOCOL_VERSION;
	type: "state";
	receive_state: BatteryReceiveState;
	battery: number | null;
	charging: ChargingState;
	dpi?: number | null;
	polling_rate?: number | null;
	ts: number;
}

/**
 * ハートビートメッセージ (heartbeat)
 */
export interface HeartbeatMessage {
	v: typeof IPC_PROTOCOL_VERSION;
	type: "heartbeat";
	ts: number;
}

export type SidecarInboundMessage = HelloMessage | StateMessage | HeartbeatMessage;

export interface GetStateCommand {
	cmd: "get_state";
}

export interface QueryDeviceCommand {
	cmd: "query_device";
}

export interface ShutdownCommand {
	cmd: "shutdown";
}

export type SidecarOutboundCommand = GetStateCommand | QueryDeviceCommand | ShutdownCommand;

/**
 * サイドカークライアントの動作状態
 */
export type SidecarClientState =
	| "stopped"
	| "starting"
	| "running"
	| "error"
	| "reconnecting"
	| "stopping";

export interface ILogger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
}

/**
 * サイドカークライアントの起動オプション
 */
export interface SidecarClientOptions {
	executablePath?: string;
	args?: string[];
	pythonPath?: string;
	cwd?: string;
	heartbeatTimeoutMs?: number;
	gracefulShutdownTimeoutMs?: number;
	minBackoffMs?: number;
	maxBackoffMs?: number;
	maxLineLength?: number;
	logger?: ILogger;
}
