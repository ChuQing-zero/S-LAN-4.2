# ============================================================
# TCG Auto Launcher v2
# ============================================================
$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "TCG Auto Launcher"

$LD_DIR  = "D:\App\leidian\LDPlayer9"
$ADB     = "$LD_DIR\adb.exe"
$DEVICE  = "localhost:5555"
$PKG     = "com.jihuanshe"
$ACT     = ".ui.page.main.MainActivity"

function Write-Step($n, $text) {
    $total = 6
    Write-Host "[$n/$total] $text" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   TCG Auto Launcher v2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -----------------------------------------------------------
# [1/6] Find emulator
# -----------------------------------------------------------
Write-Step 1 "Finding LDPlayer..."
if (-not (Test-Path "$LD_DIR\dnplayer.exe")) {
    Write-Host "  [FAIL] Not found: $LD_DIR\dnplayer.exe" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "  [OK] $LD_DIR" -ForegroundColor Green

# -----------------------------------------------------------
# [2/6] Clean state + Launch emulator
# -----------------------------------------------------------
Write-Step 2 "Starting emulator..."

# Clean: disconnect all ADB connections (avoid fake "already connected")
Write-Host "  Cleaning stale connections..." -ForegroundColor DarkGray
& $ADB disconnect 2>$null | Out-Null
& $ADB kill-server 2>$null | Out-Null
Start-Sleep -Seconds 1
& $ADB start-server 2>$null | Out-Null

# Check if dnplayer.exe process is actually running (not via ADB)
$dnRunning = Get-Process -Name "dnplayer" -ErrorAction SilentlyContinue

if ($dnRunning) {
    Write-Host "  dnplayer.exe already running (PID: $($dnRunning.Id))" -ForegroundColor DarkGray
} else {
    Write-Host "  Launching LDPlayer window..." -ForegroundColor DarkGray
    Start-Process "$LD_DIR\dnplayer.exe" -WorkingDirectory $LD_DIR -WindowStyle Normal
}

# -----------------------------------------------------------
# [3/6] Wait for ADB port
# -----------------------------------------------------------
Write-Step 3 "Waiting for ADB..."
$startTime = Get-Date
$connected = $false

do {
    Start-Sleep -Seconds 2
    $r = & $ADB connect $DEVICE 2>&1
    if ($r -match "connected|already connected") {
        $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
        Write-Host "  [OK] ADB connected ($elapsed sec)" -ForegroundColor Green
        $connected = $true
        break
    }
    $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
    if ($elapsed % 8 -eq 0) {
        Write-Host "  Waiting... $elapsed sec" -ForegroundColor DarkGray
    }
} while (((Get-Date) - $startTime).TotalSeconds -lt 60)

if (-not $connected) {
    Write-Host "  [FAIL] Cannot connect to emulator" -ForegroundColor Red
    Write-Host "  Is the LDPlayer window visible? If not, try running dnplayer.exe manually." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# -----------------------------------------------------------
# [4/6] Wait for Android boot
# -----------------------------------------------------------
Write-Step 4 "Waiting for Android boot..."
$startTime = Get-Date
$booted = $false

do {
    Start-Sleep -Seconds 3
    $boot = & $ADB -s $DEVICE shell getprop sys.boot_completed 2>$null
    $boot = $boot.Trim()
    if ($boot -eq "1") {
        $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
        Write-Host "  [OK] Boot complete ($elapsed sec)" -ForegroundColor Green
        $booted = $true
        break
    }
    $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
    if ($elapsed % 15 -eq 0) {
        Write-Host "  Waiting... $elapsed sec" -ForegroundColor DarkGray
    }
} while (((Get-Date) - $startTime).TotalSeconds -lt 180)

if (-not $booted) {
    Write-Host "  [WARN] Boot timeout, trying anyway..." -ForegroundColor Yellow
}

# -----------------------------------------------------------
# [5/6] Device info
# -----------------------------------------------------------
Write-Step 5 "Device info"
$size = & $ADB -s $DEVICE shell wm size 2>$null | ForEach-Object { $_.Trim() }
$ver  = & $ADB -s $DEVICE shell getprop ro.build.version.release 2>$null | ForEach-Object { $_.Trim() }
Write-Host "  Screen: $size | Android: $ver" -ForegroundColor DarkGray

# -----------------------------------------------------------
# [6/6] Launch APP
# -----------------------------------------------------------
Write-Step 6 "Launching APP"
$installed = & $ADB -s $DEVICE shell pm list packages 2>$null | Select-String $PKG
if (-not $installed) {
    Write-Host "  [FAIL] $PKG not installed!" -ForegroundColor Red
    Write-Host "  Drag APK here and press Enter: " -ForegroundColor Yellow -NoNewline
    $apk = Read-Host
    if ($apk) {
        Write-Host "  Installing..." -ForegroundColor DarkGray
        & $ADB -s $DEVICE install $apk 2>&1
    }
}
& $ADB -s $DEVICE shell am start -n "$PKG/$ACT" 2>$null | Out-Null
Write-Host "  [OK] APP launched!" -ForegroundColor Green

# -----------------------------------------------------------
# Done
# -----------------------------------------------------------
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Ready!" -ForegroundColor Green
Write-Host "   Device: $DEVICE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close"
