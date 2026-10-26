#requires -Version 5.1
<#
.SYNOPSIS
  Prepares a pinned official SumatraPDF portable binary ONLY with -Install.
  Default invocation is read-only and does not download anything.
.NOTES
  SHA256 is independently cross-referenced with ScoopInstaller/Extras manifest,
  NOT published as a first-party signed checksum by SumatraPDF.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [string]$Destination='C:\Evydencia\printserver'
)
$ErrorActionPreference='Stop'
$version='3.6.1'
$sha256='98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544'
$url='https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip'
$target=Join-Path $Destination 'SumatraPDF.exe'
if(!$Install){
    [pscustomobject]@{
        install_requested=$false
        version=$version
        official_download=$url
        expected_sha256=$sha256
        destination=$target
        binary_exists=(Test-Path -LiteralPath $target)
        writes_performed=$false
    } | ConvertTo-Json -Depth 3
    return
}
if(Test-Path -LiteralPath $target){
    throw 'SumatraPDF.exe já existe. Não sobrescrever o executável sem auditoria manual.'
}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$tmp=Join-Path $env:TEMP ('sumatra-verified-'+[guid]::NewGuid().ToString('N'))
$zip=Join-Path $tmp 'sumatra.zip'
$extract=Join-Path $tmp 'extract'
try{
    New-Item -ItemType Directory -Path $tmp,$extract -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip -TimeoutSec 60 -MaximumRedirection 4
    $found=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if($found -cne $sha256){
        throw 'SHA256 incorreto. Pacote rejeitado. Não executar o binário.'
    }
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
    $binaries=@(Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'SumatraPDF*.exe')
    if($binaries.Count -ne 1){throw 'Conteúdo inesperado no pacote portátil.'}
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -LiteralPath $binaries[0].FullName -Destination $target -ErrorAction Stop
    [pscustomobject]@{
        installed=$true
        version=$version
        verified_zip_sha256=$found
        executable=$target
        authenticode_status=[string](Get-AuthenticodeSignature -FilePath $target).Status
        physical_print_performed=$false
    } | ConvertTo-Json -Depth 3
}finally{
    Remove-Item -LiteralPath $tmp -Force -Recurse -ErrorAction SilentlyContinue
}
