#requires -Version 5.1
[CmdletBinding()]
param(
 [string]$ConfigPath=(Join-Path $PSScriptRoot 'config.local.json'),
 [switch]$Once
)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
if(!(Test-Path -LiteralPath $ConfigPath)){throw 'Arquivo local config.local.json não encontrado.'}
$c=Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if($c.broker_url -notmatch '^https://[a-zA-Z0-9.-]+(?::443)?/?$'){throw 'broker_url deve ser origem HTTPS sem path.'}
if($c.printer -cne 'LABEL' -or $c.paper -cne 'Etiqueta'){throw 'A fila e o papel devem ser LABEL/Etiqueta.'}
if($c.enable_printing -ne $true){throw 'Impressão desabilitada; altere enable_printing só após homologar teste físico.'}
if(!(Test-Path -LiteralPath $c.secret_file) -or !(Test-Path -LiteralPath $c.sumatra_path)){throw 'Credencial ou SumatraPDF não instalado.'}
$key=(Get-Content -LiteralPath $c.secret_file -Raw -Encoding UTF8).Trim()
if($key.Length -lt 32){throw 'Token de agente inválido.'}
$p=Get-Printer -Name 'LABEL' -ErrorAction Stop
if($p.PrinterStatus -ne 'Normal' -or (Get-Service Spooler).Status -ne 'Running'){throw 'Impressora LABEL ou spooler indisponível.'}
$headers=@{ Authorization='Bearer '+$key }
$origin=([string]$c.broker_url).TrimEnd('/')
$interval=5
if($null -ne $c.poll_seconds){$interval=[Math]::Max(3,[Math]::Min(60,[int]$c.poll_seconds))}
$workDir=Join-Path $env:LOCALAPPDATA 'EvydenciaPrintServer'
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
function ApiPost($path,$body){
 Invoke-RestMethod -Uri ($origin+$path) -Method Post -Headers $headers -ContentType 'application/json' -Body ($body|ConvertTo-Json -Compress) -TimeoutSec 20 -MaximumRedirection 0
}
do {
 try {
  $answer=ApiPost '/v1/agent/claim' @{}
  if($null -ne $answer.job){
   $j=$answer.job
   if([string]$j.job_id -notmatch '^[0-9a-fA-F-]{36}$'){throw 'Job ID inválido.'}
   $bytes=[Convert]::FromBase64String([string]$j.pdf_base64)
   if($bytes.Length -gt 262144 -or $bytes.Length -lt 15){throw 'Tamanho de PDF inválido.'}
   $sha=[BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
   if($sha -cne [string]$j.sha256){throw 'Checksum da etiqueta inválido.'}
   $filename=Join-Path $workDir ([string]$j.job_id+'.pdf')
   [IO.File]::WriteAllBytes($filename,$bytes)
   $result='failed'
   try {
    $settings='noscale,paper='+[string]$c.paper+',monochrome,1x,ignore-pdf-print-settings'
    $args=@('-print-to','"LABEL"','-print-settings','"'+$settings+'"','-silent','"'+$filename+'"')
    $p=Start-Process -FilePath $c.sumatra_path -ArgumentList $args -PassThru -Wait -WindowStyle Hidden
    if($p.ExitCode -eq 0){$result='spooled'}
   }finally{
    Remove-Item -LiteralPath $filename -Force -ErrorAction SilentlyContinue
   }
   # spooler acceptance is NOT proof the physical label came out.
   ApiPost '/v1/agent/ack' @{job_id=[string]$j.job_id;lease_token=[string]$j.lease_token;result=$result} | Out-Null
   Write-Output ('job='+[string]$j.job_id+' state='+$result)
  }
 }catch{
  # No payload, tokens, names or customer data in logs.
  Write-Warning ('agent_error_type='+$_.Exception.GetType().Name)
 }
 if(!$Once){Start-Sleep -Seconds $interval}
}while(!$Once)
