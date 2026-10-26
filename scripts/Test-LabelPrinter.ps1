#requires -Version 5.1
[CmdletBinding()]
param([string]$PrinterName='LABEL')
$ErrorActionPreference='Stop'
Import-Module PrintManagement -ErrorAction Stop
$p=Get-Printer -Name $PrinterName -ErrorAction Stop
$d=Get-PrinterDriver -Name $p.DriverName -ErrorAction Stop
$port=Get-PrinterPort -Name $p.PortName -ErrorAction Stop
$cfg=Get-PrintConfiguration -PrinterName $PrinterName -ErrorAction Stop
[xml]$caps=$cfg.PrintCapabilitiesXML
[xml]$ticket=$cfg.PrintTicketXML
$n=New-Object System.Xml.XmlNamespaceManager($caps.NameTable)
$n.AddNamespace('psf','http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
$n.AddNamespace('psk','http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords')
$matching=$false
foreach($option in $caps.SelectNodes("//psf:Feature[@name='psk:PageMediaSize']/psf:Option",$n)){
 $display=$option.SelectSingleNode("./psf:Property[@name='psk:DisplayName']/psf:Value",$n)
 $w=$option.SelectSingleNode("./psf:ScoredProperty[@name='psk:MediaSizeWidth']/psf:Value",$n)
 $h=$option.SelectSingleNode("./psf:ScoredProperty[@name='psk:MediaSizeHeight']/psf:Value",$n)
 if($display -and $display.InnerText -eq 'Etiqueta' -and $w -and $h -and
    [math]::Abs([double]$w.InnerText-100000) -lt 1100 -and
    [math]::Abs([double]$h.InnerText-40000) -lt 1100){$matching=$true}
}
$active=$ticket.SelectSingleNode("//psf:Feature[@name='psk:PageMediaSize']/psf:Option",$n)
[pscustomobject]@{
 computer=$env:COMPUTERNAME
 printer=$p.Name
 printer_state=[string]$p.PrinterStatus
 driver=$d.Name
 driver_version=$d.MajorVersion
 port=$p.PortName
 port_description=$port.Description
 spooler=(Get-Service Spooler).Status.ToString()
 active_paper_option=if($active){$active.GetAttribute('name')}else{$null}
 has_100x40_form=$matching
 pending_jobs=@(Get-PrintJob -PrinterName $PrinterName -ErrorAction Stop).Count
 physical_print_verified=$false
} | ConvertTo-Json -Depth 3
