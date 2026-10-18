/**
 * Windows トースト通知送信
 */

import { spawn } from "node:child_process";
import type { ToastNotificationOptions } from "./types.js";

/** PowerShell の標準 AUMID */
export const DEFAULT_AUMID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

/** XML 特殊文字のエスケープ */
export function escapeXml(str: string): string {
	if (!str) {
		return "";
	}
	return String(str)
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** トースト通知用 PowerShell スクリプトの生成 */
export function buildPowerShellToastScript(
	title: string,
	body: string,
	appId: string = DEFAULT_AUMID,
): string {
	const safeTitle = escapeXml(title ?? "");
	const safeBody = escapeXml(body ?? "");
	const xmlContent = `<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeBody}</text></binding></visual></toast>`;
	const base64Xml = Buffer.from(xmlContent, "utf-8").toString("base64");
	const safeAppId = (appId || DEFAULT_AUMID).replace(/'/g, "''");

	return [
		"$ProgressPreference = 'SilentlyContinue';",
		"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;",
		"[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;",
		`$xmlContent = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Xml}'));`,
		"$xml = New-Object Windows.Data.Xml.Dom.XmlDocument;",
		"$xml.LoadXml($xmlContent);",
		"$toast = New-Object Windows.UI.Notifications.ToastNotification $xml;",
		`$appId = '${safeAppId}';`,
		"$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId);",
		"$notifier.Show($toast);",
	].join("\n");
}

/** PowerShell スクリプトを Base64 (UTF-16LE) にエンコード */
export function encodePowerShellCommand(script: string): string {
	return Buffer.from(script, "utf16le").toString("base64");
}

/** Windows トースト通知を送信 */
export function sendWindowsToastNotification(
	options: ToastNotificationOptions,
	logger?: { warn: (msg: string) => void; info?: (msg: string) => void },
): boolean {
	if (process.platform !== "win32") {
		return false;
	}

	try {
		const script = buildPowerShellToastScript(options.title, options.body, options.appId);
		const encoded = encodePowerShellCommand(script);

		const child = spawn(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-WindowStyle",
				"Hidden",
				"-EncodedCommand",
				encoded,
			],
			{
				windowsHide: true,
				stdio: "ignore",
				detached: true,
			},
		);

		child.on("error", (err: Error) => {
			logger?.warn(`[ToastNotification] PowerShell プロセス起動エラー: ${err.message}`);
		});

		child.unref();
		return true;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		logger?.warn(`[ToastNotification] トースト通知送信例外: ${msg}`);
		return false;
	}
}
