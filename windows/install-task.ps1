#requires -Version 5.1
[CmdletBinding(SupportsShouldProcess=$true)]
param([switch]$Uninstall)
$ErrorActionPreference='Stop'
$name='Evydencia - PrintServer LABEL'
if($Uninstall){
 if($PSCmdlet.ShouldProcess($name,'Desinstalar tarefa')){
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
 }
 return
}
$script=Join-Path $PSScriptRoot 'agent.ps1'
$config=Join-Path $PSScriptRoot 'config.local.json'
if(!(Test-Path $config)){throw 'Copie config.example.json para config.local.json e preencha as configurações.'}
$exe=Join-Path $PSHOME 'powershell.exe'
$arguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "'+$script+'" -ConfigPath "'+$config+'"'
$action=New-ScheduledTaskAction -Execute $exe -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
if($PSCmdlet.ShouldProcess($name,'Registrar tarefa de impressão (inicia no login)')){
 Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Fila LABEL via broker HTTPS. Sem portas de entrada.' -Force | Out-Null
 Write-Output 'Tarefa registrada. Só imprime quando enable_printing=true no config.local.json.'
}
