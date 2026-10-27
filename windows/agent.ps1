#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$Once
)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
if([string]::IsNullOrWhiteSpace($ConfigPath)){
    $ConfigPath=Join-Path $PSScriptRoot 'config.local.json'
}

if(!(Test-Path -LiteralPath $ConfigPath)){throw 'config.local.json não encontrado.'}
$c=Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if($c.broker_url -notmatch '^https://[a-zA-Z0-9.-]+(?::443)?/?$'){throw 'broker_url exige origem HTTPS, sem path.'}
if($c.printer -cne 'LABEL' -or $c.paper -cne 'Etiqueta'){throw 'Fila e mídia devem ser LABEL/Etiqueta.'}
if($c.enable_printing -ne $true -or $c.calibration_confirmed_100x40 -ne $true){
    throw 'Impressão bloqueada: faltam ativação e homologação física 100x40.'
}
if(!(Test-Path -LiteralPath $c.secret_file) -or !(Test-Path -LiteralPath $c.sumatra_path)){
    throw 'Token ou SumatraPDF portátil não instalado.'
}
if(([string]$c.sumatra_path).Contains('"') -or ([string]$c.secret_file).Contains('"')){
    throw 'Caminho local contém aspas inválidas.'
}
$key=(Get-Content -LiteralPath $c.secret_file -Raw -Encoding UTF8).Trim()
if($key.Length -lt 32){throw 'Token de agente inválido.'}

# Capability is a driver promise, not a proof that the actual roll printed correctly.
$cfg=Get-PrintConfiguration -PrinterName 'LABEL' -ErrorAction Stop
[xml]$caps=$cfg.PrintCapabilitiesXML
$ns=New-Object System.Xml.XmlNamespaceManager($caps.NameTable)
$ns.AddNamespace('psf','http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
$ns.AddNamespace('psk','http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords')
$mediaOk=$false
foreach($option in $caps.SelectNodes("//psf:Feature[@name='psk:PageMediaSize']/psf:Option",$ns)){
    $display=$option.SelectSingleNode("./psf:Property[@name='psk:DisplayName']/psf:Value",$ns)
    $width=$option.SelectSingleNode("./psf:ScoredProperty[@name='psk:MediaSizeWidth']/psf:Value",$ns)
    $height=$option.SelectSingleNode("./psf:ScoredProperty[@name='psk:MediaSizeHeight']/psf:Value",$ns)
    if($display -and $width -and $height -and $display.InnerText -ceq 'Etiqueta' -and
        [math]::Abs([double]$width.InnerText-100000) -le 1100 -and
        [math]::Abs([double]$height.InnerText-40000) -le 1100){$mediaOk=$true;break}
}
if(!$mediaOk){throw 'O driver LABEL não anuncia Etiqueta 100x40; não imprimir.'}

$headers=@{Authorization='Bearer '+$key}
$origin=([string]$c.broker_url).TrimEnd('/')
$interval=5
if($null -ne $c.poll_seconds){$interval=[Math]::Max(3,[Math]::Min(60,[int]$c.poll_seconds))}
$workDir=Join-Path $env:LOCALAPPDATA 'EvydenciaPrintServer'
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

function ApiPost([string]$path,[hashtable]$body){
    Invoke-RestMethod -UseBasicParsing -Uri ($origin+$path) -Method Post -Headers $headers -ContentType 'application/json' -Body ($body|ConvertTo-Json -Compress) -TimeoutSec 20 -MaximumRedirection 0
}
function PrinterReady {
    try {
        $printer=Get-Printer -Name 'LABEL' -ErrorAction Stop
        return ($printer.PrinterStatus -eq 'Normal' -and (Get-Service Spooler).Status -eq 'Running')
    }catch{return $false}
}
function PrintPdf([string]$filename){
    # PowerShell 5.1 joins ArgumentList arrays; use one explicit string with quoted path.
    $settings='noscale,paper=Etiqueta,monochrome,1x,disable-auto-rotation,ignore-pdf-print-settings'
    $arguments='-print-to "LABEL" -print-settings "'+$settings+'" -silent "'+$filename+'"'
    try {
        $proc=Start-Process -FilePath $c.sumatra_path -ArgumentList $arguments -PassThru -WindowStyle Hidden
        if(!$proc.WaitForExit(90000)){
            try{$proc.Kill()}catch{}
            return 'unknown'  # The OS may already have spooled it; never auto-retry.
        }
        if($proc.ExitCode -eq 0){return 'spooled'}
        return 'failed'  # Known Sumatra non-zero exit; job requires manual re-evaluation.
    }catch{
        return 'unknown'
    }
}
do {
    try {
        # Avoid claiming a job that cannot be handed to the local spooler right now.
        if(PrinterReady){
            $answer=ApiPost '/v1/agent/claim' @{}
            if($null -ne $answer.job){
                $j=$answer.job
                if([string]$j.job_id -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' -or
                   [string]$j.lease_token -notmatch '^[0-9a-f]{64}$'){
                    # Corrupt claim cannot be ACKed safely; never attempt an arbitrary printer job.
                    throw 'Identificador do job ou lease invalido.'
                }
                $result='failed' # Failure before launching Sumatra means nothing was printed.
                $filename=Join-Path $workDir ([string]$j.job_id+'.pdf')
                try {
                    $bytes=[Convert]::FromBase64String([string]$j.pdf_base64)
                    # Canonical Natal artwork embeds the complete 1181x472 CRM PNG.
                    # Old 256 KiB cap incorrectly rejected valid PDF labels.
                    if($bytes.Length -lt 200 -or $bytes.Length -gt 5242880){
                        throw 'PDF fora do limite de 5 MiB.'
                    }
                    $shaAlgorithm=[Security.Cryptography.SHA256]::Create()
                    try {
                        $sha=[BitConverter]::ToString($shaAlgorithm.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
                    }finally{
                        $shaAlgorithm.Dispose()
                    }
                    if($sha -cne [string]$j.sha256){throw 'Checksum da etiqueta invalido.'}
                    # Header check is intentionally lightweight: broker already validates
                    # one-page 100x40 and the agent never executes the PDF.
                    if([Text.Encoding]::ASCII.GetString($bytes,0,5) -cne '%PDF-'){
                        throw 'Assinatura PDF invalida.'
                    }
                    [IO.File]::WriteAllBytes($filename,$bytes)
                    $result=PrintPdf $filename
                }catch{
                    # If the external print process has been launched but failed or timed out,
                    # PrintPdf returns unknown/failed instead of throwing. Never auto-retry.
                    $result='failed'
                    Write-Warning ('agent_job_validation_error_type='+$_.Exception.GetType().Name)
                }finally{
                    Remove-Item -LiteralPath $filename -Force -ErrorAction SilentlyContinue
                }
                # Always ACK a well-formed claimed job, even when its payload is invalid,
                # so it does not stay claimed until lease expiry. ACK errors stay unknown:
                # NEVER submit the same job again without reconciliation.
                ApiPost '/v1/agent/ack' @{
                    job_id=[string]$j.job_id
                    lease_token=[string]$j.lease_token
                    result=$result
                } | Out-Null
                Write-Output ('job='+[string]$j.job_id+' state='+$result)
            }
        }
    }catch{
        # Intentionally never log credentials, customer names, paths or PDF contents.
        Write-Warning ('agent_error_type='+$_.Exception.GetType().Name)
    }
    if(!$Once){Start-Sleep -Seconds $interval}
}while(!$Once)
