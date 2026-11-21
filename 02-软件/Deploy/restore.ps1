# S-LAN V2.0 - Restore (PowerShell version)
# List all backups and restore the selected one

$ErrorActionPreference = 'Continue'

$ROOT = 'D:\Project\S-LAN\Code\V1.1'
$BKROOT = Join-Path $ROOT 'Storage\backup'

# locate mongorestore.exe
$MONGORESTORE = 'D:\App\mongodb\mongodb-win32-x86_64-windows-8.0.5\bin\mongorestore.exe'
if (-not (Test-Path $MONGORESTORE)) {
    $cmd = Get-Command mongorestore -ErrorAction SilentlyContinue
    if ($cmd) { $MONGORESTORE = $cmd.Source }
    else {
        Write-Host '  [ERROR] mongorestore not found! Install MongoDB Database Tools.' -ForegroundColor Red
        Read-Host 'Press Enter to exit'
        exit 1
    }
}

Write-Host '================================'
Write-Host '  S-LAN V2.0 - Restore'
Write-Host '================================'
Write-Host ''

if (-not (Test-Path $BKROOT)) {
    Write-Host '  No backups found. Run backup first.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

# list backups (folders with mongodump\s-lan-local inside)
$backups = Get-ChildItem $BKROOT -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'mongodump\s-lan-local') } | Sort-Object Name -Descending

if ($backups.Count -eq 0) {
    Write-Host '  No valid backups found.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

Write-Host '  Available backups:'
Write-Host ''
$i = 0
foreach ($b in $backups) {
    $i++
    $size = [math]::Round((Get-ChildItem $b.FullName -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
    Write-Host "  [$i] $($b.Name)  ($size MB)"
}
Write-Host ''

$choice = Read-Host '  Select backup number to restore'
if ($choice -notmatch '^\d+$' -or [int]$choice -lt 1 -or [int]$choice -gt $backups.Count) {
    Write-Host '  Invalid selection.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

$sel = $backups[[int]$choice - 1]
$srcDir = Join-Path $sel.FullName 'mongodump\s-lan-local'

Write-Host ''
Write-Host "  [WARN] This will OVERWRITE current database with backup of $($sel.Name)!" -ForegroundColor Yellow
$confirm = Read-Host '  Type YES to confirm'
if ($confirm -ne 'YES') {
    Write-Host '  Canceled.'
    Read-Host 'Press Enter to exit'
    exit 0
}

Write-Host "[1/1] Restoring database from $($sel.Name)..."
& $MONGORESTORE --db s-lan-local --drop $srcDir 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [ERROR] mongorestore failed!' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}
Write-Host "  Restore done [OK]  (from $($sel.Name))" -ForegroundColor Green
Write-Host ''
Read-Host 'Press Enter to exit'
