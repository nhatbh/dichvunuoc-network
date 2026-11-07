<#
.SYNOPSIS
  Sets up the .NET backend on this machine: SDK, package restore, build, tests, the BFF OpenAPI
  document, and an offline package feed so the same build can run where NuGet is not reachable.

.DESCRIPTION
  Run from anywhere:  water-network-be\scripts\setup-backend.cmd   (or this .ps1)

  Steps (each one logs to _sync_tmp\backend\setup.log; a one-screen result goes to summary.txt):
    1. .NET 10 SDK   - installs it with winget when missing (asks first unless -Yes).
    2. Restore       - every solution, into a repo-local package folder (water-network-be\.nuget\packages).
    3. Build         - every solution, warnings as errors (as CI does).
    4. Tests         - unit + contract tests; integration tests only when Docker is running.
    5. OpenAPI       - starts the BFF briefly and saves /openapi/v1.json to
                       water-network-fe\packages\contracts\openapi\bff.v1.json.
    6. Offline feed  - copies every restored .nupkg into one flat folder and zips it to
                       _sync_tmp\backend\nuget-feed.tgz (split into parts if it is large).
    7. -StartStack   - optional: docker compose up the backend stack and wait for it to be healthy.

.PARAMETER Yes         Do not ask before installing the SDK.
.PARAMETER SkipTests   Skip step 4.
.PARAMETER SkipOpenApi Skip step 5.
.PARAMETER SkipFeed    Skip step 6.
.PARAMETER StartStack  Run step 7.
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$SkipTests,
  [switch]$SkipOpenApi,
  [switch]$SkipFeed,
  [switch]$StartStack
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# -- paths ----------------------------------------------------------------------
$BeRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path          # water-network-be
$RepoRoot = (Resolve-Path (Join-Path $BeRoot '..')).Path               # water-network (monorepo)
$FeRoot   = Join-Path $RepoRoot 'water-network-fe'
$OutDir   = Join-Path $RepoRoot '_sync_tmp\backend'
$Packages = Join-Path $BeRoot '.nuget\packages'
$LogFile  = Join-Path $OutDir 'setup.log'
$Summary  = Join-Path $OutDir 'summary.txt'

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path $Packages | Out-Null
Set-Content -Path $LogFile -Value "setup-backend $(Get-Date -Format s)`r`nrepo: $RepoRoot`r`n" -Encoding UTF8
Set-Content -Path $Summary -Value "Backend setup - $(Get-Date -Format 'yyyy-MM-dd HH:mm')`r`n" -Encoding UTF8

# every dotnet call in this session restores into / reads from the repo-local folder
$env:NUGET_PACKAGES = $Packages
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

function Log([string]$msg) {
  Write-Host $msg
  Add-Content -Path $LogFile -Value $msg -Encoding UTF8
}
function Result([string]$step, [string]$status, [string]$detail = '') {
  $line = '{0,-14} {1,-5} {2}' -f $step, $status, $detail
  $color = 'Green'
  if ($status -eq 'FAIL') { $color = 'Red' } elseif ($status -ne 'OK') { $color = 'Yellow' }
  Write-Host $line -ForegroundColor $color
  Add-Content -Path $Summary -Value $line -Encoding UTF8
  Add-Content -Path $LogFile -Value "== $line" -Encoding UTF8
}
# Runs a native command, tees its output to the log, returns @{ Code; Lines }.
function Run([string]$exe, [string[]]$argv, [string]$cwd = $BeRoot) {
  Log "> $exe $($argv -join ' ')"
  Push-Location $cwd
  try {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $lines = & $exe @argv 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
  } finally { Pop-Location }
  if ($lines) { Add-Content -Path $LogFile -Value $lines -Encoding UTF8 }
  return @{ Code = $code; Lines = @($lines) }
}

$failed = $false

# -- 1. SDK ---------------------------------------------------------------------
Log "`r`n### 1. .NET SDK"
function Find-Dotnet {
  $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $pf = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
  if (Test-Path $pf) { return $pf }
  return $null
}
function Has-Sdk10([string]$exe) {
  if (-not $exe) { return $false }
  $sdks = & $exe --list-sdks 2>$null
  return [bool]($sdks | Where-Object { $_ -match '^10\.' })
}

$Dotnet = Find-Dotnet
if (-not (Has-Sdk10 $Dotnet)) {
  Log '.NET 10 SDK not found.'
  $ok = $Yes
  if (-not $ok) { $ok = (Read-Host 'Install the .NET 10 SDK with winget now? [y/N]') -match '^[yY]' }
  if (-not $ok) { Result 'sdk' 'FAIL' 'no .NET 10 SDK (install it, or rerun with -Yes)'; exit 1 }
  $r = Run 'winget' @('install', '--id', 'Microsoft.DotNet.SDK.10', '-e', '--accept-package-agreements', '--accept-source-agreements')
  $Dotnet = Find-Dotnet
  if (-not (Has-Sdk10 $Dotnet)) { Result 'sdk' 'FAIL' 'winget install did not provide a .NET 10 SDK - see setup.log'; exit 1 }
}
$sdkLine = (& $Dotnet --version)
Result 'sdk' 'OK' "dotnet $sdkLine ($Dotnet)"
Run $Dotnet @('--info') | Out-Null

$Solutions = @(
  'WaterPlatform.BuildingBlocks.slnx',
  'src\services\water-network-gis-be\WaterNetwork.Gis.slnx',
  'src\services\water-network-asset-be\WaterNetwork.Asset.slnx',
  'src\services\water-network-design-be\WaterNetwork.Design.slnx',
  'src\services\water-network-incident-be\WaterNetwork.Incident.slnx',
  'src\services\water-network-bff\WaterNetwork.Bff.slnx'
) | Where-Object { Test-Path (Join-Path $BeRoot $_) }

# -- 2. restore -----------------------------------------------------------------
Log "`r`n### 2. Restore"
$bad = @()
foreach ($s in $Solutions) {
  $r = Run $Dotnet @('restore', $s)
  if ($r.Code -ne 0) { $bad += $s }
}
if ($bad.Count) { Result 'restore' 'FAIL' ($bad -join ', '); $failed = $true }
else { Result 'restore' 'OK' "$($Solutions.Count) solutions -> $Packages" }

# -- 3. build -------------------------------------------------------------------
Log "`r`n### 3. Build"
$bad = @()
foreach ($s in $Solutions) {
  $r = Run $Dotnet @('build', $s, '--no-restore', '-c', 'Debug', '-v', 'minimal')
  if ($r.Code -ne 0) {
    $bad += $s
    $r.Lines | Where-Object { $_ -match ': error ' } | Select-Object -First 5 | ForEach-Object { Add-Content $Summary "    $_" }
  }
}
if ($bad.Count) { Result 'build' 'FAIL' ($bad -join ', '); $failed = $true }
else { Result 'build' 'OK' "$($Solutions.Count) solutions" }

# -- 4. tests -------------------------------------------------------------------
if ($SkipTests) { Result 'tests' 'SKIP' '-SkipTests' }
else {
  Log "`r`n### 4. Tests"
  $docker = $false
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & docker info *> $null
    $docker = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prev
  }
  Log "docker running: $docker"
  $projects = Get-ChildItem -Path (Join-Path $BeRoot 'src') -Recurse -Filter '*Tests.csproj' |
    Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } | Sort-Object Name
  $pass = 0; $fail = 0; $skipped = @(); $failedProjects = @()
  foreach ($p in $projects) {
    if ($p.Name -match 'IntegrationTests' -and -not $docker) { $skipped += $p.BaseName; continue }
    $r = Run $Dotnet @('test', $p.FullName, '--no-build', '-v', 'quiet', '--nologo')
    $counts = $r.Lines | Where-Object { $_ -match '(Passed|Failed)!\s+-\s+Failed:' } | Select-Object -Last 1
    $line = '    {0,-55} {1}' -f $p.BaseName, ($(if ($counts) { $counts.Trim() } else { "exit $($r.Code)" }))
    Add-Content -Path $Summary -Value $line -Encoding UTF8
    if ($counts -match 'Passed:\s+(\d+)') { $pass += [int]$Matches[1] }
    if ($counts -match 'Failed:\s+(\d+)') { $fail += [int]$Matches[1] }
    if ($r.Code -ne 0) { $failedProjects += $p.BaseName }
  }
  $detail = "passed $pass, failed $fail"
  if ($skipped.Count) { $detail += "; skipped (no Docker): $($skipped -join ', ')" }
  if ($failedProjects.Count) { Result 'tests' 'FAIL' "$detail; failing: $($failedProjects -join ', ')"; $failed = $true }
  else { Result 'tests' 'OK' $detail }
}

# -- 5. BFF OpenAPI -------------------------------------------------------------
if ($SkipOpenApi) { Result 'openapi' 'SKIP' '-SkipOpenApi' }
else {
  Log "`r`n### 5. BFF OpenAPI"
  $bffBin = Join-Path $BeRoot 'src\services\water-network-bff\src\WaterNetwork.Bff.Api\bin\Debug\net10.0'
  $bffDll = Join-Path $bffBin 'WaterNetwork.Bff.Api.dll'
  $target = Join-Path $FeRoot 'packages\contracts\openapi\bff.v1.json'
  if (-not (Test-Path $bffDll)) { Result 'openapi' 'FAIL' 'BFF not built'; $failed = $true }
  else {
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:ASPNETCORE_URLS = 'http://127.0.0.1:5199'
    $stdout = Join-Path $OutDir 'bff.out.log'; $stderr = Join-Path $OutDir 'bff.err.log'
    $proc = Start-Process -FilePath $Dotnet -ArgumentList "`"$bffDll`"" -WorkingDirectory $bffBin `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -NoNewWindow
    $doc = $null
    for ($i = 0; $i -lt 40 -and -not $doc; $i++) {
      Start-Sleep -Milliseconds 750
      if ($proc.HasExited) { break }
      try { $doc = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Headers @{ 'X-Tenant-Id' = 'local-dev' } -Uri 'http://127.0.0.1:5199/openapi/v1.json').Content } catch { }
    }
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    Remove-Item Env:ASPNETCORE_URLS -ErrorAction SilentlyContinue
    if ($doc) {
      New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
      [IO.File]::WriteAllText($target, $doc, (New-Object Text.UTF8Encoding($false)))
      $paths = 0
      try { $paths = @((ConvertFrom-Json $doc).paths.PSObject.Properties).Count } catch { }
      Result 'openapi' 'OK' "$paths paths -> $target"
    } else {
      Result 'openapi' 'FAIL' 'BFF did not serve /openapi/v1.json - see bff.out.log / bff.err.log'
      $failed = $true
    }
  }
}

# -- 6. offline feed ------------------------------------------------------------
if ($SkipFeed) { Result 'feed' 'SKIP' '-SkipFeed' }
else {
  Log "`r`n### 6. Offline package feed"
  $feed = Join-Path $OutDir 'nuget-feed'
  if (Test-Path $feed) { Remove-Item -Recurse -Force $feed }
  New-Item -ItemType Directory -Force -Path $feed | Out-Null
  $nupkgs = Get-ChildItem -Path $Packages -Recurse -Filter '*.nupkg'
  foreach ($n in $nupkgs) { Copy-Item $n.FullName -Destination $feed -Force }
  Get-ChildItem $OutDir -Filter 'nuget-feed.tgz*' | Remove-Item -Force
  $tgz = Join-Path $OutDir 'nuget-feed.tgz'
  $r = Run 'tar' @('-czf', $tgz, '-C', $OutDir, 'nuget-feed') $OutDir
  if ($r.Code -ne 0 -or -not (Test-Path $tgz)) { Result 'feed' 'FAIL' 'tar failed - see setup.log'; $failed = $true }
  else {
    $size = (Get-Item $tgz).Length
    $partSize = 300MB
    if ($size -gt $partSize) {
      # split into parts small enough to transfer; rejoin with: cat nuget-feed.tgz.part* > nuget-feed.tgz
      $in = [IO.File]::OpenRead($tgz); $buf = New-Object byte[] (4MB); $part = 0
      try {
        while ($in.Position -lt $in.Length) {
          $out = [IO.File]::Create(('{0}.part{1:d2}' -f $tgz, $part)); $written = 0
          try {
            while ($written -lt $partSize) {
              $n = $in.Read($buf, 0, [Math]::Min($buf.Length, $partSize - $written))
              if ($n -le 0) { break }
              $out.Write($buf, 0, $n); $written += $n
            }
          } finally { $out.Close() }
          $part++
        }
      } finally { $in.Close() }
      Remove-Item $tgz
      Result 'feed' 'OK' ("{0} packages, {1:n0} MB in {2} parts" -f $nupkgs.Count, ($size / 1MB), $part)
    } else {
      Result 'feed' 'OK' ("{0} packages, {1:n0} MB -> {2}" -f $nupkgs.Count, ($size / 1MB), $tgz)
    }
    Remove-Item -Recurse -Force $feed
  }
}

# -- 7. stack -------------------------------------------------------------------
if ($StartStack) {
  Log "`r`n### 7. docker compose"
  $r = Run 'docker' @('compose', 'up', '-d', '--build')
  if ($r.Code -ne 0) { Result 'stack' 'FAIL' 'docker compose up failed - see setup.log'; $failed = $true }
  else {
    $healthy = $false
    for ($i = 0; $i -lt 60 -and -not $healthy; $i++) {
      Start-Sleep -Seconds 3
      try { $healthy = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://localhost:8081/health').StatusCode -eq 200 } catch { }
    }
    if ($healthy) { Result 'stack' 'OK' 'gis-be healthy on :8081' }
    else { Result 'stack' 'FAIL' 'gis-be not healthy after 3 min - docker compose logs'; $failed = $true }
  }
}

Write-Host ''
Write-Host "Summary: $Summary"
Write-Host "Full log: $LogFile"
if ($failed) { exit 1 } else { exit 0 }
