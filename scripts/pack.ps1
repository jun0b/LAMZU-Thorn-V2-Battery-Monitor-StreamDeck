# scripts/pack.ps1
# ThornV2 Battery Monitor — Stream Deck プラグイン配布パッケージ作成スクリプト
#
# 仕様:
# - com.jun0b.thornv2-battery-monitor.sdPlugin/bin/plugin.js および bin/sidecar/thornv2-sidecar.exe の存在検証
# - .sdPlugin を com.jun0b.thornv2-battery-monitor.streamDeckPlugin にバンドル
# - .venv, tests/, .git/, .vscode/, *.log 等の不要ファイルの混入を厳格に除外・検証

[CmdletBinding()]
param(
    [switch]$SkipSidecarCheck = $false,
    [switch]$Force = $true
)

$ErrorActionPreference = "Stop"

# アセンブリの読み込み（ZIP 構造検証用）
Add-Type -AssemblyName "System.IO.Compression.FileSystem"

# プロジェクトルートディレクトリの解決
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $ProjectRoot

$SdPluginDir = Join-Path $ProjectRoot "com.jun0b.thornv2-battery-monitor.sdPlugin"
$OutputPackage = Join-Path $ProjectRoot "com.jun0b.thornv2-battery-monitor.streamDeckPlugin"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ThornV2 Battery Monitor — プラグインパッケージング開始" -ForegroundColor Cyan
Write-Host " プラグインディレクトリ: $SdPluginDir" -ForegroundColor Gray
Write-Host " 出力パッケージ:         $OutputPackage" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. 必須成果物の存在検証
Write-Host "[1/4] 配布必須ファイルの存在検証中..." -ForegroundColor Cyan

$ManifestPath = Join-Path $SdPluginDir "manifest.json"
$PluginJsPath = Join-Path $SdPluginDir "bin\plugin.js"
$SidecarExePath = Join-Path $SdPluginDir "bin\sidecar\thornv2-sidecar.exe"
$SidecarInternalPath = Join-Path $SdPluginDir "bin\sidecar\_internal"

$ValidationErrors = @()

if (-not (Test-Path $ManifestPath)) {
    $ValidationErrors += "manifest.json が見つかりません: $ManifestPath"
}
if (-not (Test-Path $PluginJsPath)) {
    $ValidationErrors += "プラグインスクリプト (bin/plugin.js) が見つかりません: $PluginJsPath (先に 'npm run build' を実行してください)"
}

if (-not $SkipSidecarCheck) {
    if (-not (Test-Path $SidecarExePath)) {
        $ValidationErrors += "サイドカー実行ファイル (bin/sidecar/thornv2-sidecar.exe) が見つかりません: $SidecarExePath (先に 'scripts/build-sidecar.ps1' を実行してください)"
    }
    if (-not (Test-Path $SidecarInternalPath)) {
        $ValidationErrors += "サイドカー依存関係ディレクトリ (bin/sidecar/_internal) が見つかりません: $SidecarInternalPath"
    }
} else {
    Write-Host "※ --SkipSidecarCheck が指定されているため、サイドカー実行ファイルの検証をスキップします。" -ForegroundColor Yellow
}

if ($ValidationErrors.Count -gt 0) {
    Write-Error "パッケージング前提条件エラー:`n$($ValidationErrors -join "`n")"
    exit 1
}

Write-Host "必須ファイル検証に合格しました。" -ForegroundColor Green

# 2. 事前クリーンアップ（除外対象の混入防止）
Write-Host "[2/4] プラグインディレクトリ内の不要ファイル検出・削除中..." -ForegroundColor Cyan

$ProhibitedPatterns = @(".venv*", "tests*", ".git*", ".vscode*", "*.log", "__pycache__*", "*.pyc")
foreach ($pat in $ProhibitedPatterns) {
    $found = Get-ChildItem -Path $SdPluginDir -Filter $pat -Recurse -Force -ErrorAction SilentlyContinue
    if ($found) {
        foreach ($item in $found) {
            Write-Host "除外対象を削除: $($item.FullName)" -ForegroundColor Yellow
            Remove-Item -Path $item.FullName -Recurse -Force
        }
    }
}

# 3. パッケージングの実行
Write-Host "[3/4] .streamDeckPlugin パッケージを生成中..." -ForegroundColor Cyan

if (Test-Path $OutputPackage) {
    if ($Force) {
        Remove-Item -Path $OutputPackage -Force
    } else {
        Write-Error "出力ファイル $OutputPackage は既に存在します。-Force を指定してください。"
        exit 1
    }
}

$PackSucceeded = $false

# 公式 @elgato/cli の pack コマンドを最優先試行
try {
    Write-Host "streamdeck pack コマンドを実行します..." -ForegroundColor Gray
    & npx streamdeck pack $SdPluginDir -f --ignore-validation -o $ProjectRoot
    if ($LASTEXITCODE -eq 0 -and (Test-Path $OutputPackage)) {
        $PackSucceeded = $true
        Write-Host "streamdeck pack による生成に成功しました。" -ForegroundColor Green
    }
} catch {
    Write-Host "streamdeck pack の実行中に例外が発生しました: $_" -ForegroundColor Yellow
}

# フォールバック: .NET ZipFile による ZIP 圧縮
if (-not $PackSucceeded) {
    Write-Host "フォールバック: .NET ZipFile を使用してアーカイブを作成します..." -ForegroundColor Yellow
    [System.IO.Compression.ZipFile]::CreateFromDirectory($SdPluginDir, $OutputPackage, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    if (Test-Path $OutputPackage) {
        $PackSucceeded = $true
    } else {
        Write-Error "パッケージアーカイブの作成に失敗しました。"
        exit 1
    }
}

# 4. パッケージ内部の除外項目監査
Write-Host "[4/4] 生成されたパッケージの内部監査を実施中..." -ForegroundColor Cyan

$Zip = [System.IO.Compression.ZipFile]::OpenRead($OutputPackage)
$ProhibitedMatches = @()
$TotalEntries = 0

try {
    foreach ($entry in $Zip.Entries) {
        $TotalEntries++
        $name = $entry.FullName
        foreach ($pattern in @("/.venv", "/tests/", "/.git", "/.vscode", ".log", "/__pycache__/", ".pyc")) {
            if ($name -like "*$pattern*") {
                $ProhibitedMatches += "$name (一致パターン: $pattern)"
            }
        }
    }
} finally {
    $Zip.Dispose()
}

if ($ProhibitedMatches.Count -gt 0) {
    Remove-Item -Path $OutputPackage -Force
    Write-Error "パッケージ監査エラー: 以下の禁止ファイルがアーカイブ内に検出されたためパッケージを破棄しました:`n$($ProhibitedMatches -join "`n")"
    exit 1
}

$PkgSize = (Get-Item $OutputPackage).Length / 1KB
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " パッケージングが正常に完了しました！" -ForegroundColor Green
Write-Host " 成果物:   $OutputPackage" -ForegroundColor Gray
Write-Host " サイズ:   $([math]::Round($PkgSize, 1)) KB ($TotalEntries ファイル包含)" -ForegroundColor Gray
Write-Host " 除外監査: 合格（.venv, tests, .git, .vscode, *.log の混入なし）" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

exit 0
