# S-LAN V2.0 - Backup (PowerShell version)
# Backup full MongoDB database to Storage\backup\YYYYMMDD-HHMMSS\

$ErrorActionPreference = 'Continue'

$ROOT = 'D:\Project\S-LAN\Code\V1.1'
$BKROOT = Join-Path $ROOT 'Storage\backup'
$STAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$DEST = Join-Path $BKROOT "$STAMP\mongodump"

Write-Host '================================'
Write-Host '  S-LAN V2.0 - Backup'
Write-Host '================================'
Write-Host ''

# locate mongodump.exe
$MONGODUMP = 'D:\App\mongodb\mongodb-win32-x86_64-windows-8.0.5\bin\mongodump.exe'
if (-not (Test-Path $MONGODUMP)) {
    $cmd = Get-Command mongodump -ErrorAction SilentlyContinue
    if ($cmd) { $MONGODUMP = $cmd.Source }
    else {
        Write-Host '  [ERROR] mongodump not found! Install MongoDB Database Tools.' -ForegroundColor Red
        Read-Host 'Press Enter to exit'
        exit 1
    }
}

Write-Host '[1/2] Full database backup (mongodump)...'
New-Item -ItemType Directory -Path $DEST -Force | Out-Null
& $MONGODUMP --db s-lan-local --out $DEST 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [ERROR] mongodump failed! Is MongoDB running?' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}
Write-Host '  MongoDB full backup done [OK]' -ForegroundColor Green

Write-Host '[2/2] Config files backup...'
robocopy (Join-Path $ROOT 'Server\src\config') (Join-Path $BKROOT "$STAMP\config") /E /NFL /NDL /NP /R:1 /W:1 | Out-Null
Copy-Item (Join-Path $ROOT 'Server\.env') (Join-Path $BKROOT "$STAMP\env-backup.txt") -Force -ErrorAction SilentlyContinue
Write-Host '  Config backup done [OK]' -ForegroundColor Green

Write-Host ''
Write-Host '================================'
Write-Host '  Backup folder:'
Write-Host "  $(Join-Path $BKROOT $STAMP)"
Write-Host '================================'
Write-Host ''
Read-Host 'Press Enter to exit'
