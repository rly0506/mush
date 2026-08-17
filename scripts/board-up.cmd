@echo off
rem mush board one-click launcher (D21 desktop entry; AD-36 single-window fix).
rem Full logic lives in board-up.ps1: lock-check -> open once, or fresh start -> poll -> open once.
cd /d D:\mush
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\mush\scripts\board-up.ps1"
