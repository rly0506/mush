@echo off
rem mush harness environment setup helper
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\setup-harnesses.ps1"
pause
