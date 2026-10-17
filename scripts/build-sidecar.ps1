# scripts/build-sidecar.ps1
# ThornV2 Battery Monitor — Python HID サイドカー PyInstaller ビルドスクリプト
#
# 仕様:
# - PyInstaller --console --onedir --clean --name thornv2-sidecar --distpath com.jun0b.thornv2-battery-monitor.sdPlugin/bin/sidecar sidecar/main.py
# - 出力先に thornv2-sidecar.exe および _internal/ ディレクトリが含まれることを検証
# - .venv, tests, __pycache__, .pyc 等の不要ファイル混入を厳格に排除

[CmdletBinding()]
param(
    [switch]$CleanOnly = $false
)

$ErrorActionPreference = "Stop"

# プロジェクトルートディレクトリの解決
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $ProjectRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ThornV2 Battery Monitor — サイドカービルド開始" -ForegroundColor Cyan
Write-Host " プロジェクトルート: $ProjectRoot" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$SidecarSrc = Join-Path $ProjectRoot "sidecar\main.py"
$PluginDistSidecar = Join-Path $ProjectRoot "com.jun0b.thornv2-battery-monitor.sdPlugin\bin\sidecar"
$NestedDist = Join-Path $PluginDistSidecar "thornv2-sidecar"
$BuildTemp = Join-Path $ProjectRoot "build\thornv2-sidecar"
$SpecFile = Join-Path $ProjectRoot "thornv2-sidecar.spec"

# クリーンアップ処理
if (Test-Path $PluginDistSidecar) {
    Write-Host "[1/5] 既存のサイドカーバイナリディレクトリをクリーンアップ中..." -ForegroundColor Yellow
    Remove-Item -Path $PluginDistSidecar -Recurse -Force
}
if (Test-Path $BuildTemp) {
    Remove-Item -Path $BuildTemp -Recurse -Force
}
if (Test-Path $SpecFile) {
    Remove-Item -Path $SpecFile -Force
}

if ($CleanOnly) {
    Write-Host "クリーンアップが完了しました。" -ForegroundColor Green
    exit 0
}

# Python スクリプト存在確認
if (-not (Test-Path $SidecarSrc)) {
    Write-Error "エラー: サイドカーのエントリポイント ($SidecarSrc) が見つかりません。"
    exit 1
}

# PyInstaller / Python インタプリタの検出
$VenvPyInstaller = Join-Path $ProjectRoot ".venv\Scripts\pyinstaller.exe"
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

$PyInstallerCmd = $null
$PyInstallerArgs = @()

if (Test-Path $VenvPyInstaller) {
    $PyInstallerCmd = $VenvPyInstaller
    Write-Host "[2/5] 仮想環境の PyInstaller を検出: $VenvPyInstaller" -ForegroundColor Green
} elseif (Test-Path $VenvPython) {
    $PyInstallerCmd = $VenvPython
    $PyInstallerArgs = @("-m", "PyInstaller")
    Write-Host "[2/5] 仮想環境の Python (-m PyInstaller) を使用: $VenvPython" -ForegroundColor Green
} else {
    $GlobalPyInstaller = Get-Command "pyinstaller" -ErrorAction SilentlyContinue
    if ($GlobalPyInstaller) {
        $PyInstallerCmd = $GlobalPyInstaller.Source
        Write-Host "[2/5] システムの PyInstaller を検出: $PyInstallerCmd" -ForegroundColor Yellow
    } else {
        $GlobalPython = Get-Command "python" -ErrorAction SilentlyContinue
        if ($GlobalPython) {
            $PyInstallerCmd = $GlobalPython.Source
            $PyInstallerArgs = @("-m", "PyInstaller")
            Write-Host "[2/5] システムの Python (-m PyInstaller) を使用: $PyInstallerCmd" -ForegroundColor Yellow
        } else {
            Write-Error "エラー: PyInstaller または Python が見つかりません。.venv を設定するか環境変数 PATH を確認してください。"
            exit 1
        }
    }
}

# PyInstaller の実行引数構築
# --console: stdio 通信のため必須（--noconsole は Windows で stdin/stdout がクラッシュするため厳禁）
# --onedir: 依存関係 DLL を _internal/ に配置し、配布可能ディレクトリを生成
$FullArgs = @()
$FullArgs += $PyInstallerArgs
$FullArgs += @(
    "--console",
    "--onedir",
    "--clean",
    "--noconfirm",
    "--name", "thornv2-sidecar",
    "--distpath", $PluginDistSidecar,
    "--workpath", (Join-Path $ProjectRoot "build"),
    "--specpath", $ProjectRoot,
    $SidecarSrc
)

Write-Host "[3/5] PyInstaller を実行中..." -ForegroundColor Cyan
Write-Host "実行コマンド: $PyInstallerCmd $($FullArgs -join ' ')" -ForegroundColor Gray

& $PyInstallerCmd $FullArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "エラー: PyInstaller のビルドに失敗しました (ExitCode: $LASTEXITCODE)。"
    exit $LASTEXITCODE
}

# ディレクトリ構造のフラット化（--distpath 指定時に生成される多重ネストの解消）
# PyInstaller は --distpath <path> --name <name> の場合 <path>\<name>\... に出力するため、
# <PluginDistSidecar>\thornv2-sidecar\* の中身を <PluginDistSidecar>\ 直下に移動して整頓する
if (Test-Path $NestedDist) {
    Write-Host "[4/5] 出力ディレクトリ構造を正規化中..." -ForegroundColor Yellow
    Get-ChildItem -Path $NestedDist | ForEach-Object {
        $Dest = Join-Path $PluginDistSidecar $_.Name
        if (Test-Path $Dest) {
            Remove-Item -Path $Dest -Recurse -Force
        }
        Move-Item -Path $_.FullName -Destination $PluginDistSidecar -Force
    }
    Remove-Item -Path $NestedDist -Recurse -Force
}

# 不要ファイル・テスト・キャッシュ・仮想環境の混入排除と検証
Write-Host "[5/5] 不要ファイル混入チェックおよび成果物検証中..." -ForegroundColor Cyan

$ProhibitedPatterns = @("*.pyc", "__pycache__", ".venv", "tests")
foreach ($pattern in $ProhibitedPatterns) {
    $foundItems = Get-ChildItem -Path $PluginDistSidecar -Filter $pattern -Recurse -ErrorAction SilentlyContinue
    if ($foundItems) {
        Write-Host "警告: 不要ファイル/ディレクトリ ($pattern) を検出しました。削除します。" -ForegroundColor Yellow
        $foundItems | Remove-Item -Recurse -Force
    }
}

# 必須成果物の検証
$TargetExe = Join-Path $PluginDistSidecar "thornv2-sidecar.exe"
$TargetInternal = Join-Path $PluginDistSidecar "_internal"

$Errors = @()
if (-not (Test-Path $TargetExe)) {
    $Errors += "必須実行ファイルが見つかりません: $TargetExe"
}
if (-not (Test-Path $TargetInternal)) {
    $Errors += "必須依存関係ディレクトリが見つかりません: $TargetInternal"
}

if ($Errors.Count -gt 0) {
    Write-Error "ビルド検証失敗:`n$($Errors -join "`n")"
    exit 1
}

# specファイルおよび build ディレクトリの掃除
if (Test-Path $SpecFile) {
    Remove-Item -Path $SpecFile -Force
}

$ExeSize = (Get-Item $TargetExe).Length / 1MB
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " サイドカービルドが正常に完了しました！" -ForegroundColor Green
Write-Host " 出力バイナリ: $TargetExe ($([math]::Round($ExeSize, 2)) MB)" -ForegroundColor Gray
Write-Host " 依存関係群:   $TargetInternal" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Green

exit 0
