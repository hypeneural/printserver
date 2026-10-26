#requires -Version 5.1
<#
.SYNOPSIS
 Print ONE synthetic CRM Natal artwork label (background + QR) at 100x40mm.
 Running without -AuthorizeSinglePrint performs NO printing.
#>
[CmdletBinding()]
param(
  [switch]$AuthorizeSinglePrint,
  [string]$SumatraPath='C:\Evydencia\printserver\SumatraPDF.exe'
)
$ErrorActionPreference='Stop'
if(!$AuthorizeSinglePrint){
  Write-Output 'NOT_EXECUTED: synthetic CRM artwork requires -AuthorizeSinglePrint.'
  return
}
$root=Split-Path -Path $PSScriptRoot -Parent
$dir=Join-Path $root 'test-output'
$manifestPath=Join-Path $dir 'crm-label-natal-synthetic.manifest.json'
$pdfPath=Join-Path $dir 'crm-label-natal-synthetic.pdf'
if(!(Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
   !(Test-Path -LiteralPath $pdfPath -PathType Leaf) -or
   !(Test-Path -LiteralPath $SumatraPath -PathType Leaf)){
  throw 'Fixture CRM ou SumatraPDF nao esta disponivel.'
}
$m=Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
if($m.synthetic -ne $true -or $m.order_id -ne 999999 -or
   $m.physical_mm.Count -ne 2 -or $m.physical_mm[0] -ne 100 -or $m.physical_mm[1] -ne 40 -or
   $m.pdf_file -cne 'crm-label-natal-synthetic.pdf'){
  throw 'Manifesto da fixture sintetica inconsistente.'
}
$pdfSha=(Get-FileHash -LiteralPath $pdfPath -Algorithm SHA256).Hash.ToLowerInvariant()
if($pdfSha -cne [string]$m.pdf_sha256){throw 'Hash SHA256 da etiqueta diferente do manifesto.'}
$bytes=[IO.File]::ReadAllBytes($pdfPath)
if($bytes.Length -lt 200 -or $bytes.Length -gt 5000000){throw 'PDF fora dos limites.'}
$start=[Text.Encoding]::ASCII.GetString($bytes,0,[Math]::Min(640,$bytes.Length))
if(!$start.StartsWith('%PDF-1.4') -or !$start.Contains('/MediaBox [0 0 283.46457 113.38583]') -or
   !$start.Contains('/XObject')){
  throw 'PDF nao contem pagina e raster do CRM em 100x40.'
}
$printer=Get-Printer -Name 'LABEL' -ErrorAction Stop
if($printer.PrinterStatus -ne 'Normal' -or $printer.DriverName -cne 'LABEL' -or
   (Get-Service Spooler).Status -ne 'Running'){
  throw 'Fila LABEL ou spooler nao esta pronta.'
}
if($SumatraPath.Contains('"') -or $pdfPath.Contains('"')){throw 'Caminho inseguro.'}
$settings='noscale,paper=Etiqueta,monochrome,1x,disable-auto-rotation,ignore-pdf-print-settings'
$args='-print-to "LABEL" -print-settings "'+$settings+'" -silent "'+$pdfPath+'"'
$state='unknown';$exitCode=$null
try {
  $p=Start-Process -FilePath $SumatraPath -ArgumentList $args -PassThru -WindowStyle Hidden
  if(!$p.WaitForExit(60000)){
    try{$p.Kill()}catch{}
  }else{
    $exitCode=$p.ExitCode
    if($exitCode -eq 0){$state='spooled'}
    elseif($exitCode -in @(2,3,4,5,6)){$state='failed'}
  }
}catch{$state='unknown'}
[pscustomobject]@{
  synthetic_order_id=999999
  layout='CRM_NATAL_CANONICAL'
  media='Etiqueta'
  requested_copies=1
  state=$state
  sumatra_exit_code=$exitCode
  physical_print_verified=$false
  automatic_retry=$false
  next_action='Verificar UMA etiqueta fisica: moldura, fundo, QR, texto e gap do rolo.'
}|ConvertTo-Json -Depth 3
if($state -ne 'spooled'){exit 1}
