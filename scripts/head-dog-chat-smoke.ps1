# Head-dog real chat smoke (GOAL-011) - ASCII-only script per DEF-07/08 iron rule.
$ErrorActionPreference = 'Stop'
$root = 'D:\mush\runtime\worktrees\deepseek'
Set-Location $root
$env:DSH_HOME = Join-Path $root '.dsh-home'
$credFile = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
if (Test-Path -LiteralPath $credFile) {
    $line = Get-Content -LiteralPath $credFile -Raw
    $key = ($line -split ':', 2)[1].Trim()
    $env:DEEPSEEK_API_KEY = $key
}
$charter = 'You are the mush head-dog. Reply briefly and exactly. You can dispatch dogs via mush. Constitution gates: spending/external/delete/scope/identity need owner.'
$msg1 = 'Round 1: remember the token ANCHOR-G11-7391 and reply OK.'
$started1 = [DateTime]::UtcNow
$out1 = dsh --profile headless ($charter + ' ' + $msg1) 2>&1 | Out-String
$exit1 = $LASTEXITCODE
# dsh does not echo session id; discover the newest session directory under DSH_HOME.
$session = 'no-session'
$sessionsRoot = Join-Path $env:DSH_HOME 'sessions'
if (Test-Path -LiteralPath $sessionsRoot) {
    $candidates = Get-ChildItem -LiteralPath $sessionsRoot -Recurse -Directory -Filter 'session-*' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    if ($candidates.Count -gt 0) { $session = $candidates[0].Name }
}
$started2 = [DateTime]::UtcNow
if ($session -ne 'no-session') {
    $msg2 = 'Round 2 (resume): state the token from round 1.'
    $out2 = dsh --profile headless --resume $session ($charter + ' ' + $msg2) 2>&1 | Out-String
    $exit2 = $LASTEXITCODE
} else {
    $out2 = ''
    $exit2 = 1
}
$finished = [DateTime]::UtcNow
$sha1 = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]$out1))).Replace('-','')
$sha2 = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]$out2))).Replace('-','')
$evidence = [ordered]@{
  schema_version = 1
  adapter_id = 'head-dog'
  started_at_utc = $started1.ToString('o')
  finished_at_utc = $finished.ToString('o')
  round1_exit = $exit1
  round2_exit = $exit2
  session_id = $session
  round1_stdout_sha256 = $sha1
  round2_stdout_sha256 = $sha2
  round2_token_recalled = ($out2 -match 'ANCHOR-G11-7391')
  status = if ($exit1 -eq 0 -and $exit2 -eq 0 -and ($out2 -match 'ANCHOR-G11-7391')) { 'PASS' } else { 'FAIL' }
}
$dir = Join-Path $root 'goals\receipts\chat-smoke'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$path = Join-Path $dir 'head-dog-chat-smoke-2026-08-17.json'
[System.IO.File]::WriteAllText($path, ($evidence | ConvertTo-Json) + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('session=' + $session + ' exit1=' + $exit1 + ' exit2=' + $exit2 + ' recall=' + ($out2 -match 'ANCHOR-G11-7391') + ' status=' + $evidence.status)
Write-Output ('out1len=' + ([string]$out1).Length + ' out2len=' + ([string]$out2).Length)
