param([string]$ScriptPath, [int]$Port, [int]$ProcessId)

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw 'Launcher parse failed' }
$definition = $ast.Find({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-Port'
}, $true)
if (-not $definition) { throw 'Test-Port is missing' }
# Load only the probe function, never the launcher or browser side effects.
Invoke-Expression $definition.Extent.Text
Test-Port $Port $ProcessId
