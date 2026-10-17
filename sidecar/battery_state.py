"""LAMZU Thorn V2 バッテリー状態管理モジュール"""

import threading
import time
from datetime import datetime
from enum import Enum
from typing import Optional, Callable, List

try:
    from sidecar.battery_protocol import ChargingState
except ImportError:
    from battery_protocol import ChargingState


class ReceiveState(Enum):
    """通信・受信ステータス"""
    INITIALIZING = "INITIALIZING"
    WAITING_DATA = "WAITING_DATA"
    NORMAL = "NORMAL"
    SLEEP_SUSPECTED = "SLEEP_SUSPECTED"
    DONGLE_DISCONNECTED = "DONGLE_DISCONNECTED"


class BatteryState:
    """バッテリー残量と通信状態を管理するクラス"""

    STALE_THRESHOLD_SECONDS: float = 15.0

    def __init__(self, is_demo_mode: bool = False):
        self._lock = threading.Lock()
        self.is_demo_mode = is_demo_mode

        self.battery_percent: Optional[int] = None
        self.last_received_at: Optional[float] = None
        self.last_valid_battery_at: Optional[float] = None
        self.raw_status_code: Optional[int] = None
        self.state_value: Optional[int] = None
        self.charging_state: ChargingState = ChargingState.UNKNOWN
        self.dongle_available: bool = False
        self.receive_state: ReceiveState = ReceiveState.INITIALIZING
        self.dpi: Optional[int] = None
        self.polling_rate: Optional[int] = None

        self._listeners: List[Callable[["BatteryState"], None]] = []

    @property
    def percent(self) -> Optional[int]:
        """現在の有効なバッテリー残量"""
        with self._lock:
            if not self.dongle_available or self.receive_state in (
                ReceiveState.INITIALIZING,
                ReceiveState.WAITING_DATA,
                ReceiveState.DONGLE_DISCONNECTED,
            ):
                return None
            return self.battery_percent

    @property
    def display_percent(self) -> Optional[int]:
        return self.percent

    @property
    def is_stale(self) -> bool:
        with self._lock:
            return self.receive_state == ReceiveState.SLEEP_SUSPECTED

    @property
    def is_disconnected(self) -> bool:
        with self._lock:
            return not self.dongle_available or self.receive_state == ReceiveState.DONGLE_DISCONNECTED

    @property
    def is_charging(self) -> bool:
        with self._lock:
            if not self.dongle_available or self.receive_state != ReceiveState.NORMAL:
                return False
            return self.charging_state == ChargingState.CHARGING

    @property
    def is_charging_complete(self) -> bool:
        """充電完了かどうか (正常受信中かつ CHARGING_COMPLETE の場合のみ True)"""
        with self._lock:
            if not self.dongle_available or self.receive_state != ReceiveState.NORMAL:
                return False
            return self.charging_state == ChargingState.CHARGING_COMPLETE

    def add_listener(self, listener: Callable[["BatteryState"], None]) -> None:
        with self._lock:
            self._listeners.append(listener)

    def _notify_listeners(self) -> None:
        with self._lock:
            listeners_copy = list(self._listeners)
        for listener in listeners_copy:
            try:
                listener(self)
            except Exception:
                pass

    def update_battery(
        self,
        percent: int,
        status_code: Optional[int] = None,
        state_value: Optional[int] = None,
        charging_state: ChargingState = ChargingState.UNKNOWN,
    ) -> None:
        """有効なパケット受信時にバッテリー残量と充電状態を更新する"""
        now = time.time()
        changed = False
        with self._lock:
            if not (0 <= percent <= 100):
                return

            if (
                self.battery_percent != percent
                or self.charging_state != charging_state
                or self.receive_state != ReceiveState.NORMAL
                or not self.dongle_available
            ):
                changed = True

            self.battery_percent = percent
            self.last_received_at = now
            self.last_valid_battery_at = now
            self.raw_status_code = status_code
            self.state_value = state_value
            self.charging_state = charging_state
            self.dongle_available = True
            self.receive_state = ReceiveState.NORMAL

        if changed:
            self._notify_listeners()

    def update_device_settings(
        self,
        dpi: Optional[int] = None,
        polling_rate: Optional[int] = None,
    ) -> None:
        """DPI とポーリングレートを更新する"""
        changed = False
        with self._lock:
            if dpi is not None and self.dpi != dpi:
                self.dpi = dpi
                changed = True
            if polling_rate is not None and self.polling_rate != polling_rate:
                self.polling_rate = polling_rate
                changed = True

        if changed:
            self._notify_listeners()

    def update_non_battery_packet(self, charging_state: ChargingState = ChargingState.UNKNOWN) -> None:
        """形式 B パケット受信時に充電状態と受信時刻を更新する（残量は変更しない）"""
        now = time.time()
        changed = False
        with self._lock:
            self.last_received_at = now
            self.dongle_available = True

            if self.receive_state == ReceiveState.NORMAL:
                # 形式Bは2値(CHARGING / DISCHARGING)のみのため、既にCHARGING_COMPLETEの場合は
                # 形式BのCHARGINGで上書きしてチラつくのを防ぐ（DISCHARGINGへの遷移は反映する）
                if (
                    self.charging_state == ChargingState.CHARGING_COMPLETE
                    and charging_state == ChargingState.CHARGING
                ):
                    pass
                elif (
                    charging_state != ChargingState.UNKNOWN
                    and self.charging_state != charging_state
                ):
                    self.charging_state = charging_state
                    changed = True

        if changed:
            self._notify_listeners()

    def set_dongle_available(self, available: bool) -> None:
        """ドングルの接続状態を設定する"""
        changed = False
        with self._lock:
            if self.dongle_available != available:
                changed = True
                self.dongle_available = available
                if not available:
                    self.receive_state = ReceiveState.DONGLE_DISCONNECTED
                    self.charging_state = ChargingState.UNKNOWN
                    self.dpi = None
                    self.polling_rate = None
                else:
                    self.receive_state = ReceiveState.WAITING_DATA
                    self.charging_state = ChargingState.UNKNOWN

        if changed:
            self._notify_listeners()

    def check_staleness(self) -> bool:
        """15秒以上有効パケットがない場合に SLEEP_SUSPECTED へ遷移させる"""
        changed = False
        now = time.time()
        with self._lock:
            if self.dongle_available and self.receive_state == ReceiveState.NORMAL:
                if self.last_valid_battery_at is not None:
                    elapsed = now - self.last_valid_battery_at
                    if elapsed >= self.STALE_THRESHOLD_SECONDS:
                        self.receive_state = ReceiveState.SLEEP_SUSPECTED
                        changed = True

        if changed:
            self._notify_listeners()
        return changed

    def to_dict(self) -> dict:
        """現在の状態を IPC 電文用の辞書形式で返す"""
        with self._lock:
            if self.receive_state in (ReceiveState.NORMAL, ReceiveState.SLEEP_SUSPECTED):
                bat = self.battery_percent
                dpi_val = self.dpi
                rate_val = self.polling_rate
            else:
                bat = None
                dpi_val = None
                rate_val = None

            ts = self.last_received_at if self.last_received_at is not None else time.time()

            return {
                "v": 1,
                "type": "state",
                "receive_state": self.receive_state.value,
                "battery": bat,
                "charging": self.charging_state.value,
                "dpi": dpi_val,
                "polling_rate": rate_val,
                "ts": round(ts, 3),
            }

    def get_tooltip_text(self) -> str:
        with self._lock:
            prefix = "[DEMO] " if self.is_demo_mode else ""
            if not self.dongle_available or self.receive_state == ReceiveState.DONGLE_DISCONNECTED:
                return f"{prefix}LAMZU Thorn V2 - Dongle unavailable"

            if self.battery_percent is None or self.receive_state == ReceiveState.WAITING_DATA:
                return f"{prefix}LAMZU Thorn V2 - Waiting for data"

            if self.receive_state == ReceiveState.SLEEP_SUSPECTED:
                return f"{prefix}LAMZU Thorn V2 - Last known: {self.battery_percent}%"

            return f"{prefix}LAMZU Thorn V2 - Battery: {self.battery_percent}%"

    def get_menu_battery_text(self) -> str:
        with self._lock:
            if (
                self.dongle_available
                and self.receive_state in (ReceiveState.NORMAL, ReceiveState.SLEEP_SUSPECTED)
                and self.battery_percent is not None
            ):
                return f"バッテリー: {self.battery_percent}%"
            return "バッテリー: 未取得"

    def get_menu_status_text(self) -> str:
        with self._lock:
            match self.receive_state:
                case ReceiveState.NORMAL:
                    return "受信状態: 正常"
                case ReceiveState.SLEEP_SUSPECTED:
                    return "受信状態: スリープ推測 (データ途絶)"
                case ReceiveState.WAITING_DATA:
                    return "受信状態: データ待機中"
                case ReceiveState.DONGLE_DISCONNECTED:
                    return "受信状態: ドングル未検出"
                case ReceiveState.INITIALIZING:
                    return "受信状態: 初期化中"
                case _:
                    return "受信状態: 不明"

    def get_menu_time_text(self) -> str:
        with self._lock:
            if (
                self.dongle_available
                and self.receive_state in (ReceiveState.NORMAL, ReceiveState.SLEEP_SUSPECTED)
                and self.last_valid_battery_at is not None
            ):
                dt = datetime.fromtimestamp(self.last_valid_battery_at)
                return f"最終更新: {dt.strftime('%H:%M:%S')}"
            return "最終更新: なし"
