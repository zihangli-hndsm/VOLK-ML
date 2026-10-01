param()

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or [Environment]::Is64BitOperatingSystem -ne $true) {
  throw 'H2 v1 requires 64-bit Windows.'
}

$lockPath = Join-Path $PSScriptRoot '..\tools\h2_local_python\runtime-lock.json'
$requirementsPath = Join-Path $PSScriptRoot '..\tools\h2_local_python\requirements-win-py312.lock'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) { throw 'LOCALAPPDATA is unavailable.' }
$root = Join-Path $localAppData 'VOLK\h2-local-python-v1'
$artifactRoot = Join-Path $localAppData 'VOLK\artifacts\h2-local-python-v1'
$runtimeRoot = Join-Path $root 'python-3.12.10'
$stageRoot = Join-Path (Join-Path $root 'staging') ('h2-' + [Guid]::NewGuid().ToString('N'))
$pythonPath = Join-Path $runtimeRoot 'python.exe'
$expectedPackages = @{
  pip = '26.2.1'
  torch = '2.14.0+cpu'
  numpy = '2.5.3'
}

function Assert-OfficialUrl([string]$url, [string[]]$allowedHosts) {
  $uri = [Uri]$url
  if ($uri.Scheme -ne 'https' -or $uri.Host -notin $allowedHosts) {
    throw 'The pinned H2 artifact URL is outside the approved official hosts.'
  }
}

function Assert-Hash([string]$path, [string]$expected) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'A pinned H2 artifact is missing.' }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) { throw 'A pinned H2 artifact failed SHA-256 verification.' }
}

function Get-PinnedArtifact([string]$name, [string]$url, [string]$sha256, [string[]]$hosts) {
  if ([IO.Path]::GetFileName($name) -ne $name -or $name -match '[\\/]') { throw 'The H2 artifact name is invalid.' }
  Assert-OfficialUrl $url $hosts
  $path = Join-Path $artifactRoot $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    Invoke-WebRequest -Uri $url -OutFile $path
  }
  Assert-Hash $path $sha256
  return $path
}

function Invoke-AppPython([string]$interpreter, [string[]]$arguments) {
  $output = & $interpreter @arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'The app-local H2 Python runtime verification failed.' }
  return ($output -join "`n")
}

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
New-Item -ItemType Directory -Path $root -Force | Out-Null

if (Test-Path -LiteralPath $runtimeRoot -PathType Container) {
  if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    throw 'The versioned H2 runtime directory exists but is incomplete; it was preserved for inspection.'
  }
  $versions = Invoke-AppPython $pythonPath @('-c', 'import numpy,torch,sys; print("|".join((sys.version.split()[0], torch.__version__, numpy.__version__)))')
  if ($versions.Trim() -ne '3.12.10|2.14.0+cpu|2.5.3') { throw 'The app-local runtime versions do not match the frozen H2 lock.' }
  Invoke-AppPython $pythonPath @('-m', 'pip', 'check') | Out-Null
  Write-Output "VOLK_H2_PYTHON=$pythonPath"
  exit 0
}

$pythonArtifact = Get-PinnedArtifact $lock.python.artifact $lock.python.url $lock.python.sha256 @('www.python.org')
foreach ($package in $lock.packages) {
  $hostAllowlist = if ($package.name -eq 'torch') { @('download.pytorch.org') } else { @('files.pythonhosted.org') }
  Get-PinnedArtifact $package.artifact $package.url $package.sha256 $hostAllowlist | Out-Null
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
$stageRuntime = Join-Path $stageRoot 'python-3.12.10'
New-Item -ItemType Directory -Path $stageRuntime -Force | Out-Null
Expand-Archive -LiteralPath $pythonArtifact -DestinationPath $stageRuntime
New-Item -ItemType Directory -Path (Join-Path $stageRuntime 'Lib\site-packages') -Force | Out-Null

$pythonPth = Join-Path $stageRuntime 'python312._pth'
@('python312.zip', '.', 'pip-26.2.1-py3-none-any.whl') | Set-Content -LiteralPath $pythonPth -Encoding ascii
$bootstrapPip = Join-Path $artifactRoot 'pip-26.2.1-py3-none-any.whl'
$runtimePip = Join-Path $stageRuntime 'pip-26.2.1-py3-none-any.whl'
Copy-Item -LiteralPath $bootstrapPip -Destination $runtimePip
$sitePackages = Join-Path $stageRuntime 'Lib\site-packages'
$installOutput = & (Join-Path $stageRuntime 'python.exe') -m pip install --no-index --no-deps --only-binary=:all: --require-hashes --ignore-installed --find-links $artifactRoot --target $sitePackages -r $requirementsPath 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Offline hash-locked H2 package installation failed; staged files were preserved.' }
Remove-Item -LiteralPath $runtimePip
@('python312.zip', '.', 'Lib\site-packages') | Set-Content -LiteralPath $pythonPth -Encoding ascii

$stagePython = Join-Path $stageRuntime 'python.exe'
$versions = Invoke-AppPython $stagePython @('-c', 'import numpy,torch,sys; print("|".join((sys.version.split()[0], torch.__version__, numpy.__version__)))')
if ($versions.Trim() -ne '3.12.10|2.14.0+cpu|2.5.3') { throw 'The staged app-local H2 runtime failed pinned version verification.' }
Invoke-AppPython $stagePython @('-m', 'pip', 'check') | Out-Null

Move-Item -LiteralPath $stageRuntime -Destination $runtimeRoot
Write-Output "VOLK_H2_PYTHON=$pythonPath"
