[CmdletBinding()]
param(
  [string]$TargetUserSid
)

$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'rea-launcher.ps1'
$powerShell = Join-Path $PSHOME 'pwsh.exe'
if (-not (Test-Path -LiteralPath $powerShell)) { $powerShell = 'powershell.exe' }

$classesRoot = if ($TargetUserSid) {
  [Microsoft.Win32.Registry]::Users.CreateSubKey("${TargetUserSid}_Classes")
} else {
  [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes')
}
$protocol = $classesRoot.CreateSubKey('rea')
$protocol.SetValue('', 'URL:REA local launcher', [Microsoft.Win32.RegistryValueKind]::String)
$protocol.SetValue('URL Protocol', '', [Microsoft.Win32.RegistryValueKind]::String)
$commandKey = $protocol.CreateSubKey('shell\open\command')
$command = '"{0}" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" "%1"' -f $powerShell, $launcher
$commandKey.SetValue('', $command, [Microsoft.Win32.RegistryValueKind]::String)
$commandKey.Close()
$protocol.Close()
$classesRoot.Close()

Write-Output "Registered rea:// launcher for ${TargetUserSid}"
