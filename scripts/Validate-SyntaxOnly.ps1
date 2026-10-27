#requires -Version 5.1
# Parser-only validation; NEVER dot-source, execute, import or invoke printer scripts.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Path $PSScriptRoot -Parent
$paths=@(
 'windows/agent.ps1',
 'windows/install-task.ps1',
 'windows/Invoke-SyntheticPrintTest.ps1',
 'windows/Invoke-CrmArtworkPrintTest.ps1',
 'scripts/Test-LabelPrinter.ps1',
 'scripts/Prepare-SumatraPortable.ps1',
 'scripts/Validate-SyntaxOnly.ps1'
)
$errorsFound=@()
foreach($relative in $paths){
 $file=Join-Path $root $relative
 $tokens=$null
 $errors=$null
 [void][System.Management.Automation.Language.Parser]::ParseFile(
  $file,[ref]$tokens,[ref]$errors
 )
 if($errors.Count -gt 0){
  $errorsFound+=($relative+' ('+$errors.Count+' parse errors)')
 }
}
[pscustomobject]@{
 source='PRINTSERVER_WINDOWS_PARSER_ONLY'
 files_checked=$paths.Count
 syntax_ok=($errorsFound.Count -eq 0)
 failure_paths=$errorsFound
 writes_performed=$false
 printer_accessed=$false
}|ConvertTo-Json -Compress
if($errorsFound.Count -gt 0){exit 1}
