/**
 * Stream Deck プラグイン エントリポイント
 */

import streamDeck from "@elgato/streamdeck";
import { BatteryRingAction } from "./actions/battery-ring.js";
import { SidecarClient } from "./ipc/sidecar-client.js";
import type { StateMessage, SidecarClientState } from "./ipc/types.js";

streamDeck.logger.setLevel("info");

const sidecarClient = new SidecarClient({
	logger: streamDeck.logger,
});

const batteryRingAction = new BatteryRingAction({
	queryDeviceFn: () => {
		sidecarClient.sendCommand({ cmd: "query_device" });
	},
});
streamDeck.actions.registerAction(batteryRingAction);

// サイドカーからの状態通知をキー表示へ反映
sidecarClient.onStateChange((state: StateMessage) => {
	streamDeck.logger.info(
		`[Plugin] state 受信: receive_state=${state.receive_state}, battery=${state.battery}, charging=${state.charging}, dpi=${state.dpi ?? null}, hz=${state.polling_rate ?? null}`,
	);
	void batteryRingAction.updateState({
		receive_state: state.receive_state,
		battery: state.battery,
		charging: state.charging,
		dpi: state.dpi ?? null,
		polling_rate: state.polling_rate ?? null,
		ts: state.ts,
	});
});

// サイドカーの稼働状態変化を監視
sidecarClient.on("status", (status: SidecarClientState) => {
	streamDeck.logger.info(`[Plugin] sidecar status: ${status}`);
	if (status === "error" || status === "reconnecting") {
		void batteryRingAction.updateState({
			receive_state: "ERR",
			battery: null,
		});
	} else if (status === "starting") {
		void batteryRingAction.updateState({
			receive_state: "INITIALIZING",
			battery: null,
		});
	}
});

let isShuttingDown = false;

async function handleShutdown(): Promise<void> {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;
	batteryRingAction.stopPolling();
	streamDeck.logger.info("プラグイン終了処理を開始します...");

	try {
		await sidecarClient.stop();
		streamDeck.logger.info("サイドカープロセスを停止しました。");
	} catch (err: unknown) {
		streamDeck.logger.error("サイドカー停止処理エラー:", err);
	}
}

process.on("SIGTERM", () => {
	void handleShutdown().then(() => {
		process.exit(0);
	});
});

process.on("SIGINT", () => {
	void handleShutdown().then(() => {
		process.exit(0);
	});
});

sidecarClient.start();
streamDeck
	.connect()
	.then(() => {
		streamDeck.logger.info("[Plugin] Stream Deck に接続しました。");
	})
	.catch((err: unknown) => {
		streamDeck.logger.error("[Plugin] Stream Deck 接続エラー:", err);
		void handleShutdown();
	});

