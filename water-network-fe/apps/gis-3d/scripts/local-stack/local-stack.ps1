<#
.SYNOPSIS
  Runs SYSTEM 3D against the real backend services on this machine (Phase 0 gate).

.DESCRIPTION
  1. Backend (Docker): postgres, redis, rabbitmq, jaeger, gis-be, asset-be, design-be, BFF and the local
     app-catalog stand-in (water-network-be\docker-compose.local.yml). Database migrations run
     once before the services start.
  2. Seeds gis-be with the demo network when it is empty (scripts\local-stack\seed.mjs).
  3. Rebuilds the shared packages and starts the app with `pnpm run dev:local-stack`
     (http://localhost:4600, canonical data source, /api/gis proxied to the BFF).
  4. Gate check: signs in, opens the map, and checks /bootstrap and /map came from the BFF
     with data (scripts\local-stack\smoke.mjs). Report + screenshot: _sync_tmp\local-stack\.

  The backend keeps running afterwards; the app runs in its own window.
  Stop everything:  local-stack.ps1 -Down

.PARAMETER Down       Stop the app window's dev server and `docker compose down` the backend.
.PARAMETER Reset      With the start: drop the database volume first (fresh, re-seeded data).
.PARAMETER NoBuild    Do not rebuild the backend images.
.PARAMETER SkipSmoke  Do not run the gate check.
#>
[CmdletBinding()]
param([switch]$Down, [switch]$Reset, [switch]$NoBuild, [switch]$SkipSmoke)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$AppDir   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path            # apps\gis-3d
$FeRoot   = (Resolve-Path (Join-Path $AppDir '..\..')).Path                    # water-network-fe
$RepoRoot = (Resolve-Path (Join-Path $FeRoot '..')).Path                       # monorepo
$BeRoot   = Join-Path $RepoRoot 'water-network-be'
$OutDir   = Join-Path $RepoRoot '_sync_tmp\local-stack'
$LogFile  = Join-Path $OutDir 'local-stack.log'
$Compose  = @('compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.local.yml')
$Infra    = @('postgres', 'redis', 'rabbitmq', 'jaeger')
$Services = @('water-network-gis-be', 'water-network-asset-be', 'water-network-design-be', 'dev-app-catalog', 'water-network-bff')

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Set-Content -Path $LogFile -Value "local-stack $(Get-Date -Format s)" -Encoding UTF8

function Step([string]$msg) { Write-Host "`n[*] $msg" -ForegroundColor Cyan; Add-Content $LogFile "`r`n### $msg" }
function Fail([string]$msg) { Write-Host "[X] $msg" -ForegroundColor Red; Add-Content $LogFile "FAIL: $msg"; exit 1 }
function Run([string]$exe, [string[]]$argv, [string]$cwd) {
  Add-Content $LogFile "> $exe $($argv -join ' ')  (in $cwd)"
  Push-Location $cwd
  try {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & $exe @argv 2>&1 | ForEach-Object {
      $line = "$_"
      Add-Content -Path $LogFile -Value $line -Encoding UTF8
      Write-Host $line
    }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
  } finally { Pop-Location }
  return $code
}
function Wait-Http([string]$url, [int]$seconds, [hashtable]$headers = @{}) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $url -Headers $headers
      if ($r.StatusCode -lt 500) { return $true }
    } catch {
      $resp = $_.Exception.Response
      if ($resp -and [int]$resp.StatusCode -lt 500) { return $true }
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

foreach ($tool in 'docker', 'node', 'pnpm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is not installed or not on PATH." }
}

if ($Down) {
  Step 'Stopping the app dev server (port 4600)'
  Get-NetTCPConnection -LocalPort 4600 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Step 'docker compose down'
  Run 'docker' ($Compose + @('down')) $BeRoot | Out-Null
  exit 0
}

$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& docker info *> $null
$dockerOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prev
if (-not $dockerOk) { Fail 'Docker is not running. Start Docker Desktop and try again.' }

# -- 1. backend ---------------------------------------------------------------------------------
if ($Reset) {
  Step 'Reset: removing the backend containers and database volume'
  Run 'docker' ($Compose + @('down', '-v')) $BeRoot | Out-Null
}
Step 'Starting infrastructure (postgres, redis, rabbitmq, jaeger)'
if ((Run 'docker' ($Compose + @('up', '-d', '--wait') + $Infra) $BeRoot) -ne 0) { Fail 'infrastructure did not start - see local-stack.log' }

if (-not $NoBuild) {
  Step 'Building backend images (first time takes several minutes)'
  if ((Run 'docker' ($Compose + @('build') + @('water-network-gis-be', 'water-network-asset-be', 'water-network-design-be', 'water-network-bff')) $BeRoot) -ne 0) { Fail 'image build failed - see local-stack.log' }
}

Step 'Applying database migrations (gis-be, asset-be, design-be)'
foreach ($svc in 'water-network-gis-be', 'water-network-asset-be', 'water-network-design-be') {
  if ((Run 'docker' ($Compose + @('run', '--rm', '--no-deps', $svc, '--migrate')) $BeRoot) -ne 0) { Fail "$svc migrations failed - see local-stack.log" }
}

Step 'Starting gis-be, asset-be, design-be, BFF'
if ((Run 'docker' ($Compose + @('up', '-d') + $Services) $BeRoot) -ne 0) { Fail 'services did not start - see local-stack.log' }
if (-not (Wait-Http 'http://localhost:8081/health' 120)) { Fail 'gis-be is not healthy on :8081 (docker compose logs water-network-gis-be)' }
if (-not (Wait-Http 'http://localhost:8083/health' 120)) { Fail 'BFF is not healthy on :8083 (docker compose logs water-network-bff)' }
Write-Host '    gis-be :8081, BFF :8083 healthy'

# -- 2. frontend packages + seed -----------------------------------------------------------------
if (-not (Test-Path (Join-Path $AppDir 'node_modules\.bin\vite.cmd'))) {
  Fail 'The app is not installed yet. Run water-network-fe\install-gis-3d.cmd once, then run this again.'
}
Step 'Building the shared packages'
foreach ($p in 'contracts', 'component-models', 'map-runtime', 'map-runtime-3d') {
  if ((Run 'pnpm' @('run', 'build') (Join-Path $FeRoot "packages\$p")) -ne 0) { Fail "building packages\$p failed - see local-stack.log" }
}

Step 'Seeding gis-be with the demo network (skipped when it already has data)'
if ((Run 'node' @('scripts/local-stack/seed.mjs', '--gis', 'http://localhost:8081') $AppDir) -ne 0) { Fail 'seeding failed - see local-stack.log' }

# -- 3. app --------------------------------------------------------------------------------------
Step 'Starting SYSTEM 3D on http://localhost:4600 (local-stack mode) in a new window'
$listening = Get-NetTCPConnection -LocalPort 4600 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Host '    port 4600 is already in use - assuming the dev server is running (use -Down to stop it)' -ForegroundColor Yellow
} else {
  Start-Process -FilePath 'cmd.exe' -WorkingDirectory $AppDir -ArgumentList '/k', 'title SYSTEM 3D - local stack & pnpm run dev:local-stack'
}
if (-not (Wait-Http 'http://localhost:4600/' 90)) { Fail 'the app dev server did not come up on :4600' }

# -- 4. gate check -------------------------------------------------------------------------------
if (-not $SkipSmoke) {
  Step 'Phase 0 gate check (browser: sign in, open the map)'
  Run 'pnpm' @('exec', 'playwright', 'install', 'chromium') $AppDir | Out-Null
  $code = Run 'node' @('scripts/local-stack/smoke.mjs', '--app', 'http://localhost:4600', '--out', $OutDir) $AppDir
  if ($code -ne 0) { Write-Host "[!] Gate check did not pass - see $OutDir\report.json and map.png" -ForegroundColor Yellow }
  else { Write-Host "[OK] Gate check passed - report and screenshot in $OutDir" -ForegroundColor Green }
}

Write-Host ''
Write-Host 'SYSTEM 3D (real backend): http://localhost:4600   sign in: demo@example.com / password123'
Write-Host 'BFF: http://localhost:8083   gis-be: http://localhost:8081   Jaeger: http://localhost:16686'
Write-Host 'Stop everything: run this again with -Down'
Start-Process 'http://localhost:4600' | Out-Null
exit 0
