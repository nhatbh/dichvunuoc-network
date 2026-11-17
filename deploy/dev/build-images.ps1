<#
  Builds the SYSTEM 3D images on this computer (Docker Desktop, pnpm). Dot-sourced by
  deploy\dev\deploy.ps1 (Kubernetes, pushes to the registry) and deploy\longvan\deploy.ps1
  (Docker Compose, copies the images over ssh). Defines Build-SystemImages.
#>
function Get-SystemImages([string]$Root) {
    $BeDir = Join-Path $Root 'water-network-be'
    $AppDir = Join-Path $Root 'water-network-fe\apps\gis-3d'
    return [ordered]@{
        'water-network-gis-be'      = @{ Context = $BeDir; File = 'src\services\water-network-gis-be\Dockerfile' }
        'water-network-asset-be'    = @{ Context = $BeDir; File = 'src\services\water-network-asset-be\Dockerfile' }
        'water-network-design-be'   = @{ Context = $BeDir; File = 'src\services\water-network-design-be\Dockerfile' }
        'water-network-bff'         = @{ Context = $BeDir; File = 'src\services\water-network-bff\Dockerfile' }
        'water-network-topology-rs' = @{ Context = $BeDir; File = 'src\services\water-network-topology-rs\Dockerfile' }
        'water-network-import'      = @{ Context = (Join-Path $Root 'water-network-import'); File = 'Dockerfile' }
        'water-network-gis-3d'      = @{ Context = (Join-Path $AppDir 'dist'); File = (Join-Path $Root 'deploy\dev\web.Dockerfile') }
    }
}

<# Builds the frontend bundle (Keycloak sign-in, real backend through /api/gis) and every image as
   <Prefix>/<name>:<Tag>. Throws on the first failure. #>
function Build-SystemImages {
    param([string]$Root, [hashtable]$Cfg, [string]$Tag, [string]$Prefix, [switch]$SkipInstall)
    function Run([string]$Exe, [string[]]$Arguments) {
        & $Exe @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') failed (exit $LASTEXITCODE)" }
    }
    $FeDir = Join-Path $Root 'water-network-fe'
    $AppDir = Join-Path $FeDir 'apps\gis-3d'
    foreach ($cmd in 'docker', 'pnpm') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found" } }
    $ErrorActionPreference = 'Continue'   # Windows PowerShell turns redirected native stderr into errors
    & docker info *> $null
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw 'Docker is not running - start Docker Desktop.' }

    Write-Host "`n== Building the frontend bundle (Keycloak sign-in, real backend through /api/gis)" -ForegroundColor Cyan
    foreach ($pkg in 'contracts', 'component-models', 'map-runtime', 'map-runtime-3d') {
        Push-Location (Join-Path $FeDir "packages\$pkg")
        try {
            Write-Host "   packages\$pkg" -ForegroundColor DarkGray
            if (-not $SkipInstall) { Run pnpm @('install') }
            Run pnpm @('run', 'build')
        } finally { Pop-Location }
    }
    $viteEnv = @{
        VITE_AUTH_MODE = 'keycloak'; VITE_USE_MOCK_AUTH = 'false'; VITE_USE_MOCK_DATA = 'false'; VITE_DEMO = 'false'
        VITE_ENABLE_MSW = 'false'; VITE_E2E_HOOKS = 'false'; VITE_USE_RUNTIME_CONFIG = 'true'; VITE_API_URL = '/api/gis'
        VITE_KEYCLOAK_ON_LOAD = 'login-required'; VITE_KEYCLOAK_URL = $Cfg['KEYCLOAK_URL']; VITE_KEYCLOAK_REALM = $Cfg['KEYCLOAK_REALM']
        VITE_KEYCLOAK_CLIENT_ID = $Cfg['KEYCLOAK_CLIENT_ID']; VITE_MENU_APP_URL = $Cfg['MENU_APP_URL']; VITE_MOCK_PERMISSIONS = ''
    }
    $saved = @{}
    foreach ($k in $viteEnv.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $viteEnv[$k]) }
    Push-Location $AppDir
    try {
        if (-not $SkipInstall) { Run pnpm @('install') }
        Run pnpm @('exec', 'vite', 'build', '--mode', 'production')
    } finally {
        Pop-Location
        foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    }
    if (-not (Test-Path (Join-Path $AppDir 'dist\index.html'))) { throw 'the frontend build produced no dist\index.html' }

    $images = Get-SystemImages $Root
    foreach ($name in $images.Keys) {
        $img = $images[$name]
        Write-Host "`n== Building image $name" -ForegroundColor Cyan
        $file = if ([IO.Path]::IsPathRooted($img.File)) { $img.File } else { Join-Path $img.Context $img.File }
        Run docker @('build', '-f', $file, '-t', "$Prefix/${name}:$Tag", $img.Context)
    }
}
