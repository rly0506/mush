# mush board one-click launcher (AD-36 fix): exactly ONE browser window in both cases.
# ASCII-only per AGENTS.md iron rule.
$root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$lockPath = Join-Path $root 'runtime\board.lock'
$defaultPort = 4790

function Open-Board([int]$port) { Start-Process ('http://127.0.0.1:{0}/' -f $port) }

function Test-Port([int]$port, [int]$processId = 0) {
  try {
    if ($processId -gt 0) {
      $listener = Get-NetTCPConnection -State Listen -LocalPort $port -OwningProcess $processId -ErrorAction Stop
      if (-not $listener) { return $false }
    }
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(300) -and $client.Connected) {
      $client.Close()
      return $true
    }
    $client.Close()
  } catch { }
  return $false
}

# case 1: instance already running (lock held by live node pid AND port listening) -> open once, exit.
if (Test-Path $lockPath) {
  try {
    $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
    $alive = $false
    if ($lock.pid) {
      $proc = Get-Process -Id $lock.pid -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -match '^(node|nodejs|electron)$') { $alive = $true }
    }
    if ($alive -and $null -eq $lock.released_at_utc -and $lock.port) {
      if (Test-Port ([int]$lock.port) ([int]$lock.pid)) {
        Open-Board ([int]$lock.port)
        exit 0
      }
    }
  } catch { }
}

# case 2: fresh start -> background board, poll port, open once.
Start-Process -FilePath 'node' -ArgumentList 'bin\mush', 'board', '--port', "$defaultPort" -WorkingDirectory $root -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  if (Test-Port $defaultPort) {
    Open-Board $defaultPort
    exit 0
  }
}
Write-Output 'board did not come up within 15s - open http://127.0.0.1:4790/ manually'
exit 1
