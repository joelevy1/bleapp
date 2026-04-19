# Run EAS iOS build from Windows when upload fails (e.g. EPERM under Google Drive).
# Sets TEMP to C:\eas-cli-staging\tmp so eas-cli can clean its staging folder.
# Usage: .\eas-build-windows.ps1 [-Profile preview]

param(
    [ValidateSet('preview', 'production')]
    [string]$Profile = 'preview'
)

$ErrorActionPreference = 'Stop'
$stagingRoot = 'C:\eas-cli-staging'
$tmp = Join-Path $stagingRoot 'tmp'
if (-not (Test-Path $stagingRoot)) {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
}
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

$env:TMP = $tmp
$env:TEMP = $tmp

Set-Location $PSScriptRoot
Write-Host "TEMP=$env:TMP"
Write-Host "Running: eas build --platform ios --profile $Profile"
npx --yes eas-cli@latest build --platform ios --profile $Profile --non-interactive
