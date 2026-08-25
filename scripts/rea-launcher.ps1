[CmdletBinding()]
param(
  [string]$Uri
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $projectRoot 'start-rea.cmd'
$healthUri = 'http://127.0.0.1:18787/health'

try {
  Invoke-WebRequest -Uri $healthUri -UseBasicParsing -TimeoutSec 2 | Out-Null
  exit 0
} catch {
  # The REA service is not ready, so start one local instance below.
}

if (-not (Test-Path -LiteralPath $startScript -PathType Leaf)) {
  throw "REA start script was not found: $startScript"
}

Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', "`"$startScript`"") -WorkingDirectory $projectRoot -WindowStyle Hidden
