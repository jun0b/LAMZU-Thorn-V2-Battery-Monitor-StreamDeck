/**
 * Stream Deck キーアクション実装
 */

import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { renderBatteryKey, svgToDataUrl } from "../render/ring-renderer.js";
import type { BatteryDisplayState, DisplayLayout } from "../render/types.js";

/**
 * キーごとの設定値（Property Inspector と同期）
 */
export interface BatteryKeySettings extends JsonObject {
	layout?: DisplayLayout;
	pollingIntervalSec?: number;
}

interface ActiveKeyEntry {
	action: KeyAction<BatteryKeySettings>;
	lastSvg: string | null;
	layout: DisplayLayout;
	pollingIntervalSec: number;
}

function normalizeLayout(raw: unknown): DisplayLayout {
	if (raw === "bar" || raw === "bar_dpi" || raw === "ring") {
		return raw;
	}
	return "ring";
}

function normalizePollingIntervalSec(raw: unknown): number {
	const num = Number(raw);
	if (!Number.isFinite(num) || num < 5) {
		return 30;
	}
	if (num > 3600) {
		return 3600;
	}
	return Math.round(num);
}

/**
 * バッテリー状態を表示する Stream Deck アクション
 */
@action({ UUID: "com.jun0b.thornv2-battery-monitor.battery-ring" })
export class BatteryRingAction extends SingletonAction<BatteryKeySettings> {
	private readonly activeKeys = new Map<string, ActiveKeyEntry>();

	private currentState: BatteryDisplayState = {
		receive_state: "INITIALIZING",
		battery: null,
	};

	private readonly queryDeviceFn?: () => void;
	private pollingTimer: NodeJS.Timeout | null = null;
	private currentPollingIntervalMs: number | null = null;

	constructor(options?: { queryDeviceFn?: () => void }) {
		super();
		this.queryDeviceFn = options?.queryDeviceFn;
	}

	override onWillAppear(ev: WillAppearEvent<BatteryKeySettings>): void | Promise<void> {
		if (ev.action.isKey()) {
			const actionId = ev.action.id;
			const settings = ev.payload?.settings ?? {};
			const layout = normalizeLayout(settings.layout);
			const pollingIntervalSec = normalizePollingIntervalSec(settings.pollingIntervalSec);

			const entry: ActiveKeyEntry = {
				action: ev.action,
				lastSvg: null,
				layout,
				pollingIntervalSec,
			};
			this.activeKeys.set(actionId, entry);
			streamDeck.logger.info(
				`[BatteryRingAction] onWillAppear: id=${actionId}, layout=${layout}, poll=${pollingIntervalSec}s, activeKeys=${this.activeKeys.size}`,
			);

			this.reconcilePollingSchedule(layout === "bar_dpi");
			return this.renderKey(actionId, entry);
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<BatteryKeySettings>): void | Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const actionId = ev.action.id;
		const settings = ev.payload?.settings ?? {};
		const newLayout = normalizeLayout(settings.layout);
		const newIntervalSec = normalizePollingIntervalSec(settings.pollingIntervalSec);

		let entry = this.activeKeys.get(actionId);
		const switchedToBarDpi = entry?.layout !== "bar_dpi" && newLayout === "bar_dpi";

		if (entry) {
			entry.layout = newLayout;
			entry.pollingIntervalSec = newIntervalSec;
		} else {
			entry = {
				action: ev.action,
				lastSvg: null,
				layout: newLayout,
				pollingIntervalSec: newIntervalSec,
			};
			this.activeKeys.set(actionId, entry);
		}

		streamDeck.logger.info(
			`[BatteryRingAction] onDidReceiveSettings: id=${actionId}, layout=${newLayout}, poll=${newIntervalSec}s`,
		);

		this.reconcilePollingSchedule(switchedToBarDpi);
		return this.renderKey(actionId, entry);
	}

	override onWillDisappear(ev: WillDisappearEvent<BatteryKeySettings>): void {
		this.activeKeys.delete(ev.action.id);
		this.reconcilePollingSchedule(false);
		streamDeck.logger.info(
			`[BatteryRingAction] onWillDisappear: id=${ev.action.id}, activeKeys=${this.activeKeys.size}`,
		);
	}

	/**
	 * bar_dpi キーの有無と設定間隔に合わせて DPI/Hz ポーリングタイマーを更新する
	 */
	private reconcilePollingSchedule(triggerImmediate: boolean): void {
		let minIntervalSec: number | null = null;
		for (const entry of this.activeKeys.values()) {
			if (entry.layout === "bar_dpi") {
				if (minIntervalSec === null || entry.pollingIntervalSec < minIntervalSec) {
					minIntervalSec = entry.pollingIntervalSec;
				}
			}
		}

		if (minIntervalSec === null) {
			if (this.pollingTimer) {
				clearInterval(this.pollingTimer);
				this.pollingTimer = null;
				this.currentPollingIntervalMs = null;
				streamDeck.logger.info("[BatteryRingAction] DPI/Hz ポーリングを停止しました");
			}
			return;
		}

		if (triggerImmediate && this.queryDeviceFn) {
			this.queryDeviceFn();
		}

		const targetMs = minIntervalSec * 1000;
		if (this.currentPollingIntervalMs !== targetMs || !this.pollingTimer) {
			if (this.pollingTimer) {
				clearInterval(this.pollingTimer);
			}
			this.currentPollingIntervalMs = targetMs;
			this.pollingTimer = setInterval(() => {
				if (this.queryDeviceFn && this.currentState.receive_state === "NORMAL") {
					this.queryDeviceFn();
				}
			}, targetMs);
			streamDeck.logger.info(`[BatteryRingAction] DPI/Hz ポーリングを開始/更新しました (${minIntervalSec}s)`);
		}
	}

	public stopPolling(): void {
		if (this.pollingTimer) {
			clearInterval(this.pollingTimer);
			this.pollingTimer = null;
			this.currentPollingIntervalMs = null;
		}
	}

	/**
	 * バッテリー状態を更新し、表示中の全キーへ描画を反映する
	 */
	public async updateState(state: BatteryDisplayState): Promise<void> {
		const prevReceiveState = this.currentState.receive_state;
		this.currentState = state;

		// NORMAL 遷移時に DPI 未取得の bar_dpi キーがあれば取得を要求する
		if (
			prevReceiveState !== "NORMAL" &&
			state.receive_state === "NORMAL" &&
			(state.dpi === null || state.dpi === undefined)
		) {
			for (const entry of this.activeKeys.values()) {
				if (entry.layout === "bar_dpi") {
					this.queryDeviceFn?.();
					break;
				}
			}
		}

		const updates: Promise<void>[] = [];

		for (const [actionId, entry] of this.activeKeys.entries()) {
			const svg = renderBatteryKey({
				...state,
				layout: entry.layout,
			});

			if (entry.lastSvg === svg) {
				continue;
			}

			entry.lastSvg = svg;
			const dataUrl = svgToDataUrl(svg);
			streamDeck.logger.info(
				`[BatteryRingAction] setImage: id=${actionId}, layout=${entry.layout}, state=${state.receive_state}, battery=${state.battery}, charging=${state.charging}, dpi=${state.dpi}, hz=${state.polling_rate}`,
			);
			updates.push(
				entry.action.setImage(dataUrl).catch((err: unknown) => {
					streamDeck.logger.error(`キー画像更新エラー (id: ${actionId}):`, err);
				}),
			);
		}

		if (updates.length > 0) {
			await Promise.all(updates);
		}
	}

	private async renderKey(actionId: string, entry: ActiveKeyEntry): Promise<void> {
		const svg = renderBatteryKey({
			...this.currentState,
			layout: entry.layout,
		});
		if (entry.lastSvg === svg) {
			return;
		}

		entry.lastSvg = svg;
		const dataUrl = svgToDataUrl(svg);
		try {
			await entry.action.setImage(dataUrl);
		} catch (err: unknown) {
			streamDeck.logger.error(`キー画像描画エラー (id: ${actionId}):`, err);
		}
	}

	public get activeKeyCount(): number {
		return this.activeKeys.size;
	}

	public getCurrentState(): BatteryDisplayState {
		return this.currentState;
	}

	public getLastSvg(actionId: string): string | null {
		return this.activeKeys.get(actionId)?.lastSvg ?? null;
	}
}
