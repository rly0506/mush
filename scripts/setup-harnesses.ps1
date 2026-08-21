# mush 原厂战衣一键环境检测与安装助手
# ASCII-only per AGENTS.md iron rule.
$ErrorActionPreference = 'Continue'

Write-Output "========================================================"
Write-Output " mush Native Harness Federation - Environment Diagnostic"
Write-Output "========================================================"

function Check-Cli([string]$name, [string]$cmd, [string]$installCmd) {
    Write-Host -NoNewline "Checking $name ($cmd)... "
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
        Write-Host " [OK] Installed at $($found.Source)" -ForegroundColor Green
        return $true
    } else {
        Write-Host " [MISSING]" -ForegroundColor Yellow
        Write-Host "  -> Install command: $installCmd" -ForegroundColor Cyan
        return $false
    }
}

$c1 = Check-Cli "Claude Code" "claude" "npm install -g @anthropic-ai/claude-code"
$c2 = Check-Cli "DeepSeek Shell" "dsh" "npm install -g dsh (or install official binary)"
$c3 = Check-Cli "Antigravity CLI" "agy" "npm install -g agy (or install Google Antigravity SDK)"
$c4 = Check-Cli "Kimi Code" "kimi" "npm install -g kimi (or install Moonshot CLI)"

Write-Output ""
Write-Output "Diagnostic complete. You can install missing harnesses individually as needed."
Write-Output "mush will automatically detect them once installed."
