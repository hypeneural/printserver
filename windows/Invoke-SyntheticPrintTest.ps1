#requires -Version 5.1
<#
.SYNOPSIS
   Exactly one authorized synthetic 100x40 PDF submission to Windows queue LABEL.
   NO automatic retries, no driver modification, no CRM access, no task registration.
.EXAMPLE
   .\windows\Invoke-SyntheticPrintTest.ps1 -AuthorizeSinglePrint
#>
[CmdletBinding()]
param(
    [switch]$AuthorizeSinglePrint,
    [string]$PdfPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'test-output\test_synthetic_label.pdf'),
    [string]$SumatraPath='C:\Evydencia\printserver\SumatraPDF.exe'
)
$ErrorActionPreference='Stop'
if(!$AuthorizeSinglePrint){
    Write-Output 'NOT_EXECUTED: requer -AuthorizeSinglePrint para autorizar uma impressão física sintética.'
    return
}
if(!(Test-Path -LiteralPath $SumatraPath -PathType Leaf)){throw 'SumatraPDF não instalado/validado.'}
if(!(Test-Path -LiteralPath $PdfPath -PathType Leaf)){throw 'Fixture ausente. Execute node scripts/Create-SyntheticLabel.mjs.'}
if($PdfPath.Contains('"') -or $SumatraPath.Contains('"')){throw 'Caminho com aspas não suportado.'}
$printer=Get-Printer -Name 'LABEL' -ErrorAction Stop
if($printer.PrinterStatus -ne 'Normal' -or (Get-Service Spooler).Status -ne 'Running'){throw 'Fila ou spooler indisponível.'}
if($printer.DriverName -cne 'LABEL'){throw 'Driver da fila LABEL diferente do homologado.'}
$bytes=[IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $PdfPath).Path)
if($bytes.Length -lt 200 -or $bytes.Length -gt 262144){throw 'Arquivo sintético fora do intervalo permitido.'}
$pdf=[Text.Encoding]::GetEncoding('iso-8859-1').GetString($bytes)
if(!$pdf.StartsWith('%PDF-') -or
    !$pdf.Contains('HOMOLOGACAO SINTETICA') -or
    !$pdf.Contains('PEDIDO #999999') -or
    $pdf -notmatch '/MediaBox\s*\[\s*0\s+0\s+283\.465\s+113\.386\s*\]'){
    throw 'Fixture não é a etiqueta sintética de 100x40 esperada. Impressão recusada.'
}
$settings='noscale,paper=Etiqueta,monochrome,1x,disable-auto-rotation,ignore-pdf-print-settings'
$before=@(Get-PrintJob -PrinterName 'LABEL' -ErrorAction Stop).Count
$arguments='-print-to "LABEL" -print-settings "'+$settings+'" -silent "'+((Resolve-Path -LiteralPath $PdfPath).Path)+'"'
$state='unknown'
$exitCode=$null
try{
    $process=Start-Process -FilePath $SumatraPath -ArgumentList $arguments -PassThru -WindowStyle Hidden
    if(!$process.WaitForExit(60000)){
        try{$process.Kill()}catch{}
        $state='unknown'
    }else{
        $exitCode=$process.ExitCode
        if($exitCode -eq 0){$state='spooled'}
        elseif($exitCode -in @(2,3,4,5,6)){$state='failed'}
        else{$state='unknown'}
    }
}catch{
    $state='unknown'
}
$after=@(Get-PrintJob -PrinterName 'LABEL' -ErrorAction SilentlyContinue).Count
[pscustomobject]@{
    synthetic_order_id=999999
    printer='LABEL'
    paper_requested='Etiqueta 100x40'
    exit_code=$exitCode
    state=$state
    spooler_jobs_before=$before
    spooler_jobs_after=$after
    physical_print_verified=$false
    retry_automatic=$false
    next_action='Operador deve conferir UMA etiqueta física: largura, avanço e gap.'
} | ConvertTo-Json -Depth 3
if($state -ne 'spooled'){exit 1}
