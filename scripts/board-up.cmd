@echo off
rem mush board one-click launcher (D21 desktop entry; AD-36 single-window fix).
rem Full logic lives in board-up.ps1: lock-check -> open once, or fresh start -> poll -> open once.
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\board-up.ps1"

