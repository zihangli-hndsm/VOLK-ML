$ErrorActionPreference = 'Stop'
$venvRoot = Join-Path $env:LOCALAPPDATA 'VOLK\venvs\g2-attention-exporter'
$python = Join-Path $venvRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  & py -3.12 -m venv $venvRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python 3.12 G2 export virtual environment.' }
}
& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Could not update pip in the G2 export virtual environment.' }
& $python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu --requirement (Join-Path $PSScriptRoot '..\tools\g2_attention\requirements-export.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned exporter packages.' }
Write-Output "G2 model exporter ready: $python"
