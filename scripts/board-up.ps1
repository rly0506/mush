# mush board one-click launcher (AD-36 fix): exactly ONE browser window in both cases.
# ASCII-only per AGENTS.md iron rule.
$root = 'D:\mush'
$lockPath = Join-Path $root 'runtime\board.lock'
$defaultPort = 4790

function Open-Board([int]$port) { Start-Process ('http://127.0.0.1:{0}/' -f $port) }

# case 1: instance already running (lock held by live pid) -> open once, exit.
if (Test-Path $lockPath) {
  try {
    $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
    $alive = $false
    if ($lock.pid) { $alive = [bool](Get-Process -Id $lock.pid -ErrorAction SilentlyContinue) }
    if ($alive -and $null -eq $lock.released_at_utc -and $lock.port) {
      Open-Board ([int]$lock.port)
      exit 0
    }
  } catch { }
}

# case 2: fresh start -> new console window runs the board, poll port, open once.
Start-Process -FilePath 'node' -ArgumentList 'bin\mush', 'board', '--port', "$defaultPort" -WorkingDirectory $root
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $defaultPort, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(300) -and $client.Connected) {
      $client.Close()
      Open-Board $defaultPort
      exit 0
    }
    $client.Close()
  } catch { }
}
Write-Output 'board did not come up within 15s - open http://127.0.0.1:4790/ manually'
exit 1
