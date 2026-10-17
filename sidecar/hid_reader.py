"""LAMZU Thorn V2 HID 受信リーダー

LAMZU 8K Dongle V2 から Input Report を読み取り、バッテリー状態を更新する。
"""

import logging
import threading
from typing import Optional

import hid

try:
    from sidecar.battery_protocol import parse_packet, PacketType
    from sidecar.battery_state import BatteryState
except ImportError:
    from battery_protocol import parse_packet, PacketType
    from battery_state import BatteryState

logger = logging.getLogger("hid_reader")

TARGET_VID = 0x37B0
TARGET_PID = 0x002E
TARGET_USAGE_PAGE = 0xFFA0
TARGET_USAGE = 0x0001


def find_target_device_path() -> Optional[bytes]:
    """Usage Page 0xFFA0 / Usage 0x0001 のインターフェースパスを検索する"""
    try:
        devices = hid.enumerate(TARGET_VID, TARGET_PID)
        for d in devices:
            if d.get("usage_page") == TARGET_USAGE_PAGE and d.get("usage") == TARGET_USAGE:
                return d.get("path")
    except Exception as e:
        logger.warning(f"HID デバイス列挙エラー: {e}")
    return None


class HidReader:
    """バックグラウンドで HID Input Report を受信するリーダークラス"""

    def __init__(self, state: BatteryState, read_timeout_ms: int = 500):
        self.state = state
        self.read_timeout_ms = read_timeout_ms
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._device: Optional[hid.device] = None
        self._device_lock = threading.Lock()

        self._initial_backoff: float = 2.0
        self._max_backoff: float = 30.0
        self._current_backoff: float = self._initial_backoff

        self.packets_received: int = 0
        self.format_a_count: int = 0
        self.format_b_count: int = 0

    def start(self) -> None:
        """受信スレッドを開始する"""
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="HidReaderThread", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        """受信スレッドを停止してデバイスを閉じる"""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        self._close_device()

    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _close_device(self) -> None:
        with self._device_lock:
            if self._device is not None:
                try:
                    self._device.close()
                except Exception:
                    pass
                self._device = None

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            with self._device_lock:
                dev = self._device

            if dev is None:
                path = find_target_device_path()
                if path:
                    try:
                        new_dev = hid.device()
                        new_dev.open_path(path)
                        with self._device_lock:
                            self._device = new_dev
                        self._current_backoff = self._initial_backoff
                        self.state.set_dongle_available(True)
                        logger.info("HID デバイスをオープンしました")
                    except Exception as e:
                        logger.warning(f"デバイスオープン失敗: {e}")
                        self._close_device()
                        self.state.set_dongle_available(False)
                else:
                    self.state.set_dongle_available(False)

                with self._device_lock:
                    is_opened = self._device is not None

                if not is_opened:
                    self._stop_event.wait(self._current_backoff)
                    self._current_backoff = min(self._max_backoff, self._current_backoff * 1.5)
                    continue

            try:
                with self._device_lock:
                    active_dev = self._device
                if active_dev is None:
                    continue

                raw_data = active_dev.read(64, timeout_ms=self.read_timeout_ms)

                if raw_data:
                    self.packets_received += 1
                    parsed = parse_packet(raw_data)

                    if parsed.packet_type == PacketType.FORMAT_A and parsed.is_valid_battery:
                        self.format_a_count += 1
                        if (
                            self.state.battery_percent != parsed.battery_level
                            or self.state.charging_state != parsed.charging_state
                        ):
                            logger.info(
                                f"バッテリー更新: {parsed.battery_level}% "
                                f"(status=0x{parsed.status_code:02X}, charging={parsed.charging_state.value})"
                            )
                        self.state.update_battery(
                            parsed.battery_level,
                            parsed.status_code,
                            parsed.state_value,
                            parsed.charging_state,
                        )
                    elif parsed.packet_type == PacketType.FORMAT_B:
                        self.format_b_count += 1
                        # 形式 B は残量を含まないため充電状態と受信時刻のみ更新する
                        self.state.update_non_battery_packet(charging_state=parsed.charging_state)
                else:
                    self.state.check_staleness()

            except Exception as e:
                logger.warning(f"HID 読み取りエラー: {e}")
                self._close_device()
                self.state.set_dongle_available(False)
                self._current_backoff = self._initial_backoff
                self._stop_event.wait(self._current_backoff)

        logger.info(
            f"HID 受信統計: total={self.packets_received}, "
            f"format_a={self.format_a_count}, format_b={self.format_b_count}"
        )
        self._close_device()


HidWorker = HidReader
