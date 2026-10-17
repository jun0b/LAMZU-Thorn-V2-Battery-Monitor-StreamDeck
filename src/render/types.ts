/**
 * バッテリー表示およびレンダラーの型定義
 */

/**
 * 受信ステータス
 */
export type ReceiveState =
  | "INITIALIZING"          // 初期化中
  | "WAITING_DATA"          // 初回パケット待機中
  | "NORMAL"                // 正常受信中
  | "SLEEP_SUSPECTED"       // スリープ状態（15秒以上受信なし）
  | "DONGLE_DISCONNECTED"   // ドングル未接続
  | "ERR";                  // サイドカー異常 / 再接続中

/**
 * 充電ステータス
 */
export type ChargingState =
  | "UNKNOWN"
  | "DISCHARGING"
  | "CHARGING"
  | "CHARGING_COMPLETE";

/**
 * キー表示レイアウト
 * - ring: 円形リング (Ring)
 * - bar: バッテリーアイコン (Icon)
 * - bar_dpi: バッテリーアイコン + DPI / Hz (Icon + DPI / Hz)
 */
export type DisplayLayout = "ring" | "bar" | "bar_dpi";

/**
 * バッテリー表示状態
 */
export interface BatteryDisplayState {
  receive_state: ReceiveState;
  battery: number | null;
  charging?: ChargingState | boolean;
  dpi?: number | null;
  polling_rate?: number | null;
  layout?: DisplayLayout;
  ts?: number;
}

/**
 * キャッシュ付きレンダラー
 */
export interface MemoizedRenderer {
  render(state: BatteryDisplayState): { svg: string; changed: boolean };
  renderDataUrl(state: BatteryDisplayState): { dataUrl: string; changed: boolean };
  getLastSvg(): string | null;
  reset(): void;
}
