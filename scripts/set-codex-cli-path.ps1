# Sets CODEX_CLI_PATH at MACHINE level so all apps (including ChatGPT desktop)
# can locate the Codex CLI binary. Run this script as Administrator once.
$path = "D:\npm-global\codex.exe"
if (-not (Test-Path $path)) {
    Write-Error "codex.exe not found at $path"
    exit 1
}
[Environment]::SetEnvironmentVariable('CODEX_CLI_PATH', $path, 'Machine')
Write-Host "CODEX_CLI_PATH (Machine) = $path"
