$ErrorActionPreference = 'Stop'
$venvRoot = Join-Path $env:LOCALAPPDATA 'VOLK\venvs\g2-imported-attention'
$python = Join-Path $venvRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  & py -3.12 -m venv $venvRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python 3.12 G2 virtual environment.' }
}
& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Could not update pip in the G2 virtual environment.' }
& $python -m pip install --requirement (Join-Path $PSScriptRoot '..\tools\g2_attention\requirements-runtime.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned local runtime packages.' }
Write-Output "VOLK_G2_PYTHON=$python"
