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
export const TOAST_TITLE = "LAMZU Thorn V2 - Low Battery Warning";

/**
 * 通知本文をフォーマットする
 *
 * @param battery バッテリー残量 (%)
 * @returns 通知本文テキスト
 */
export function formatToastBody(battery: number): string {
	return `Battery level has dropped to ${battery}%. Please connect the charger.`;
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
 * 既定値 true のブール値を正規化する
 *
 * @param raw 入力値
 * @param defaultValue 既定値
 * @returns 真偽値
 */
export function normalizeBooleanOption(raw: unknown, defaultValue = true): boolean {
	if (raw === undefined || raw === null || raw === "") {
		return defaultValue;
	}
	return raw === true || raw === "true";
}

/**
 * 低バッテリー通知マネージャークラス
 */
export class LowBatteryNotificationManager {
	private static singletonInstance: LowBatteryNotificationManager | null = null;

	private hasNotified = false;
	private hasNotifiedCritical = false;
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
		const sound = normalizeBooleanOption(settings?.lowBatterySoundEnabled, true);
		const reminder = normalizeBooleanOption(settings?.lowBatteryReminderMode, true);
		const critical = normalizeBooleanOption(settings?.criticalBatteryAlertEnabled, true);

		this.keySettingsMap.set(keyId, {
			lowBatteryNotificationEnabled: enabled,
			lowBatteryThreshold: threshold,
			lowBatterySoundEnabled: sound,
			lowBatteryReminderMode: reminder,
			criticalBatteryAlertEnabled: critical,
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
	 */
	public getEffectiveSettings(): {
		enabled: boolean;
		threshold: number;
		soundEnabled: boolean;
		reminderMode: boolean;
		criticalAlertEnabled: boolean;
	} {
		let enabled = false;
		let maxThreshold = 20;
		let soundEnabled = true;
		let reminderMode = true;
		let criticalAlertEnabled = true;
		let hasEnabledKey = false;

		for (const s of this.keySettingsMap.values()) {
			if (s.lowBatteryNotificationEnabled) {
				enabled = true;
				const th = normalizeLowBatteryThreshold(s.lowBatteryThreshold);
				if (!hasEnabledKey || th > maxThreshold) {
					maxThreshold = th;
					hasEnabledKey = true;
				}
				soundEnabled = normalizeBooleanOption(s.lowBatterySoundEnabled, true);
				reminderMode = normalizeBooleanOption(s.lowBatteryReminderMode, true);
				criticalAlertEnabled = normalizeBooleanOption(s.criticalBatteryAlertEnabled, true);
			}
		}

		return {
			enabled,
			threshold: maxThreshold,
			soundEnabled,
			reminderMode,
			criticalAlertEnabled,
		};
	}

	/**
	 * 現在の放電サイクルで通知済みかどうか
	 */
	public isNotified(): boolean {
		return this.hasNotified;
	}

	/**
	 * 5%以下緊急通知済みかどうか
	 */
	public isCriticalNotified(): boolean {
		return this.hasNotifiedCritical;
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
		this.hasNotifiedCritical = false;
		this.lastNotifiedBattery = null;
		this.lastNotifiedThreshold = null;
	}

	/**
	 * 全状態を初期化する（キー登録・フラグ）
	 */
	public resetAll(): void {
		this.hasNotified = false;
		this.hasNotifiedCritical = false;
		this.lastNotifiedBattery = null;
		this.lastNotifiedThreshold = null;
		this.keySettingsMap.clear();
	}

	private lastTestNotificationTime = 0;

	/**
	 * テスト通知を即座に送信する
	 */
	public async sendTestNotification(overrideSettings?: LowBatterySettings): Promise<boolean> {
		const now = Date.now();
		if (now - this.lastTestNotificationTime < 1000) {
			return true;
		}
		this.lastTestNotificationTime = now;

		const effective = overrideSettings
			? {
					soundEnabled: normalizeBooleanOption(overrideSettings.lowBatterySoundEnabled, true),
					reminderMode: normalizeBooleanOption(overrideSettings.lowBatteryReminderMode, true),
				}
			: this.getEffectiveSettings();

		const title = "LAMZU Thorn V2 - Notification Test";
		const body = "Test notification. Sound and display alerts are functioning properly.";

		this.logger?.info?.("[LowBatteryNotificationManager] テスト通知を発行します");
		try {
			await Promise.resolve(
				this.toastSender({
					title,
					body,
					sound: effective.soundEnabled,
					reminder: effective.reminderMode,
				}),
			);
			return true;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger?.warn?.(`[LowBatteryNotificationManager] テスト通知送信エラー: ${msg}`);
			return false;
		}
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
					soundEnabled: normalizeBooleanOption(overrideSettings.lowBatterySoundEnabled, true),
					reminderMode: normalizeBooleanOption(overrideSettings.lowBatteryReminderMode, true),
					criticalAlertEnabled: normalizeBooleanOption(overrideSettings.criticalBatteryAlertEnabled, true),
				}
			: this.getEffectiveSettings();

		const charging = isChargingActive(state?.charging, state?.charging_complete);

		// 充電中は通知フラグをリセット
		if (charging) {
			this.hasNotified = false;
			this.hasNotifiedCritical = false;
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
		}

		// 5% を上回ったら緊急通知フラグをリセット
		if (currentBattery > 5) {
			this.hasNotifiedCritical = false;
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

		// 緊急再通知判定 (5% 以下)
		const isCriticalTrigger =
			effective.criticalAlertEnabled && currentBattery <= 5 && !this.hasNotifiedCritical;

		// 閾値超過かつ緊急通知対象外ならスキップ
		if (currentBattery > effective.threshold && !isCriticalTrigger) {
			return {
				shouldNotify: false,
				reason: "battery_above_threshold",
				battery: currentBattery,
				threshold: effective.threshold,
			};
		}

		// 通常通知済みで緊急通知対象でもない場合は重複スキップ
		if (this.hasNotified && !isCriticalTrigger) {
			return {
				shouldNotify: false,
				reason: "already_notified",
				battery: currentBattery,
				threshold: effective.threshold,
			};
		}

		// 通知内容の決定
		let title = TOAST_TITLE;
		let body = formatToastBody(currentBattery);
		if (isCriticalTrigger && this.hasNotified) {
			title = "LAMZU Thorn V2 - Critical Battery Alert";
			body = `Battery is critically low at ${currentBattery}%. Please recharge immediately.`;
		}

		this.hasNotified = true;
		if (currentBattery <= 5) {
			this.hasNotifiedCritical = true;
		}
		this.lastNotifiedBattery = currentBattery;
		this.lastNotifiedThreshold = effective.threshold;

		this.logger?.info?.(
			`[LowBatteryNotificationManager] 低バッテリー警告通知を発行: battery=${currentBattery}%, threshold=${effective.threshold}%, critical=${isCriticalTrigger}`,
		);

		try {
			await Promise.resolve(
				this.toastSender({
					title,
					body,
					sound: effective.soundEnabled,
					reminder: effective.reminderMode,
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
