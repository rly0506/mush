@echo off
rem mush dog-window: titled dog launcher (AGENTS.md naming convention mush|<packet>|<dog>)
rem usage: dog-window.cmd <packet-id> <dog-cli>
rem e.g.   dog-window.cmd rm004-p18a dsh
if "%~1"=="" goto usage
if "%~2"=="" goto usage
start "mush|%~1|%~2" cmd /k "%~2"
exit /b 0
:usage
echo usage: dog-window.cmd ^<packet-id^> ^<dog-cli^>
echo   e.g. dog-window.cmd rm004-p18a dsh
exit /b 1
