$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'ElysiaDesktopPetWin.cs'
$out = Join-Path $root 'assets\desktop\ElysiaDesktopPet.exe'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    throw "找不到 csc.exe：$csc"
}

$refs = @(
    'System.Windows.Forms.dll',
    'System.Drawing.dll',
    'System.Web.Extensions.dll',
    'System.Net.Http.dll'
)
$speech = Join-Path ${env:ProgramFiles(x86)} 'Reference Assemblies\Microsoft\Framework\v3.0\System.Speech.dll'
if (-not (Test-Path $speech)) {
    throw "找不到 System.Speech.dll：$speech"
}
$refs += $speech

& $csc /nologo /target:winexe /out:$out ($refs | ForEach-Object { "/r:$_" }) $source
if ($LASTEXITCODE -ne 0) { throw "csc 失败，退出码 $LASTEXITCODE" }
Write-Host "built $out"
