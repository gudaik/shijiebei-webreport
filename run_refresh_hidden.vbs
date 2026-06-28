' Run WorldCup dashboard data refresh without flashing a PowerShell console window.
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\nginx-1.24.0\html\worldcup2\refresh_worldcup_data.ps1""", 0, False
