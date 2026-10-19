/**
 * Windows トースト通知送信
 */

import { spawn } from "node:child_process";
import type { ToastNotificationOptions } from "./types.js";

/** Stream Deck の標準 AUMID */
export const DEFAULT_AUMID = "{6D809377-6AF0-444B-8957-A3773F02200E}\\Elgato\\StreamDeck\\StreamDeck.exe";

/** フォールバック用 AUMID */
export const FALLBACK_AUMID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

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
	optionsOrTitle: ToastNotificationOptions | string,
	bodyText?: string,
	appIdArg?: string,
): string {
	const options: ToastNotificationOptions =
		typeof optionsOrTitle === "string"
			? {
					title: optionsOrTitle,
					body: bodyText ?? "",
					appId: appIdArg,
				}
			: optionsOrTitle;

	const safeTitle = escapeXml(options.title ?? "");
	const safeBody = escapeXml(options.body ?? "");
	const scenarioAttr = options.reminder !== false ? ' scenario="reminder"' : "";
	const actionTags =
		options.reminder !== false
			? '<actions><action content="Dismiss" arguments="dismiss" /></actions>'
			: "";
	const audioTag =
		options.sound !== false
			? '<audio src="ms-winsoundevent:Notification.Default" />'
			: '<audio silent="true" />';
	const xmlContent = `<toast${scenarioAttr}><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeBody}</text></binding></visual>${audioTag}${actionTags}</toast>`;
	const base64Xml = Buffer.from(xmlContent, "utf-8").toString("base64");
	const safePrimaryAppId = (options.appId || DEFAULT_AUMID).replace(/'/g, "''");
	const safeFallbackAppId = FALLBACK_AUMID.replace(/'/g, "''");

	return [
		"$ErrorActionPreference = 'Stop';",
		"$ProgressPreference = 'SilentlyContinue';",
		"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;",
		"[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;",
		`$xmlContent = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Xml}'));`,
		"$xml = New-Object Windows.Data.Xml.Dom.XmlDocument;",
		"$xml.LoadXml($xmlContent);",
		"$toast = New-Object Windows.UI.Notifications.ToastNotification $xml;",
		`$primaryId = '${safePrimaryAppId}';`,
		`$fallbackId = '${safeFallbackAppId}';`,
		"try {",
		"    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($primaryId);",
		"    $notifier.Show($toast);",
		"    Write-Output \"SUCCESS: $primaryId\";",
		"} catch {",
		"    Write-Output \"FALLBACK_TRIGGERED: $($_.Exception.Message)\";",
		"    try {",
		"        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($fallbackId);",
		"        $notifier.Show($toast);",
		"        Write-Output \"SUCCESS: $fallbackId\";",
		"    } catch {",
		"        Write-Error \"ERROR: $($_.Exception.Message)\";",
		"    }",
		"}",
		"Start-Sleep -Milliseconds 1000;",
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
		const script = buildPowerShellToastScript(options);
		const encoded = encodePowerShellCommand(script);
		const psExe = process.env.SystemRoot
			? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
			: "powershell.exe";

		const child = spawn(
			psExe,
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
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		let stderr = "";
		let stdout = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", (err: Error) => {
			logger?.warn(`[ToastNotification] PowerShell プロセス起動エラー: ${err.message}`);
		});

		child.on("exit", (code) => {
			if (code !== 0 || stderr.trim()) {
				logger?.warn(`[ToastNotification] PowerShell 終了コード ${code}, stderr: ${stderr.trim()}`);
			} else {
				logger?.info?.(`[ToastNotification] トースト通知送信完了: ${stdout.trim()}`);
			}
		});

		child.unref();
		return true;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		logger?.warn(`[ToastNotification] トースト通知送信例外: ${msg}`);
		return false;
	}
}
