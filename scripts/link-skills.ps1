$userHome = [Environment]::GetFolderPath('UserProfile')
$targetBase = Join-Path $userHome ".gemini\config\skills"

if (-not (Test-Path $targetBase)) {
    New-Item -ItemType Directory -Path $targetBase -Force | Out-Null
}

$pluginsPattern = Join-Path $userHome ".gemini\config\plugins\*\skills\*"
$pluginSkills = Get-ChildItem -Path $pluginsPattern -Directory -ErrorAction SilentlyContinue

$builtinPattern = Join-Path $userHome ".gemini\antigravity\builtin\skills\*"
$builtinSkills = Get-ChildItem -Path $builtinPattern -Directory -ErrorAction SilentlyContinue

$allSkills = @()
if ($null -ne $pluginSkills) { $allSkills += $pluginSkills }
if ($null -ne $builtinSkills) { $allSkills += $builtinSkills }

$count = 0
foreach ($dir in $allSkills) {
    $dest = Join-Path $targetBase $dir.Name
    if (-not (Test-Path $dest)) {
        New-Item -ItemType Junction -Path $dest -Target $dir.FullName | Out-Null
        $count++
    }
}

Write-Output "Successfully linked $count skills into $targetBase"
