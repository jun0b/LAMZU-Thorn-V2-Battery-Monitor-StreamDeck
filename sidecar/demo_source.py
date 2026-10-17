"""LAMZU Thorn V2 デモモード用シミュレーター

実機 HID デバイスなしで各表示状態を順番に遷移させる。
"""

import logging
import threading
import time
from typing import Optional

try:
    from sidecar.battery_state import BatteryState
    from sidecar.battery_protocol import ChargingState
except ImportError:
    from battery_state import BatteryState
    from battery_protocol import ChargingState

logger = logging.getLogger("demo_source")


class DemoSource:
    """デモ表示用の状態遷移ワーカー"""

    def __init__(self, state: BatteryState, step_interval: float = 2.0):
        self.state = state
        self.step_interval = step_interval
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="DemoSourceThread", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)

    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _wait_interval(self, seconds: float) -> bool:
        return not self._stop_event.wait(seconds)

    def _run_loop(self) -> None:
        logger.info("デモモードのサイクルを開始します")

        while not self._stop_event.is_set():
            # 1. データ受信待機 (WAITING_DATA)
            self.state.set_dongle_available(True)
            if not self._wait_interval(self.step_interval):
                break

            # 2. 高残量 (100% / 非充電)
            self.state.update_battery(100, status_code=0x00, state_value=0x58, charging_state=ChargingState.DISCHARGING)
            if not self._wait_interval(self.step_interval):
                break

            # 3. 満充電・充電完了 (100% / 充電完了)
            self.state.update_battery(100, status_code=0x02, state_value=0x58, charging_state=ChargingState.CHARGING_COMPLETE)
            if not self._wait_interval(self.step_interval):
                break

            # 4. 高残量・充電中 (90% / 充電中)
            self.state.update_battery(90, status_code=0x04, state_value=0x58, charging_state=ChargingState.CHARGING)
            if not self._wait_interval(self.step_interval):
                break

            # 4. 中残量 (45% / 非充電)
            self.state.update_battery(45, status_code=0x00, state_value=0x5A, charging_state=ChargingState.DISCHARGING)
            if not self._wait_interval(self.step_interval):
                break

            # 5. 低残量 (15% / 非充電)
            self.state.update_battery(15, status_code=0x00, state_value=0x5B, charging_state=ChargingState.DISCHARGING)
            if not self._wait_interval(self.step_interval):
                break

            # 6. 低残量・充電中 (15% / 充電中)
            self.state.update_battery(15, status_code=0x04, state_value=0x5B, charging_state=ChargingState.CHARGING)
            if not self._wait_interval(self.step_interval):
                break

            # 7. スリープ状態 (SLEEP_SUSPECTED)
            with self.state._lock:
                self.state.last_valid_battery_at = time.time() - 16.0
            self.state.check_staleness()
            if not self._wait_interval(self.step_interval):
                break

            # 8. スリープ復帰 (80% / 非充電)
            self.state.update_battery(80, status_code=0x00, state_value=0x5D, charging_state=ChargingState.DISCHARGING)
            if not self._wait_interval(self.step_interval):
                break

            # 9. ドングル未接続 (DONGLE_DISCONNECTED)
            self.state.set_dongle_available(False)
            if not self._wait_interval(self.step_interval):
                break

            # 10. ドングル再接続 (WAITING_DATA -> NORMAL)
            self.state.set_dongle_available(True)
            if not self._wait_interval(self.step_interval):
                break
            self.state.update_battery(80, status_code=0x00, state_value=0x5E, charging_state=ChargingState.DISCHARGING)
            if not self._wait_interval(self.step_interval):
                break


DemoWorker = DemoSource
