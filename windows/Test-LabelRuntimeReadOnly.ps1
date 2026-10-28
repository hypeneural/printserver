#requires -Version 5.1
<#
.SYNOPSIS
  Inspect a Windows 11 LABEL queue without printing or exposing customer data.
  Uses Microsoft PrintManagement and ScheduledTasks cmdlets only.
  Does NOT invoke the agent, SumatraPDF, the broker, or modify any service.
#>
[CmdletBinding()]
param(
    [string]$PrinterName='LABEL',
    [string]$ExpectedPort='USB001',
    [string]$TaskName='Evydencia - PrintServer LABEL'
)
$ErrorActionPreference='Stop'
$report=[ordered]@{
    source='PRINTSERVER_WINDOWS_READ_ONLY_DIAGNOSTIC'
    printer_present=$false
    spooler_running=$false
    printer_status='unknown'
    port_expected=$false
    media_100x40_advertised=$false
    jobs_in_spooler=$null
    task_registered=$false
    task_state='unknown'
    last_task_result=$null
    ok=$false
    writes_performed=$false
    agent_invoked=$false
    print_submitted=$false
}
try {
    $service=Get-Service -Name 'Spooler' -ErrorAction Stop
    $report.spooler_running=($service.Status -eq 'Running')
    $printer=Get-Printer -Name $PrinterName -ErrorAction Stop
    $report.printer_present=$true
    $report.printer_status=[string]$printer.PrinterStatus
    $report.port_expected=([string]$printer.PortName -eq $ExpectedPort)
    # Never print job documents, names or owners.
    $jobs=@(Get-PrintJob -PrinterName $PrinterName -ErrorAction Stop)
    $report.jobs_in_spooler=$jobs.Count
    $config=Get-PrintConfiguration -PrinterName $PrinterName -ErrorAction Stop
    if(-not [string]::IsNullOrWhiteSpace([string]$config.PrintCapabilitiesXML)) {
        [xml]$caps=$config.PrintCapabilitiesXML
        $ns=New-Object System.Xml.XmlNamespaceManager($caps.NameTable)
        $ns.AddNamespace('psf','http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
        foreach($option in $caps.SelectNodes("//psf:Feature[contains(@name,'PageMediaSize')]/psf:Option",$ns)) {
            $display=$option.SelectSingleNode("./psf:Property[contains(@name,'DisplayName')]/psf:Value",$ns)
            $width=$option.SelectSingleNode("./psf:ScoredProperty[contains(@name,'MediaSizeWidth')]/psf:Value",$ns)
            $height=$option.SelectSingleNode("./psf:ScoredProperty[contains(@name,'MediaSizeHeight')]/psf:Value",$ns)
            if($display -and $width -and $height -and $display.InnerText -ceq 'Etiqueta' -and
               [math]::Abs([double]$width.InnerText-100000) -le 1100 -and
               [math]::Abs([double]$height.InnerText-40000) -le 1100) {
                $report.media_100x40_advertised=$true
                break
            }
        }
    }
    $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if($null -ne $task) {
        $report.task_registered=$true
        $report.task_state=[string]$task.State
        $info=$task | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
        if($null -ne $info){$report.last_task_result=[int64]$info.LastTaskResult}
    } else {
        $report.task_state='not_found'
    }
    $report.ok=($report.spooler_running -and $report.printer_present -and
                $report.port_expected -and $report.media_100x40_advertised -and
                $report.task_registered)
    [pscustomobject]$report | ConvertTo-Json -Compress
    if(-not $report.ok){exit 2}
}catch{
    # Never output exception.Message; it may expose a print job or local path.
    $report.error_class=$_.Exception.GetType().Name
    [pscustomobject]$report | ConvertTo-Json -Compress
    exit 1
}
