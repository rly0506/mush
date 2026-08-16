@echo off
rem mush 看板一键启动（D21-a 桌面入口）：固定端口 4790，浏览器自动打开；
rem 已有实例在跑时（exit 3），按锁文件里的端口直接打开旧实例。
title mush board
cd /d D:\mush
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4790/'"
node bin\mush board --port 4790
if errorlevel 3 powershell -NoProfile -Command "$p=(Get-Content 'D:\mush\runtime\board.lock' | ConvertFrom-Json).port; if($p){ Start-Process ('http://127.0.0.1:' + $p + '/') } else { Start-Process 'http://127.0.0.1:4790/' }"
