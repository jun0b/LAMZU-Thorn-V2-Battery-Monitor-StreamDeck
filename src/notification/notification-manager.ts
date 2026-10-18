/**
 * 低バッテリー通知マネージャー
 */

import { sendWindowsToastNotification } from "./toast.js";
import type {
	BatteryStateInput,
	LowBatterySettings,
	NotificationEvaluationResult,
	ToastNotificationOptions,
	ToastSenderFn,
} from "./types.js";

/** 通知タイトル既定値 */
export const TOAST_TITLE = "LAMZU Thorn V2 - 低バッテリー警告";

/**
 * 通知本文をフォーマットする
 *
 * @param battery バッテリー残量 (%)
 * @returns 通知本文テキスト
 */
export function formatToastBody(battery: number): string {
	return `バッテリー残量が ${battery}% に低下しました。充電してください。`;
}

/**
 * 充電中または満充電状態かを判定する
 *
 * @param charging 充電ステータス
 * @param chargingComplete 充電完了フラグ
 * @returns 充電中の場合は true
 */
export function isChargingActive(charging: unknown, chargingComplete?: boolean): boolean {
	if (chargingComplete === true) {
		return true;
	}
	if (charging === true || charging === 1 || charging === "1") {
		return true;
	}
	if (typeof charging === "string") {
		const upper = charging.trim().toUpperCase();
		if (upper === "CHARGING" || upper === "CHARGING_COMPLETE") {
			return true;
		}
	}
	return false;
}

/**
 * 閾値設定値を正規化する (5〜50%, step 5, 既定値 20)
 *
 * @param raw 入力値
 * @returns 正規化された閾値
 */
export function normalizeLowBatteryThreshold(raw: unknown): number {
	if (raw === undefined || raw === null || raw === "") {
		return 20;
	}
	const num = Number(raw);
	if (!Number.isFinite(num)) {
		return 20;
	}
	if (num < 5) {
		return 5;
	}
	if (num > 50) {
		return 50;
	}
	const stepped = Math.round(num / 5) * 5;
	return Math.max(5, Math.min(50, stepped));
}

/**
 * 有効フラグを正規化する
 *
 * @param raw 入力値
 * @returns 真偽値
 */
export function normalizeLowBatteryEnabled(raw: unknown): boolean {
	return raw === true || raw === "true";
}

/**
 * 低バッテリー通知マネージャークラス
 */
export class LowBatteryNotificationManager {
	private static singletonInstance: LowBatteryNotificationManager | null = null;

	private hasNotified = false;
	private lastNotifiedBattery: number | null = null;
	private lastNotifiedThreshold: number | null = null;
	private readonly keySettingsMap = new Map<string, LowBatterySettings>();
	private toastSender: ToastSenderFn;

	/** ロガー */
	private logger?: {
		info?: (msg: string) => void;
		warn: (msg: string) => void;
		error?: (msg: string) => void;
	};

	constructor(
		toastSender?: ToastSenderFn,
		logger?: {
			info?: (msg: string) => void;
			warn: (msg: string) => void;
			error?: (msg: string) => void;
		},
	) {
		this.toastSender =
			toastSender ??
			((opts: ToastNotificationOptions) => sendWindowsToastNotification(opts, this.logger));
		this.logger = logger;
	}

	/**
	 * シングルトンインスタンスを取得する
	 */
	public static getInstance(
		toastSender?: ToastSenderFn,
		logger?: {
			info?: (msg: string) => void;
			warn: (msg: string) => void;
			error?: (msg: string) => void;
		},
	): LowBatteryNotificationManager {
		if (!LowBatteryNotificationManager.singletonInstance) {
			LowBatteryNotificationManager.singletonInstance = new LowBatteryNotificationManager(
				toastSender,
				logger,
			);
		}
		return LowBatteryNotificationManager.singletonInstance;
	}

	/**
	 * シングルトンインスタンスを破棄・リセットする（テスト用）
	 */
	public static resetInstance(): void {
		LowBatteryNotificationManager.singletonInstance = null;
	}

	/**
	 * 送信関数を差し替える（テスト用）
	 */
	public setToastSender(sender: ToastSenderFn): void {
		this.toastSender = sender;
	}

	/**
	 * ロガーを設定する
	 */
	public setLogger(logger?: {
		info?: (msg: string) => void;
		warn: (msg: string) => void;
		error?: (msg: string) => void;
	}): void {
		this.logger = logger;
	}

	/**
	 * キー設定を登録または更新する
	 *
	 * @param keyId キーの一意識別子
	 * @param settings 設定
	 */
	public updateKeySettings(keyId: string, settings?: LowBatterySettings): void {
		const enabled = normalizeLowBatteryEnabled(settings?.lowBatteryNotificationEnabled);
		const threshold = normalizeLowBatteryThreshold(settings?.lowBatteryThreshold);

		this.keySettingsMap.set(keyId, {
			lowBatteryNotificationEnabled: enabled,
			lowBatteryThreshold: threshold,
		});
	}

	/**
	 * キー登録を解除する（キーが画面から消えた際など）
	 *
	 * @param keyId キーの一意識別子
	 */
	public removeKey(keyId: string): void {
		this.keySettingsMap.delete(keyId);
	}

	/**
	 * 現在登録されている全キーから集約した有効設定を取得する
	 * - いずれか 1 つのキーでも有効であれば通知有効
	 * - 有効なキーの中で最も高い閾値を優先
	 */
	public getEffectiveSettings(): { enabled: boolean; threshold: number } {
		let enabled = false;
		let maxThreshold = 20;
		let hasEnabledKey = false;

		for (const s of this.keySettingsMap.values()) {
			if (s.lowBatteryNotificationEnabled) {
				enabled = true;
				const th = normalizeLowBatteryThreshold(s.lowBatteryThreshold);
				if (!hasEnabledKey || th > maxThreshold) {
					maxThreshold = th;
					hasEnabledKey = true;
				}
			}
		}

		return {
			enabled,
			threshold: maxThreshold,
		};
	}

	/**
	 * 現在の放電サイクルで通知済みかどうか
	 */
	public isNotified(): boolean {
		return this.hasNotified;
	}

	/**
	 * 前回通知を発行した際のバッテリー残量を取得する
	 */
	public getLastNotifiedBattery(): number | null {
		return this.lastNotifiedBattery;
	}

	/**
	 * 前回通知を発行した際の閾値を取得する
	 */
	public getLastNotifiedThreshold(): number | null {
		return this.lastNotifiedThreshold;
	}

	/**
	 * 放電サイクルフラグを明示的にリセットする
	 */
	public resetCycle(): void {
		this.hasNotified = false;
		this.lastNotifiedBattery = null;
		this.lastNotifiedThreshold = null;
	}

	/**
	 * 全状態を初期化する（キー登録・フラグ）
	 */
	public resetAll(): void {
		this.hasNotified = false;
		this.lastNotifiedBattery = null;
		this.lastNotifiedThreshold = null;
		this.keySettingsMap.clear();
	}

	/**
	 * バッテリー残量および充電状態を評価し、必要であれば通知を送信する
	 *
	 * @param state バッテリー状態入力
	 * @param overrideSettings 個別テスト等で使用するオーバーライド設定（省略時は集約設定を使用）
	 * @returns 判定結果
	 */
	public async processBatteryState(
		state?: BatteryStateInput | null,
		overrideSettings?: LowBatterySettings,
	): Promise<NotificationEvaluationResult> {
		const effective = overrideSettings
			? {
					enabled: normalizeLowBatteryEnabled(overrideSettings.lowBatteryNotificationEnabled),
					threshold: normalizeLowBatteryThreshold(overrideSettings.lowBatteryThreshold),
				}
			: this.getEffectiveSettings();

		const charging = isChargingActive(state?.charging, state?.charging_complete);

		// 充電中は通知フラグをリセット
		if (charging) {
			this.hasNotified = false;
			this.lastNotifiedBattery = null;
			this.lastNotifiedThreshold = null;
			return {
				shouldNotify: false,
				reason: "charging_active",
			};
		}

		// NORMAL 以外の状態ではスキップ
		if (
			state?.receive_state !== undefined &&
			state?.receive_state !== null &&
			state?.receive_state !== "NORMAL"
		) {
			return {
				shouldNotify: false,
				reason: "stale_or_inactive",
			};
		}

		// バッテリー値が無効な場合はスキップ
		if (
			!state ||
			state.battery === null ||
			state.battery === undefined ||
			typeof state.battery !== "number" ||
			!Number.isFinite(state.battery) ||
			state.battery < 0 ||
			state.battery > 100
		) {
			return {
				shouldNotify: false,
				reason: "invalid_battery",
			};
		}

		const currentBattery = Math.round(state.battery);

		// 閾値を上回ったら通知フラグをリセット
		if (currentBattery > effective.threshold) {
			this.hasNotified = false;
			this.lastNotifiedBattery = null;
			this.lastNotifiedThreshold = null;
			return {
				shouldNotify: false,
				reason: "battery_above_threshold",
				battery: currentBattery,
				threshold: effective.threshold,
			};
		}

		// 通知が無効な場合はスキップ
		if (!effective.enabled) {
			return {
				shouldNotify: false,
				reason: "disabled",
				battery: currentBattery,
				threshold: effective.threshold,
			};
		}

		// 通知済みの場合はスキップ
		if (this.hasNotified) {
			return {
				shouldNotify: false,
				reason: "already_notified",
				battery: currentBattery,
				threshold: effective.threshold,
			};
		}

		// 通知を送信
		this.hasNotified = true;
		this.lastNotifiedBattery = currentBattery;
		this.lastNotifiedThreshold = effective.threshold;
		const title = TOAST_TITLE;
		const body = formatToastBody(currentBattery);

		this.logger?.info?.(
			`[LowBatteryNotificationManager] 低バッテリー警告通知を発行: battery=${currentBattery}%, threshold=${effective.threshold}%`,
		);

		try {
			await Promise.resolve(
				this.toastSender({
					title,
					body,
				}),
			);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger?.warn?.(`[LowBatteryNotificationManager] トースト送信エラー: ${msg}`);
		}

		return {
			shouldNotify: true,
			reason: "notified",
			battery: currentBattery,
			threshold: effective.threshold,
		};
	}
}
