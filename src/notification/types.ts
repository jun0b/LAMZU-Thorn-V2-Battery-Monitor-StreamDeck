/**
 * 低バッテリー通知機能の型定義
 */

import type { ChargingState } from "../render/types.js";

/**
 * 低バッテリー通知設定（Property Inspector および各キーの設定値）
 */
export interface LowBatterySettings {
	/** 低バッテリー通知が有効かどうか */
	lowBatteryNotificationEnabled?: boolean;
	/** 通知閾値パーセント (5〜50, 規定値: 20) */
	lowBatteryThreshold?: number;
}

/**
 * 通知判定対象のバッテリー状態入力値
 */
export interface BatteryStateInput {
	/** バッテリー残量 (0〜100、または未取得時の null/undefined) */
	battery: number | null | undefined;
	/** 充電状態 ("CHARGING" | "CHARGING_COMPLETE" | "DISCHARGING" | "UNKNOWN" | boolean | number) */
	charging?: ChargingState | boolean | string | number | null;
	/** 充電完了フラグ（オプション） */
	charging_complete?: boolean;
	/** バッテリー受信ステータス ("NORMAL" | "SLEEP_SUSPECTED" | "DONGLE_DISCONNECTED" 等) */
	receive_state?: string | null;
}

/**
 * トースト通知の送信オプション
 */
export interface ToastNotificationOptions {
	/** 通知タイトル */
	title: string;
	/** 通知本文 */
	body: string;
	/** Windows アプリケーション AUMID（省略時は PowerShell 既定 AUMID） */
	appId?: string;
}

/**
 * トースト通知送信関数の型（テスト用 DI に対応）
 */
export type ToastSenderFn = (options: ToastNotificationOptions) => Promise<boolean> | boolean;

/**
 * 通知判定の実行結果
 */
export interface NotificationEvaluationResult {
	/** 通知を発行したかどうか */
	shouldNotify: boolean;
	/** 発行しなかった、または発行した理由 */
	reason:
		| "notified"
		| "disabled"
		| "charging_active"
		| "invalid_battery"
		| "battery_above_threshold"
		| "already_notified"
		| "stale_or_inactive";
	/** 判定に使用したバッテリー残量 */
	battery?: number;
	/** 判定に使用した閾値 */
	threshold?: number;
}
