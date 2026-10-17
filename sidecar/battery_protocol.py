"""LAMZU Thorn V2 バッテリープロトコル解析モジュール

USB HID Input Report (Report ID: 0x04) のペイロードから
バッテリー残量と充電状態を抽出する。
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Union, List


class PacketType(Enum):
    """HID パケット種別"""
    FORMAT_A = "FORMAT_A"  # 先頭 0x38: バッテリー残量を含むパケット
    FORMAT_B = "FORMAT_B"  # 先頭 0x03: ケーブル抜き差し時等の補助パケット（残量値なし）
    UNKNOWN = "UNKNOWN"
    INVALID = "INVALID"


class ChargingState(Enum):
    """充電状態"""
    UNKNOWN = "UNKNOWN"
    DISCHARGING = "DISCHARGING"
    CHARGING = "CHARGING"
    CHARGING_COMPLETE = "CHARGING_COMPLETE"
    NOT_CHARGING = "DISCHARGING"


@dataclass
class ParsedPacket:
    """パケット解析結果"""
    packet_type: PacketType
    is_valid_battery: bool
    battery_level: Optional[int]
    status_code: Optional[int]
    state_value: Optional[int]
    report_id: Optional[int]
    raw_data: bytes
    payload: bytes
    charging_state: ChargingState = ChargingState.UNKNOWN
    error_message: Optional[str] = None

    def get_status_description(self) -> str:
        if self.status_code is None:
            return "不明"
        match self.status_code:
            case 0x00:
                return "通常動作 / 非充電 (0x00)"
            case 0x02:
                return "充電完了 (0x02)"
            case 0x04:
                return "充電中 (0x04)"
            case _:
                return f"未確定状態コード (0x{self.status_code:02X})"


def format_hex(data: Union[bytes, bytearray, List[int]]) -> str:
    """バイト列を16進数文字列に変換する"""
    if isinstance(data, (list, tuple)):
        data = bytes(data)
    return " ".join(f"{b:02x}" for b in data)


def parse_packet(raw_input: Union[bytes, bytearray, List[int]]) -> ParsedPacket:
    """Input Report の生データを解析する"""
    if isinstance(raw_input, (list, tuple)):
        raw_bytes = bytes(raw_input)
    elif isinstance(raw_input, bytearray):
        raw_bytes = bytes(raw_input)
    elif isinstance(raw_input, bytes):
        raw_bytes = raw_input
    else:
        return ParsedPacket(
            packet_type=PacketType.INVALID,
            is_valid_battery=False,
            battery_level=None,
            status_code=None,
            state_value=None,
            report_id=None,
            raw_data=b"",
            payload=b"",
            error_message="入力データ形式が不正です",
        )

    if len(raw_bytes) == 0:
        return ParsedPacket(
            packet_type=PacketType.INVALID,
            is_valid_battery=False,
            battery_level=None,
            status_code=None,
            state_value=None,
            report_id=None,
            raw_data=raw_bytes,
            payload=b"",
            error_message="データ長が0です",
        )

    report_id = None
    payload = raw_bytes

    if len(raw_bytes) >= 9 and raw_bytes[0] in (0x04, 0x03, 0x05):
        report_id = raw_bytes[0]
        payload = raw_bytes[1:]
    elif len(raw_bytes) == 8:
        report_id = None
        payload = raw_bytes

    if len(payload) < 8:
        return ParsedPacket(
            packet_type=PacketType.INVALID,
            is_valid_battery=False,
            battery_level=None,
            status_code=None,
            state_value=None,
            report_id=report_id,
            raw_data=raw_bytes,
            payload=payload,
            error_message=f"Payload長が不足しています ({len(payload)}バイト)",
        )

    header = payload[0]

    # 形式 A: バッテリー残量パケット (0x38)
    if header == 0x38:
        status_code = payload[2]
        state_value = payload[3]
        battery_candidate = payload[4]

        if status_code == 0x04:
            charging_state = ChargingState.CHARGING
        elif status_code == 0x02:
            charging_state = ChargingState.CHARGING_COMPLETE
        elif status_code == 0x00:
            charging_state = ChargingState.DISCHARGING
        else:
            charging_state = ChargingState.UNKNOWN

        if not (0 <= battery_candidate <= 100):
            return ParsedPacket(
                packet_type=PacketType.INVALID,
                is_valid_battery=False,
                battery_level=None,
                status_code=status_code,
                state_value=state_value,
                report_id=report_id,
                raw_data=raw_bytes,
                payload=payload,
                charging_state=charging_state,
                error_message=f"バッテリー残量が範囲外です: {battery_candidate}%",
            )

        return ParsedPacket(
            packet_type=PacketType.FORMAT_A,
            is_valid_battery=True,
            battery_level=battery_candidate,
            status_code=status_code,
            state_value=state_value,
            report_id=report_id,
            raw_data=raw_bytes,
            payload=payload,
            charging_state=charging_state,
            error_message=None,
        )

    # 形式 B: 充電状態通知パケット (0x03)
    if header == 0x03:
        charge_flag = payload[2] if len(payload) > 2 else None

        if charge_flag == 0x01:
            charging_state = ChargingState.CHARGING
        elif charge_flag == 0x00:
            charging_state = ChargingState.DISCHARGING
        else:
            charging_state = ChargingState.UNKNOWN

        return ParsedPacket(
            packet_type=PacketType.FORMAT_B,
            is_valid_battery=False,
            battery_level=None,
            status_code=charge_flag,
            state_value=None,
            report_id=report_id,
            raw_data=raw_bytes,
            payload=payload,
            charging_state=charging_state,
            error_message=None,
        )

    return ParsedPacket(
        packet_type=PacketType.UNKNOWN,
        is_valid_battery=False,
        battery_level=None,
        status_code=None,
        state_value=None,
        report_id=report_id,
        raw_data=raw_bytes,
        payload=payload,
        error_message=f"未知のパケットヘッダーです: 0x{header:02X}",
    )
