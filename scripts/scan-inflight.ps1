# mush: scan dog windows + worktrees + board dispatches (pre-dispatch checklist, D30/AD-35)
# ASCII-only per AGENTS.md iron rule. Output: any in-flight signals across the three channels.
$ErrorActionPreference = 'SilentlyContinue'

Write-Output '== [1] dog windows (title convention mush|<packet>|<dog>) =='
$wins = Get-Process | Where-Object { $_.MainWindowTitle -like 'mush|*' }
if ($wins) { $wins | ForEach-Object { Write-Output ("  PID {0}  {1}" -f $_.Id, $_.MainWindowTitle) } }
else { Write-Output '  (none titled)' }

Write-Output '== [2] worktrees (existing g0NN branches = dogs mid-task) =='
$wt = git -C 'D:\mush' worktree list 2>$null
if ($wt) { $wt | Where-Object { $_ -match 'worktrees' } | ForEach-Object { Write-Output "  $_" } }

Write-Output '== [3] board dispatches (non-terminal = board-side in-flight) =='
$snap = ''
try { $snap = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4790/api/snapshot' -TimeoutSec 3).Content } catch { Write-Output '  (board unreachable)'; exit 0 }
$dispatches = ($snap | ConvertFrom-Json).dispatches
# GOAL-067: terminal set aligned with src/web/dispatch.ts TERMINAL (REJECTED/SUPERSEDED added)
$terminal = @('PASS', 'FAIL', 'DRY_RUN', 'TIMEOUT', 'BLOCKED_WAITING_OWNER', 'BLOCKED_ENV', 'INTERRUPTED', 'REJECTED', 'SUPERSEDED')
$active = @($dispatches | Where-Object { $terminal -notcontains $_.status })
if ($active.Count -gt 0) { $active | ForEach-Object { Write-Output ("  {0}  {1}  {2}" -f $_.dispatch_id.Substring(0,8), $_.adapter_id, $_.status) } }
else { Write-Output '  (no board-side in-flight)' }
