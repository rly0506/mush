@echo off
rem mush dog-window: titled dog launcher (AGENTS.md naming convention mush|<packet>|<dog>)
rem usage: dog-window.cmd <packet-id> <dog-cli> [extra-args...]
rem e.g.   dog-window.cmd rm004-p18a dsh-tui
rem e.g.   dog-window.cmd rm004-p18a dsh --resume
if "%~1"=="" goto usage
if "%~2"=="" goto usage

set "PACKET_ID=%~1"
set "DOG_NAME=%~2"
set "DOG_EXE=%~2"

rem Alias dsh / deepseek to dsh-tui for interactive sessions
if /i "%~2"=="dsh" set "DOG_EXE=dsh-tui"
if /i "%~2"=="deepseek" set "DOG_EXE=dsh-tui"

shift
shift

set "EXTRA_ARGS="
:collect_args
if "%~1"=="" goto run_dog
set "EXTRA_ARGS=%EXTRA_ARGS% %1"
shift
goto collect_args

:run_dog
start "mush|%PACKET_ID%|%DOG_NAME%" cmd /k "%DOG_EXE%%EXTRA_ARGS%"
exit /b 0

:usage
echo usage: dog-window.cmd ^<packet-id^> ^<dog-cli^> [extra-args...]
echo   e.g. dog-window.cmd rm004-p18a dsh-tui
echo   e.g. dog-window.cmd rm004-p18a dsh --resume
exit /b 1

