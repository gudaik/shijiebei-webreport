@echo off
REM Run as Administrator. Change WorldCupDashboardDataRefresh to hidden VBS wrapper.
schtasks /Change /TN "WorldCupDashboardDataRefresh" /TR "wscript.exe \"C:\nginx-1.24.0\html\worldcup2\run_refresh_hidden.vbs\""
schtasks /Query /TN "WorldCupDashboardDataRefresh" /V /FO LIST
pause
