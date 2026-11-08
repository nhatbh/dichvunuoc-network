# The local-stack dev server (pnpm run dev:local-stack, port 4610), with its output also written
# to _sync_tmp\local-stack\dev-server.log so a failed start can be read afterwards.
$ErrorActionPreference = 'Continue'
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Log = Join-Path (Resolve-Path (Join-Path $AppDir '..\..\..')).Path '_sync_tmp\local-stack\dev-server.log'
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
Set-Content -Path $Log -Value "dev-server $(Get-Date -Format s)" -Encoding UTF8
$Host.UI.RawUI.WindowTitle = 'SYSTEM 3D - local stack (http://localhost:4610)'
Set-Location $AppDir
& pnpm run dev:local-stack 2>&1 | ForEach-Object {
  $line = "$_"
  Add-Content -Path $Log -Value $line -Encoding UTF8
  Write-Host $line
}
Write-Host ''
Write-Host "The dev server stopped. Output is in $Log" -ForegroundColor Yellow
