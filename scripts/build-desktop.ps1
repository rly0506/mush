# mush 桌面便携包构建脚本
# ASCII-only per AGENTS.md iron rule.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist\mush-pilot-desktop'

Write-Output "==> Creating release distribution directory: $dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dist 'bin') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dist 'scripts') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dist 'docs') -Force | Out-Null

Write-Output "==> Copying core application files..."
Copy-Item (Join-Path $root 'package.json') $dist
Copy-Item (Join-Path $root 'LICENSE') $dist
Copy-Item (Join-Path $root 'EULA.md') $dist
Copy-Item (Join-Path $root 'CONSTITUTION.md') $dist
Copy-Item (Join-Path $root 'DECISIONS.md') $dist
Copy-Item (Join-Path $root 'AGENTS.md') $dist
Copy-Item (Join-Path $root 'bin\*') (Join-Path $dist 'bin') -Recurse
Copy-Item (Join-Path $root 'src') $dist -Recurse
Copy-Item (Join-Path $root 'goals') $dist -Recurse
Copy-Item (Join-Path $root 'scripts/board-up.*') (Join-Path $dist 'scripts')
Copy-Item (Join-Path $root 'docs/PILOT_RELEASE_GUIDE.md') (Join-Path $dist 'docs')

# Create root one-click launcher
$cmdContent = @"
@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\board-up.ps1"
"@
Set-Content -Path (Join-Path $dist 'mush-start.cmd') -Value $cmdContent -Encoding ASCII

Write-Output "==> mush pilot desktop package successfully created at: $dist"
