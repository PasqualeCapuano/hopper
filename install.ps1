# Installs the latest Hopper release on Windows.
#   irm https://raw.githubusercontent.com/PasqualeCapuano/hopper/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo = "PasqualeCapuano/hopper"
Write-Host "Cerco l'ultima versione di Hopper..."
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "*-setup.exe" } | Select-Object -First 1
if (-not $asset) { throw "Nessun installer trovato nell'ultima release." }

$out = Join-Path $env:TEMP $asset.name
Write-Host "Scarico $($asset.name)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $out

Write-Host "Installo..."
Start-Process $out -ArgumentList "/S" -Wait

Write-Host "Hopper installata. Premi Ctrl+Shift+Space per aprirla; le impostazioni sono nell'icona nella barra delle applicazioni."
