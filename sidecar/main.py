"""ThornV2 Battery Monitor — Python HID サイドカー

Stream Deck プラグインと stdio NDJSON (v1) で通信し、
LAMZU Thorn V2 のバッテリー情報・設定情報を中継する。
"""

import argparse
import json
import logging
import os
import signal
import sys
import threading
import time
from typing import Optional, List

_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:
    from sidecar.battery_state import BatteryState, ReceiveState
    from sidecar.battery_protocol import ChargingState
    from sidecar.hid_reader import HidReader
    from sidecar.demo_source import DemoSource
    from sidecar import device_query
except ImportError:
    from battery_state import BatteryState, ReceiveState
    from battery_protocol import ChargingState
    from hid_reader import HidReader
    from demo_source import DemoSource
    import device_query

# Windows 環境向けに標準ストリームを UTF-8 に設定
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
if sys.stdin and hasattr(sys.stdin, "reconfigure"):
    try:
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("sidecar")

VERSION = "0.1.0"
MAX_LINE_LENGTH = 65536
_stdout_lock = threading.Lock()


def emit_ndjson(payload: dict) -> None:
    """stdout へ NDJSON を1行書き出す"""
    line = json.dumps(payload, ensure_ascii=False) + "\n"
    with _stdout_lock:
        sys.stdout.write(line)
        sys.stdout.flush()


def trigger_device_query(state: BatteryState) -> None:
    """DPI・ポーリングレートを非同期取得して BatteryState に反映する"""
    if state.is_demo_mode:
        state.update_device_settings(dpi=800, polling_rate=1000)
        return

    def _on_result(res: dict) -> None:
        if res.get("success"):
            dpi = res.get("dpi")
            rate = res.get("polling_rate")
            logger.info(f"デバイス設定を取得しました: DPI={dpi}, PollingRate={rate}Hz")
            state.update_device_settings(dpi=dpi, polling_rate=rate)
        else:
            logger.debug(f"デバイス設定取得失敗: {res.get('error')}")

    device_query.query_device_settings_async(_on_result)


def run_stdin_monitor(
    shutdown_event: threading.Event,
    state: BatteryState,
    max_line_length: int = MAX_LINE_LENGTH,
) -> None:
    """stdin から制御コマンドを読み取り、EOF 検知時は終了イベントをセットする"""
    logger.info("stdin 監視スレッドを開始しました")
    try:
        while not shutdown_event.is_set():
            line = sys.stdin.readline()
            if line == "":
                logger.warning("stdin EOF を検知しました。シャットダウンを開始します。")
                shutdown_event.set()
                break

            if len(line.encode("utf-8", errors="replace")) > max_line_length:
                logger.error(f"最大行長を超えた入力を破棄しました (文字数: {len(line)})")
                continue

            line_str = line.strip()
            if not line_str:
                continue

            try:
                data = json.loads(line_str)
            except json.JSONDecodeError as e:
                logger.warning(f"JSON パースエラー: {e}")
                continue

            if not isinstance(data, dict):
                logger.warning("オブジェクト以外の JSON を無視しました")
                continue

            cmd = data.get("cmd")
            if cmd == "shutdown":
                logger.info("shutdown コマンドを受信しました")
                shutdown_event.set()
                break
            elif cmd == "get_state":
                emit_ndjson(state.to_dict())
            elif cmd == "query_device":
                trigger_device_query(state)
            else:
                logger.warning(f"未知のコマンドです: {cmd}")
    except Exception as e:
        logger.error(f"stdin 監視スレッド例外: {e}")
        shutdown_event.set()
    logger.info("stdin 監視スレッドを終了しました")


def run_heartbeat_loop(
    shutdown_event: threading.Event,
    interval: float = 5.0,
) -> None:
    """一定間隔で heartbeat メッセージを送信する"""
    logger.info("ハートビートスレッドを開始しました")
    while not shutdown_event.is_set():
        if shutdown_event.wait(interval):
            break
        heartbeat = {
            "v": 1,
            "type": "heartbeat",
            "ts": round(time.time(), 3),
        }
        try:
            emit_ndjson(heartbeat)
        except Exception as e:
            logger.warning(f"ハートビート送信失敗: {e}")
    logger.info("ハートビートスレッドを終了しました")


def perform_graceful_shutdown(
    worker,
    shutdown_event: threading.Event,
    exit_code: int = 0,
    enable_watchdog: bool = True,
) -> None:
    """ワーカーを停止してプロセスを終了する"""
    logger.info("シャットダウン処理を開始します")

    watchdog_cancel = threading.Event()

    if enable_watchdog:
        def force_exit():
            if not watchdog_cancel.wait(2.5):
                logger.critical("シャットダウンがタイムアウトしたため強制終了します")
                try:
                    sys.stderr.flush()
                except Exception:
                    pass
                os._exit(1)

        watchdog = threading.Thread(target=force_exit, name="ShutdownWatchdogThread", daemon=True)
        watchdog.start()

    shutdown_event.set()

    if worker is not None:
        try:
            worker.stop(timeout=2.0)
        except Exception as e:
            logger.warning(f"ワーカー停止エラー: {e}")

    try:
        sys.stderr.flush()
    except Exception:
        pass

    logger.info(f"シャットダウン完了 (exit_code={exit_code})")
    watchdog_cancel.set()
    sys.exit(exit_code)


def main(argv: Optional[List[str]] = None) -> int:
    """エントリーポイント"""
    parser = argparse.ArgumentParser(description="ThornV2 Battery Monitor HID Sidecar")
    parser.add_argument("--demo", action="store_true", help="デモモードで起動")
    parser.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    args = parser.parse_args(argv)

    mode = "demo" if args.demo else "hid"
    logger.info(f"サイドカー起動 (mode={mode}, pid={os.getpid()}, version={VERSION})")

    shutdown_event = threading.Event()
    state = BatteryState(is_demo_mode=args.demo)

    def on_state_changed(s: BatteryState) -> None:
        try:
            emit_ndjson(s.to_dict())
        except Exception as e:
            logger.warning(f"状態通知送信エラー: {e}")

    state.add_listener(on_state_changed)

    hello_packet = {
        "v": 1,
        "type": "hello",
        "pid": os.getpid(),
        "version": VERSION,
        "mode": mode,
    }
    emit_ndjson(hello_packet)
    emit_ndjson(state.to_dict())

    if args.demo:
        worker = DemoSource(state, step_interval=2.0)
    else:
        worker = HidReader(state, read_timeout_ms=500)
    worker.start()

    stdin_thread = threading.Thread(
        target=run_stdin_monitor,
        args=(shutdown_event, state),
        name="StdinMonitorThread",
        daemon=True,
    )
    stdin_thread.start()

    def handle_signal(sig, frame):
        logger.info(f"シグナル受信 ({sig})")
        shutdown_event.set()

    try:
        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)
    except Exception:
        pass

    hb_thread = threading.Thread(
        target=run_heartbeat_loop,
        args=(shutdown_event, 5.0),
        name="HeartbeatThread",
        daemon=True,
    )
    hb_thread.start()

    try:
        while not shutdown_event.is_set():
            shutdown_event.wait(0.5)
    except KeyboardInterrupt:
        shutdown_event.set()

    perform_graceful_shutdown(worker, shutdown_event, exit_code=0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
