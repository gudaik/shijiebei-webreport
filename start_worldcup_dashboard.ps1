# World Cup Beijing dashboard autostart
# Generates static JSON via WSL, starts nginx if needed, then opens the dashboard.

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$LogDir = "C:\nginx-1.24.0\html\worldcup2\logs"
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir "worldcup_web_autostart.log"
function Log($msg) {
  $t = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $LogFile -Encoding UTF8 -Value "[$t] $msg"
}

Log "WorldCup dashboard autostart triggered."
Start-Sleep -Seconds 8

$WslExe = Join-Path $env:WINDIR "System32\wsl.exe"
$Generator = "/mnt/c/nginx-1.24.0/html/worldcup2/web/generate_web_data.py"
try {
  Log "Generating dashboard data via WSL: $Generator"
  & $WslExe @("-d", "Ubuntu", "--", "bash", "-lc", "python3 '$Generator'") 2>&1 | ForEach-Object { Log "WSL: $_" }
  Log "WSL generation exit code: $LASTEXITCODE"
} catch {
  Log "ERROR running WSL generator: $($_.Exception.Message)"
}

try {
  $NginxRoot = "C:\nginx-1.24.0"
  $NginxExe = Join-Path $NginxRoot "nginx.exe"
  $Running = Get-Process nginx -ErrorAction SilentlyContinue
  if (!$Running) {
    Log "Starting nginx: $NginxExe"
    Start-Process -FilePath $NginxExe -WorkingDirectory $NginxRoot -WindowStyle Hidden
    Start-Sleep -Seconds 2
  } else {
    Log "nginx already running: $($Running.Id -join ',')"
  }
} catch {
  Log "ERROR starting nginx: $($_.Exception.Message)"
}

try {
  $Url = "http://localhost/worldcup2/"
  Log "Opening dashboard: $Url"
  Start-Process $Url
} catch {
  Log "ERROR opening dashboard: $($_.Exception.Message)"
}

Log "WorldCup dashboard autostart finished."
