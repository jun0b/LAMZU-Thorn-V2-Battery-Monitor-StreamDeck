/**
 * LAMZU Thorn V2 バッテリー残量・状態描画モジュール (144x144 SVG)
 */

import { BatteryDisplayState, MemoizedRenderer } from "./types.js";

/** 円形ゲージの半径 (px) */
export const RING_RADIUS = 52;

/** 円形ゲージの中心座標 X (px) */
export const RING_CENTER_X = 72;

/** 円形ゲージの中心座標 Y (px) */
export const RING_CENTER_Y = 72;

/** 円周長 (2 * PI * r) */
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** ゲージ線の太さ (px) */
export const RING_STROKE_WIDTH = 10;

/** カラーパレット */
export const COLOR_CYAN = "#00d2ff";       // 充電完了 (水色/シアン)
export const COLOR_GREEN = "#22c55e";      // 51〜100%
export const COLOR_YELLOW = "#eab308";     // 21〜50%
export const COLOR_RED = "#ef4444";        // 0〜20% / ERR
export const COLOR_TRACK = "#334155";      // 背景トラック
export const COLOR_TEXT_WHITE = "#ffffff"; // 通常テキスト
export const COLOR_TEXT_GRAY = "#94a3b8";  // スリープ・未取得時テキスト
export const COLOR_BACKGROUND = "#000000"; // キー背景色

/**
 * バッテリー残量および充電完了状態に応じたゲージ色を返す
 */
export function getBatteryRingColor(percent: number, isChargingComplete = false): string {
  if (isChargingComplete) {
    return COLOR_CYAN;
  }
  if (percent > 50) {
    return COLOR_GREEN;
  }
  if (percent >= 21) {
    return COLOR_YELLOW;
  }
  return COLOR_RED;
}

/**
 * バッテリー残量を 0〜100 の整数に丸める
 */
export function sanitizeBatteryPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  const rounded = Math.round(value);
  return Math.max(0, Math.min(100, rounded));
}

/**
 * 充電完了（満充電）状態かどうかを判定する
 */
export function isChargingComplete(state: BatteryDisplayState | null | undefined): boolean {
  return state?.charging === "CHARGING_COMPLETE";
}

/**
 * 充電中または充電完了（⚡マーク表示対象）かどうかを判定する
 */
export function isChargingActive(state: BatteryDisplayState | null | undefined): boolean {
  return (
    state?.charging === "CHARGING" ||
    state?.charging === "CHARGING_COMPLETE" ||
    state?.charging === true
  );
}

/**
 * SVG 文字列を Data URL 形式に変換する
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * ドングル未接続アイコンの SVG 要素を返す
 */
function renderDisconnectIcon(): string {
  return [
    `<g id="disconnect-icon" stroke="${COLOR_TEXT_GRAY}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">`,
    `  <path d="M63 43 L68 48 M60 46 L65 51" />`,
    `  <path d="M76 48 L81 43 M79 51 L84 46" />`,
    `  <line x1="60" y1="58" x2="84" y2="34" stroke="${COLOR_RED}" stroke-width="2.5" />`,
    `</g>`
  ].join("\n");
}

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * 水平バッテリーアイコンの SVG 要素を生成する
 */
function renderHorizontalBatteryIcon(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  percent: number | null;
  fillColor: string;
  isCharging: boolean;
  opacity?: number;
}): string {
  const {
    x,
    y,
    width,
    height,
    rx,
    percent,
    fillColor,
    isCharging,
    opacity = 1,
  } = options;
  const pad = 3;
  const maxInnerW = Math.max(0, width - pad * 2);
  const clamped = percent !== null ? Math.max(0, Math.min(100, percent)) : 0;
  const fillW = Math.round((maxInnerW * clamped) / 100);
  const innerH = Math.max(0, height - pad * 2);
  const innerRx = Math.max(2, rx - 2);

  // 右端のプラス端子
  const capX = x + width + 2;
  const capH = Math.round(height * 0.48);
  const capY = y + Math.round((height - capH) / 2);
  const capW = Math.max(3, Math.round(width * 0.055));

  const groupAttr = opacity < 1 ? ` opacity="${opacity}"` : "";
  const lines: string[] = [];
  lines.push(`  <g id="battery-bar-icon"${groupAttr}>`);
  lines.push(`    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="none" stroke="${COLOR_TEXT_WHITE}" stroke-width="2" />`);
  lines.push(`    <rect x="${capX}" y="${capY}" width="${capW}" height="${capH}" rx="1.5" fill="none" stroke="${COLOR_TEXT_WHITE}" stroke-width="2" />`);
  if (fillW > 0) {
    lines.push(`    <rect x="${x + pad}" y="${y + pad}" width="${fillW}" height="${innerH}" rx="${innerRx}" fill="${fillColor}" />`);
  }
  if (isCharging) {
    // 充電中・充電完了時は電池アイコン中央に稲妻マークを重ねる
    const cx = x + width / 2;
    const cy = y + height / 2;
    const scale = height / 25;
    const p1 = `${(cx + 6 * scale).toFixed(1)},${(cy - 22 * scale).toFixed(1)}`;
    const p2 = `${(cx - 11 * scale).toFixed(1)},${(cy + 2 * scale).toFixed(1)}`;
    const p3 = `${(cx - 1 * scale).toFixed(1)},${(cy + 2 * scale).toFixed(1)}`;
    const p4 = `${(cx - 7 * scale).toFixed(1)},${(cy + 22 * scale).toFixed(1)}`;
    const p5 = `${(cx + 10 * scale).toFixed(1)},${(cy - 2 * scale).toFixed(1)}`;
    const p6 = `${(cx + 0 * scale).toFixed(1)},${(cy - 2 * scale).toFixed(1)}`;
    const pts = `${p1} ${p2} ${p3} ${p4} ${p5} ${p6}`;
    lines.push(`    <polygon id="charging-bolt" points="${pts}" fill="#facc15" stroke="#000000" stroke-width="1.2" stroke-linejoin="round"><title>⚡</title></polygon>`);
  }
  lines.push(`  </g>`);
  return lines.join("\n");
}

/**
 * Icon レイアウト（上部パーセント + 下部バッテリーアイコン）の SVG を生成する
 */
function renderBarLayout(
  receiveState: string,
  battery: number | null,
  isCharging: boolean,
  chargingComplete: boolean,
): string {
  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">`);
  lines.push(`  <rect width="144" height="144" fill="${COLOR_BACKGROUND}" />`);

  if (receiveState === "ERR") {
    lines.push(`  <text x="72" y="58" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="${COLOR_RED}">ERR</text>`);
    lines.push(renderHorizontalBatteryIcon({ x: 39, y: 84, width: 62, height: 22, rx: 5, percent: 0, fillColor: COLOR_RED, isCharging: false, opacity: 0.5 }));
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  if (receiveState === "DONGLE_DISCONNECTED") {
    lines.push(`  <text x="72" y="58" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="${COLOR_TEXT_GRAY}">N/A</text>`);
    lines.push(renderHorizontalBatteryIcon({ x: 39, y: 84, width: 62, height: 22, rx: 5, percent: 0, fillColor: COLOR_TRACK, isCharging: false, opacity: 0.45 }));
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  if (receiveState === "WAITING_DATA" || receiveState === "INITIALIZING" || (battery === null && receiveState !== "SLEEP_SUSPECTED")) {
    lines.push(`  <text x="72" y="58" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="32" font-weight="bold" fill="${COLOR_TEXT_GRAY}">--</text>`);
    lines.push(renderHorizontalBatteryIcon({ x: 39, y: 84, width: 62, height: 22, rx: 5, percent: 0, fillColor: COLOR_TRACK, isCharging: false, opacity: 0.5 }));
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  const validPercent = battery ?? 0;
  const isSleep = receiveState === "SLEEP_SUSPECTED";
  const barColor = getBatteryRingColor(validPercent, !isSleep && chargingComplete);
  const textColor = isSleep ? COLOR_TEXT_GRAY : COLOR_TEXT_WHITE;
  const barOpacity = isSleep ? 0.4 : 1;

  if (isSleep) {
    lines.push(`  <text x="118" y="28" text-anchor="end" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="14" font-weight="bold" fill="${COLOR_TEXT_GRAY}">zz</text>`);
  }

  lines.push(`  <text x="72" y="58" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="34" font-weight="bold" fill="${textColor}">${validPercent}%</text>`);
  lines.push(renderHorizontalBatteryIcon({
    x: 39,
    y: 84,
    width: 62,
    height: 22,
    rx: 5,
    percent: validPercent,
    fillColor: barColor,
    isCharging: !isSleep && isCharging,
    opacity: barOpacity,
  }));

  lines.push(`</svg>`);
  return lines.join("\n");
}

/**
 * Icon + DPI / Hz レイアウトの SVG を生成する
 */
function renderBarDpiLayout(
  receiveState: string,
  battery: number | null,
  isCharging: boolean,
  chargingComplete: boolean,
  dpi: number | null | undefined,
  pollingRate: number | null | undefined,
): string {
  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">`);
  lines.push(`  <rect width="144" height="144" fill="${COLOR_BACKGROUND}" />`);

  const dpiText = typeof dpi === "number" && dpi > 0 ? `${dpi} DPI` : "-- DPI";
  const hzText = typeof pollingRate === "number" && pollingRate > 0 ? `${pollingRate} Hz` : "-- Hz";

  // 区切り線
  lines.push(`  <line x1="18" y1="68" x2="126" y2="68" stroke="#52525b" stroke-width="1.5" />`);

  if (receiveState === "ERR") {
    lines.push(`  <text x="44" y="47" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="24" font-weight="bold" fill="${COLOR_RED}">ERR</text>`);
    lines.push(renderHorizontalBatteryIcon({ x: 80, y: 27, width: 44, height: 20, rx: 4, percent: 0, fillColor: COLOR_RED, isCharging: false, opacity: 0.5 }));
    lines.push(`  <text x="72" y="96" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="21" fill="${COLOR_TEXT_GRAY}">-- DPI</text>`);
    lines.push(`  <text x="72" y="122" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="21" fill="${COLOR_TEXT_GRAY}">-- Hz</text>`);
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  if (receiveState === "DONGLE_DISCONNECTED") {
    lines.push(`  <text x="44" y="47" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="24" font-weight="bold" fill="${COLOR_TEXT_GRAY}">N/A</text>`);
    lines.push(renderHorizontalBatteryIcon({ x: 80, y: 27, width: 44, height: 20, rx: 4, percent: 0, fillColor: COLOR_TRACK, isCharging: false, opacity: 0.45 }));
    lines.push(`  <text x="72" y="96" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="21" fill="${COLOR_TEXT_GRAY}">-- DPI</text>`);
    lines.push(`  <text x="72" y="122" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="21" fill="${COLOR_TEXT_GRAY}">-- Hz</text>`);
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  if (receiveState === "WAITING_DATA" || receiveState === "INITIALIZING" || (battery === null && receiveState !== "SLEEP_SUSPECTED")) {
    lines.push(`  <text x="44" y="47" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="26" font-weight="bold" fill="${COLOR_TEXT_GRAY}">--</text>`);
    lines.push(renderHorizontalBatteryIcon({ x: 80, y: 27, width: 44, height: 20, rx: 4, percent: 0, fillColor: COLOR_TRACK, isCharging: false, opacity: 0.5 }));
    lines.push(`  <text x="72" y="96" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="21" fill="${COLOR_TEXT_GRAY}">${dpiText}</text>`);
    lines.push(`  <text x="72" y="122" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="21" fill="${COLOR_TEXT_GRAY}">${hzText}</text>`);
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  const validPercent = battery ?? 0;
  const isSleep = receiveState === "SLEEP_SUSPECTED";
  const barColor = getBatteryRingColor(validPercent, !isSleep && chargingComplete);
  const textColor = isSleep ? COLOR_TEXT_GRAY : COLOR_TEXT_WHITE;
  const barOpacity = isSleep ? 0.4 : 1;
  const fontSize = validPercent === 100 ? 22 : 26;

  lines.push(`  <text x="44" y="47" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="bold" fill="${textColor}">${validPercent}%</text>`);
  lines.push(renderHorizontalBatteryIcon({
    x: 80,
    y: 27,
    width: 44,
    height: 20,
    rx: 4,
    percent: validPercent,
    fillColor: barColor,
    isCharging: !isSleep && isCharging,
    opacity: barOpacity,
  }));

  lines.push(`  <text x="72" y="96" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="21" fill="${textColor}">${dpiText}</text>`);
  lines.push(`  <text x="72" y="122" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="21" fill="${textColor}">${hzText}</text>`);

  lines.push(`</svg>`);
  return lines.join("\n");
}

/**
 * バッテリー状態から 144x144 の SVG 文字列を生成する
 */
export function renderBatteryKey(state: BatteryDisplayState): string {
  const rawState = state?.receive_state;
  const isKnownState =
    rawState === "NORMAL" ||
    rawState === "SLEEP_SUSPECTED" ||
    rawState === "WAITING_DATA" ||
    rawState === "INITIALIZING" ||
    rawState === "DONGLE_DISCONNECTED";

  const receiveState = isKnownState ? rawState : "ERR";
  const battery = sanitizeBatteryPercent(state?.battery);
  const isCharging = isChargingActive(state);
  const chargingComplete = isChargingComplete(state);
  const layout = state?.layout ?? "ring";

  if (layout === "bar") {
    return renderBarLayout(receiveState, battery, isCharging, chargingComplete);
  }
  if (layout === "bar_dpi") {
    return renderBarDpiLayout(receiveState, battery, isCharging, chargingComplete, state?.dpi, state?.polling_rate);
  }

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">`);
  lines.push(`  <rect width="144" height="144" fill="${COLOR_BACKGROUND}" />`);

  // エラー状態
  if (receiveState === "ERR") {
    lines.push(`  <circle cx="${RING_CENTER_X}" cy="${RING_CENTER_Y}" r="${RING_RADIUS}" fill="none" stroke="${COLOR_RED}" stroke-width="8" stroke-dasharray="10 6" />`);
    lines.push(`  <text x="${RING_CENTER_X}" y="83" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="${COLOR_RED}">ERR</text>`);
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  // ドングル未接続
  if (receiveState === "DONGLE_DISCONNECTED") {
    lines.push(`  <circle cx="${RING_CENTER_X}" cy="${RING_CENTER_Y}" r="${RING_RADIUS}" fill="none" stroke="${COLOR_TRACK}" stroke-width="${RING_STROKE_WIDTH}" />`);
    lines.push(`  ${renderDisconnectIcon()}`);
    lines.push(`  <text x="${RING_CENTER_X}" y="86" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="24" font-weight="bold" fill="${COLOR_TEXT_GRAY}">N/A</text>`);
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  // データ待機中 / 初期化中
  if (receiveState === "WAITING_DATA" || receiveState === "INITIALIZING" || battery === null && receiveState !== "SLEEP_SUSPECTED") {
    lines.push(`  <circle cx="${RING_CENTER_X}" cy="${RING_CENTER_Y}" r="${RING_RADIUS}" fill="none" stroke="${COLOR_TRACK}" stroke-width="${RING_STROKE_WIDTH}" />`);
    lines.push(`  <text x="${RING_CENTER_X}" y="83" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="32" font-weight="bold" fill="${COLOR_TEXT_GRAY}">--</text>`);
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  // スリープ状態
  if (receiveState === "SLEEP_SUSPECTED") {
    const validPercent = battery ?? 0;
    const ringColor = getBatteryRingColor(validPercent, false);
    const dashOffset = RING_CIRCUMFERENCE * (1 - validPercent / 100);

    lines.push(`  <circle cx="${RING_CENTER_X}" cy="${RING_CENTER_Y}" r="${RING_RADIUS}" fill="none" stroke="${COLOR_TRACK}" stroke-width="${RING_STROKE_WIDTH}" opacity="0.4" />`);

    if (validPercent > 0) {
      lines.push(`  <circle cx="${RING_CENTER_X}" cy="${RING_CENTER_Y}" r="${RING_RADIUS}" fill="none" stroke="${ringColor}" stroke-width="${RING_STROKE_WIDTH}" stroke-linecap="round" stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}" transform="rotate(-90 ${RING_CENTER_X} ${RING_CENTER_Y})" opacity="0.35" />`);
    }

    lines.push(`  <text x="${RING_CENTER_X}" y="52" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="16" font-weight="bold" fill="${COLOR_TEXT_GRAY}" letter-spacing="1">zz</text>`);

    const displayText = battery !== null ? `${battery}%` : "--";
    lines.push(`  <text x="${RING_CENTER_X}" y="86" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="26" font-weight="bold" fill="${COLOR_TEXT_GRAY}">${displayText}</text>`);
    lines.push(`</svg>`);
    return lines.join("\n");
  }

  // 通常受信中
  const validPercent = battery ?? 0;
  const ringColor = getBatteryRingColor(validPercent, chargingComplete);
  const dashOffset = RING_CIRCUMFERENCE * (1 - validPercent / 100);

  lines.push(`  <circle cx="${RING_CENTER_X}" cy="${RING_CENTER_Y}" r="${RING_RADIUS}" fill="none" stroke="${COLOR_TRACK}" stroke-width="${RING_STROKE_WIDTH}" />`);

  if (validPercent > 0) {
    lines.push(`  <circle cx="${RING_CENTER_X}" cy="${RING_CENTER_Y}" r="${RING_RADIUS}" fill="none" stroke="${ringColor}" stroke-width="${RING_STROKE_WIDTH}" stroke-linecap="round" stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}" transform="rotate(-90 ${RING_CENTER_X} ${RING_CENTER_Y})" />`);
  }

  if (isCharging) {
    lines.push(`  <polygon id="charging-bolt" points="75,33 65,47 72,47 69,59 79,45 72,45" fill="#facc15"><title>⚡</title></polygon>`);
    lines.push(`  <text x="${RING_CENTER_X}" y="86" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="26" font-weight="bold" fill="${COLOR_TEXT_WHITE}">${validPercent}%</text>`);
  } else {
    // Stream Deck の SVG レンダラーは dominant-baseline を無視するため y=81 (100%時) / y=83 で垂直中央に配置
    const fontSize = validPercent === 100 ? 26 : 32;
    const textY = validPercent === 100 ? 81 : 83;
    lines.push(`  <text x="${RING_CENTER_X}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="bold" fill="${COLOR_TEXT_WHITE}">${validPercent}%</text>`);
  }

  lines.push(`</svg>`);
  return lines.join("\n");
}

/**
 * バッテリー状態から Data URL 形式の SVG 文字列を生成する
 */
export function renderBatteryKeyAsDataUrl(state: BatteryDisplayState): string {
  return svgToDataUrl(renderBatteryKey(state));
}

/**
 * 前回と描画結果が同じ場合に changed=false を返すキャッシュ付きレンダラーを生成する
 */
export function createMemoizedRenderer(): MemoizedRenderer {
  let lastSvg: string | null = null;
  let lastDataUrl: string | null = null;

  return {
    render(state: BatteryDisplayState): { svg: string; changed: boolean } {
      const svg = renderBatteryKey(state);
      const changed = svg !== lastSvg;
      if (changed) {
        lastSvg = svg;
        lastDataUrl = null;
      }
      return { svg, changed };
    },

    renderDataUrl(state: BatteryDisplayState): { dataUrl: string; changed: boolean } {
      const svg = renderBatteryKey(state);
      const changed = svg !== lastSvg;
      if (changed) {
        lastSvg = svg;
        lastDataUrl = svgToDataUrl(svg);
      } else if (lastDataUrl === null) {
        lastDataUrl = svgToDataUrl(svg);
      }
      return { dataUrl: lastDataUrl, changed };
    },

    getLastSvg(): string | null {
      return lastSvg;
    },

    reset(): void {
      lastSvg = null;
      lastDataUrl = null;
    }
  };
}
