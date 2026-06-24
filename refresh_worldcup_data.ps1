# Refresh World Cup dashboard JSON data only (no browser open).
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$LogDir = "C:\nginx-1.24.0\html\worldcup2\logs"
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir "worldcup_data_refresh.log"
function Log($msg) {
  $t = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $LogFile -Encoding UTF8 -Value "[$t] $msg"
}

$WslExe = Join-Path $env:WINDIR "System32\wsl.exe"
$Generator = "/mnt/c/nginx-1.24.0/html/worldcup2/web/generate_web_data.py"
try {
  Log "Refreshing dashboard data via WSL: $Generator"
  & $WslExe @("-d", "Ubuntu", "--", "bash", "-lc", "python3 '$Generator'") 2>&1 | ForEach-Object { Log "WSL: $_" }
  Log "WSL generation exit code: $LASTEXITCODE"
} catch {
  Log "ERROR running WSL generator: $($_.Exception.Message)"
}
