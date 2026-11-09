<#
  Deploys the whole SYSTEM 3D platform to the dev k3s cluster:
    frontend (gis-3d, served with an /api/gis proxy to the BFF), BFF, gis-be, asset-be,
    design-be, topology-rs and the CAD import service.
  Uses the cluster's shared PostgreSQL, Redis, RabbitMQ and Keycloak (settings in deploy.env).

  Needs: VPN on and the tino32 access pack (ssh tino32 works, sudo k3s without password),
         Docker Desktop running and logged in to the registry, pnpm, git.

  Run: double-click deploy-system.cmd at the repository root. It asks, step by step (y/n):
    show the cluster's shared services, fill in missing settings (saved to deploy\dev\deploy.env),
    dry run only, build + push new images, pnpm install, replace the frontend-only demo,
    load the Vinh Thinh Dot 3 network after deploying.
  Unattended (no questions): pass the answers as switches -
    -Discover (list the cluster's services, then stop)  -DryRun  -SkipBuild [-Tag <tag>]
    -SkipInstall  -Seed  -Yes (replace the demo without asking)  -AutoFill (take missing settings
    from the cluster's services and secrets). Any switch turns the questions off.

  What it changes in namespace $NAMESPACE (nothing else): secret + configmaps
  "water-network-system*", the deployments/services of the components above, PVCs
  water-network-design-files and water-network-import-data, ingress water-network-gis-3d,
  migration jobs; with confirmation, it removes the frontend-only demo (water-network-gis-3d-demo).
#>
param(
    [switch]$Discover,
    [switch]$DryRun,
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$Seed,
    [switch]$Yes,
    [switch]$AutoFill,
    [string]$Tag
)
$ErrorActionPreference = 'Stop'
# questions when started without switches (double-click); switches = unattended
$Interactive = $PSBoundParameters.Count -eq 0 -and [Environment]::UserInteractive
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Note($msg) { Write-Host "   $msg" -ForegroundColor DarkGray }
function Fail($msg) { Write-Host "`nFAILED: $msg" -ForegroundColor Red; exit 1 }
function Ask([string]$Question, [bool]$Default = $false) {
    $hint = if ($Default) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        $a = (Read-Host "   $Question $hint").Trim()
        if ($a -eq '') { return $Default }
        if ($a -match '^(y|yes|c|co)$') { return $true }
        if ($a -match '^(n|no|k|khong)$') { return $false }
        Write-Host '   Answer y or n.' -ForegroundColor Yellow
    }
}
function Native {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') failed (exit $LASTEXITCODE)" }
}

$DeployDir = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $DeployDir '..\..')).Path
$BeDir = Join-Path $Root 'water-network-be'
$FeDir = Join-Path $Root 'water-network-fe'
$AppDir = Join-Path $FeDir 'apps\gis-3d'
$ImportDir = Join-Path $Root 'water-network-import'
$EnvFile = Join-Path $DeployDir 'deploy.env'
$Rendered = Join-Path $DeployDir '.rendered'

# ---------------------------------------------------------------------------------- settings
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $DeployDir 'deploy.env.example') $EnvFile
    if (-not $Interactive) {
        Fail "created $EnvFile from the example. Fill in the shared PostgreSQL/Redis/RabbitMQ and app-catalog settings (run with -Discover to see what the cluster has), then run again."
    }
    Note "created $EnvFile from the example; missing settings are asked below"
}
$cfg = @{}
foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $cfg[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
}
$SshHost = $cfg['SSH_HOST']
$Ns = $cfg['NAMESPACE']
if (-not $SshHost -or -not $Ns) { Fail 'SSH_HOST and NAMESPACE must be set in deploy.env' }
$Kubectl = 'sudo -n k3s kubectl'

function Remote([string]$Command, [string]$StdIn) {
    if ($PSBoundParameters.ContainsKey('StdIn')) { $StdIn | & ssh -o ConnectTimeout=15 $SshHost $Command }
    else { & ssh -o ConnectTimeout=15 $SshHost $Command }
    if ($LASTEXITCODE -ne 0) { throw "on $SshHost`: $Command failed (exit $LASTEXITCODE)" }
}
function Kube([string]$KubeArgs, [string]$StdIn) {
    if ($PSBoundParameters.ContainsKey('StdIn')) { Remote "$Kubectl -n $Ns $KubeArgs" $StdIn }
    else { Remote "$Kubectl -n $Ns $KubeArgs" }
}

Step "Checking the cluster ($SshHost) - VPN must be on"
foreach ($cmd in 'ssh', 'git') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "$cmd not found" } }
try { Remote "$Kubectl get ns $Ns -o name" | Out-Null } catch { Fail "cannot reach the cluster or namespace $Ns through ssh $SshHost ($_)" }

if ($Interactive) {
    Write-Host ''
    $Discover = Ask "Show the cluster's shared services (PostgreSQL, Redis, RabbitMQ, app catalog) first?" $false
}
if ($Discover) {
    Step 'Shared services in the cluster (PostgreSQL, Redis, RabbitMQ, Keycloak, app catalog, gateway)'
    Remote "$Kubectl get svc -A --no-headers | grep -iE 'postg|pgbouncer|redis|rabbit|keycloak|catalog|apisix|minio' || true"
    Step 'Secrets that may hold their credentials (names only)'
    Remote "$Kubectl get secret -A --no-headers -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name | grep -iE 'postg|redis|rabbit|keycloak|catalog' || true"
    Step "water-network resources in $Ns"
    Remote "$Kubectl -n $Ns get deploy,svc,ingress,pvc,job --no-headers | grep -i water-network || true"
    Step 'Ingress classes and TLS secrets'
    Remote "$Kubectl get ingressclass -o name; $Kubectl -n $Ns get secret --no-headers | grep -i tls || true"
    if (-not $Interactive) { exit 0 }
}

$required = 'REGISTRY', 'FRONTEND_HOST', 'INGRESS_CLASS', 'TLS_SECRET', 'KEYCLOAK_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_CLIENT_ID',
    'JWT_AUDIENCE', 'APP_CATALOG_URL', 'APP_CODE', 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
    'REDIS_HOST', 'REDIS_PORT', 'RABBITMQ_HOST', 'RABBITMQ_PORT', 'RABBITMQ_VHOST', 'RABBITMQ_USER', 'RABBITMQ_PASSWORD',
    'MAP_LON', 'MAP_LAT', 'MAP_ZOOM'
$missing = @($required | Where-Object { -not $cfg[$_] })

function Save-Settings([hashtable]$Values) {
    $lines = [System.Collections.Generic.List[string]](Get-Content $EnvFile -Encoding UTF8)
    foreach ($k in $Values.Keys) {
        $i = $lines.FindIndex([Predicate[string]]{ param($l) $l -match "^\s*$k\s*=" })
        if ($i -ge 0) { $lines[$i] = "$k=$($Values[$k])" } else { $lines.Add("$k=$($Values[$k])") }
    }
    Set-Content $EnvFile $lines -Encoding UTF8
}

<# Finds the shared services' settings in the cluster: the PostgreSQL, Redis, RabbitMQ and app-catalog
   services, and the credentials in their secrets (Bitnami chart keys, CloudNativePG / RabbitMQ
   operator secrets, or plain username/password keys). Returns only what it found. #>
function Find-ClusterSettings {
    $found = @{}
    $svcs = (Remote "$Kubectl get svc -A -o json" | Out-String | ConvertFrom-Json).items |
        Where-Object { $_.spec.clusterIP -and $_.spec.clusterIP -ne 'None' }
    $pick = {
        param([string]$pattern, [int]$port)
        $svcs | Where-Object { $_.metadata.name -match $pattern -and ($_.spec.ports | Where-Object { $_.port -eq $port }) } |
            Sort-Object { $_.metadata.name -match '(replica|read|ro|headless|metrics|exporter)' }, { $_.metadata.name.Length } |
            Select-Object -First 1
    }
    $secretsIn = @{}
    $secret = {
        param([string]$ns, [string]$pattern)
        if (-not $secretsIn.ContainsKey($ns)) {
            $secretsIn[$ns] = (Remote "$Kubectl -n $ns get secret -o json" | Out-String | ConvertFrom-Json).items |
                Where-Object { $_.type -eq 'Opaque' -or $_.type -eq 'kubernetes.io/basic-auth' }
        }
        $secretsIn[$ns] | Where-Object { $_.metadata.name -match $pattern }
    }
    $value = {
        param($sec, [string[]]$keys)
        foreach ($s in @($sec)) {
            foreach ($k in $keys) {
                $raw = $s.data.$k
                if ($raw) { return @{ Value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw)); From = "$($s.metadata.namespace)/$($s.metadata.name):$k" } }
            }
        }
        return $null
    }
    $hostOf = { param($svc) "$($svc.metadata.name).$($svc.metadata.namespace).svc.cluster.local" }

    $pg = & $pick 'postg|pgbouncer|cnpg|timescale' 5432
    if ($pg) {
        $found.POSTGRES_HOST = @{ Value = (& $hostOf $pg); From = 'service' }
        $found.POSTGRES_PORT = @{ Value = '5432'; From = 'service' }
        $sec = & $secret $pg.metadata.namespace 'postg|pg|cnpg|superuser|timescale'
        $super = & $value $sec @('postgres-password', 'POSTGRES_PASSWORD', 'postgresql-password')
        if ($super) {
            $found.POSTGRES_PASSWORD = $super
            $u = & $value $sec @('POSTGRES_USER', 'postgres-user')
            $found.POSTGRES_USER = if ($u) { $u } else { @{ Value = 'postgres'; From = 'chart default' } }
        } else {
            $u = & $value $sec @('username', 'user')
            $pw = & $value $sec @('password')
            if ($u -and $pw) { $found.POSTGRES_USER = $u; $found.POSTGRES_PASSWORD = $pw }
        }
    }
    $redis = & $pick 'redis|valkey|dragonfly' 6379
    if ($redis) {
        $found.REDIS_HOST = @{ Value = (& $hostOf $redis); From = 'service' }
        $found.REDIS_PORT = @{ Value = '6379'; From = 'service' }
        $pw = & $value (& $secret $redis.metadata.namespace 'redis|valkey|dragonfly') @('redis-password', 'REDIS_PASSWORD', 'password')
        if ($pw) { $found.REDIS_PASSWORD = $pw }
    }
    $mq = & $pick 'rabbit' 5672
    if ($mq) {
        $found.RABBITMQ_HOST = @{ Value = (& $hostOf $mq); From = 'service' }
        $found.RABBITMQ_PORT = @{ Value = '5672'; From = 'service' }
        $sec = & $secret $mq.metadata.namespace 'rabbit|default-user'
        $u = & $value $sec @('username', 'rabbitmq-username', 'RABBITMQ_DEFAULT_USER')
        $pw = & $value $sec @('password', 'rabbitmq-password', 'RABBITMQ_DEFAULT_PASS')
        if ($pw) {
            $found.RABBITMQ_PASSWORD = $pw
            $found.RABBITMQ_USER = if ($u) { $u } else { @{ Value = 'user'; From = 'chart default' } }
        }
    }
    $cat = $svcs | Where-Object { $_.metadata.name -match 'app-?catalog|catalog' } | Sort-Object { $_.metadata.name.Length } | Select-Object -First 1
    if ($cat) {
        $port = ($cat.spec.ports | Select-Object -First 1).port
        $found.APP_CATALOG_URL = @{ Value = "http://$(& $hostOf $cat):$port/"; From = 'service' }
    }
    return $found
}

$autoFill = $AutoFill -or ($missing -and $Interactive -and (Ask 'Find the missing settings in the cluster (its services and their secrets)?' $true))
if ($missing -and $autoFill) {
    Step 'Looking for the shared services and their credentials in the cluster'
    try { $found = Find-ClusterSettings } catch { $found = @{}; Write-Host "   could not read the cluster: $_" -ForegroundColor Yellow }
    $use = @{}
    # the Redis password is optional, so it is not "missing" — but take it when the cluster has one
    foreach ($k in @($missing) + @(@('REDIS_PASSWORD') | Where-Object { -not $cfg[$_] })) {
        if (-not $found.ContainsKey($k)) { continue }
        $shown = if ($k -like '*PASSWORD') { '********' } else { $found[$k].Value }
        Write-Host ("   {0,-18} {1}   ({2})" -f $k, $shown, $found[$k].From)
        $use[$k] = $found[$k].Value
    }
    $notFound = @($missing | Where-Object { -not $use.ContainsKey($_) })
    if ($notFound) { Note "not found: $($notFound -join ', ')" }
    if ($use.Count -and (-not $Interactive -or (Ask 'Use these values (saved to deploy.env)?' $true))) {
        foreach ($k in $use.Keys) { $cfg[$k] = $use[$k] }
        Save-Settings $use
        Note "saved $($use.Count) settings to $EnvFile (git-ignored)"
    }
    $missing = @($required | Where-Object { -not $cfg[$_] })
}
if ($missing -and $Interactive) {
    Step "Settings still missing in deploy.env ($($missing.Count)); they are saved there for next time"
    $hints = @{
        APP_CATALOG_URL = 'app-catalog base URL inside the cluster, e.g. http://app-catalog.platform-core.svc.cluster.local:8080/'
        POSTGRES_HOST = 'in-cluster host, e.g. postgres.db.svc.cluster.local'
        REDIS_HOST = 'in-cluster host, e.g. redis.db.svc.cluster.local'
        RABBITMQ_HOST = 'in-cluster host, e.g. rabbitmq.mq.svc.cluster.local'
    }
    $typed = @{}
    foreach ($k in $missing) {
        if ($hints[$k]) { Note $hints[$k] }
        if ($k -like '*PASSWORD') {
            $sec = Read-Host "   $k" -AsSecureString
            $v = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
        } else { $v = (Read-Host "   $k").Trim() }
        if (-not $v) { Fail "$k is required" }
        $cfg[$k] = $v
        $typed[$k] = $v
    }
    Save-Settings $typed
    Note "saved to $EnvFile (git-ignored)"
    $missing = @()
}
if ($missing) { Fail "deploy.env is missing: $($missing -join ', ') (run with -Discover to see the cluster's services)" }

if ($Interactive) {
    Write-Host ''
    $DryRun = Ask 'Dry run only (write the manifests to deploy\dev\.rendered, change nothing)?' $false
    if (-not $DryRun) {
        $SkipBuild = -not (Ask 'Build and push new images of this commit (No = deploy images already pushed)?' $true)
        if ($SkipBuild) {
            $t = (Read-Host '   Image tag to deploy (Enter = this commit)').Trim()
            if ($t) { $Tag = $t }
        } else {
            $SkipInstall = -not (Ask 'Run pnpm install for the frontend packages (No = faster, dependencies unchanged)?' $true)
        }
        $Seed = Ask 'After deploying, load the Vinh Thinh Dot 3 network if gis-be is empty (needs an access token)?' $false
    }
}
foreach ($k in 'MENU_APP_URL', 'POSTGRES_OPTIONS', 'REDIS_PASSWORD') { if (-not $cfg.ContainsKey($k)) { $cfg[$k] = '' } }
$Reg = $cfg['REGISTRY'].TrimEnd('/')

# ---------------------------------------------------------------------------------- image tag
Push-Location $Root
try {
    if (-not $Tag) {
        $sha = (& git rev-parse --short=10 HEAD).Trim()
        $dirty = (& git status --porcelain --untracked-files=no)
        $Tag = if ($dirty) { "$sha-dirty-$(Get-Date -Format 'yyyyMMddHHmmss')" } else { $sha }
    }
} finally { Pop-Location }
Note "image tag: $Tag"

# ------------------------------------------------------------------------------------- render
# Npgsql values with ; ' = or spaces must be quoted
$q = { param($v) if ($v -match "[;'= ]") { "'" + $v.Replace("'", "''") + "'" } else { $v } }
$pg = "Host=$($cfg['POSTGRES_HOST']);Port=$($cfg['POSTGRES_PORT']);Username=$(& $q $cfg['POSTGRES_USER']);Password=$(& $q $cfg['POSTGRES_PASSWORD'])"
if ($cfg['POSTGRES_OPTIONS']) { $pg = "$pg;$($cfg['POSTGRES_OPTIONS'].TrimStart(';'))" }
$redis = "$($cfg['REDIS_HOST']):$($cfg['REDIS_PORT']),abortConnect=false"
if ($cfg['REDIS_PASSWORD']) { $redis = "$redis,password=$($cfg['REDIS_PASSWORD'])" }
$enc = { param($s) [Uri]::EscapeDataString($s) }
$amqp = 'amqp://{0}:{1}@{2}:{3}/{4}' -f (& $enc $cfg['RABBITMQ_USER']), (& $enc $cfg['RABBITMQ_PASSWORD']), $cfg['RABBITMQ_HOST'], $cfg['RABBITMQ_PORT'], (& $enc $cfg['RABBITMQ_VHOST'])
$secretData = [ordered]@{
    GIS_DB = "$pg;Database=wn_gis"; ASSET_DB = "$pg;Database=wn_asset"; DESIGN_DB = "$pg;Database=wn_design"
    REDIS = $redis; RABBITMQ_USER = $cfg['RABBITMQ_USER']; RABBITMQ_PASSWORD = $cfg['RABBITMQ_PASSWORD']; TOPOLOGY_AMQP_URL = $amqp
}
# applied from memory through ssh stdin; base64 so no value needs YAML quoting
$secretYaml = "apiVersion: v1`nkind: Secret`nmetadata:`n  name: water-network-system`n  namespace: $Ns`n  labels: { app.kubernetes.io/part-of: water-network-system }`ntype: Opaque`ndata:`n" +
    (($secretData.Keys | ForEach-Object { "  ${_}: " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$secretData[$_])) }) -join "`n")

$vars = @{} + $cfg
$vars['NAMESPACE'] = $Ns
$vars['REGISTRY'] = $Reg
$vars['TAG'] = $Tag
$vars['JOB_SUFFIX'] = ($Tag.ToLower() -replace '[^a-z0-9-]', '-').Substring(0, [Math]::Min(30, $Tag.Length)).TrimEnd('-')
$sha256 = [Security.Cryptography.SHA256]::Create()
$vars['CONFIG_HASH'] = ([BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes(($cfg.GetEnumerator() | Sort-Object Name | Out-String)))) -replace '-', '').Substring(0, 16)

function Render([string]$Text) {
    $out = [regex]::Replace($Text, '\$\{([A-Z0-9_]+)\}', {
        param($m)
        $k = $m.Groups[1].Value
        if ($vars.ContainsKey($k)) { return [string]$vars[$k] }
        return $m.Value
    })
    $left = [regex]::Matches($out, '\$\{[A-Z0-9_]+\}') | ForEach-Object { $_.Value } | Sort-Object -Unique
    if ($left) { Fail "no value for $($left -join ', ')" }
    return $out
}
New-Item -ItemType Directory -Force $Rendered | Out-Null
$systemYaml = Render (Get-Content (Join-Path $DeployDir 'k8s\system.yaml') -Raw -Encoding UTF8)
$migrateYaml = Render (Get-Content (Join-Path $DeployDir 'k8s\migrate.yaml') -Raw -Encoding UTF8)
$importYaml = (Get-Content (Join-Path $ImportDir 'deploy\runtime.yaml') -Raw -Encoding UTF8)
$importYaml = $importYaml.Replace('image: water-network-import:local', "image: $Reg/water-network-import:$Tag")
$importYaml = $importYaml -replace 'namespace: platform-core', "namespace: $Ns"
$importYaml = $importYaml -replace 'IMPORT_JWT_ISSUER: .*', "IMPORT_JWT_ISSUER: $($cfg['KEYCLOAK_URL'])/realms/$($cfg['KEYCLOAK_REALM'])"
$importYaml = $importYaml -replace 'IMPORT_JWT_AUDIENCE: .*', "IMPORT_JWT_AUDIENCE: $($cfg['JWT_AUDIENCE'])"
$importYaml = $importYaml -replace 'IMPORT_ALLOWED_CLIENTS: .*', "IMPORT_ALLOWED_CLIENTS: $($cfg['KEYCLOAK_CLIENT_ID'])"
Set-Content (Join-Path $Rendered 'system.yaml') $systemYaml -Encoding UTF8
Set-Content (Join-Path $Rendered 'migrate.yaml') $migrateYaml -Encoding UTF8
Set-Content (Join-Path $Rendered 'import.yaml') $importYaml -Encoding UTF8
Note "manifests rendered to $Rendered (the secret is not written to disk)"
if ($DryRun) { Write-Host "`nDry run: nothing built or changed." -ForegroundColor Green; exit 0 }

# -------------------------------------------------------------------------------------- build
$images = [ordered]@{
    'water-network-gis-be'      = @{ Context = $BeDir; File = 'src\services\water-network-gis-be\Dockerfile' }
    'water-network-asset-be'    = @{ Context = $BeDir; File = 'src\services\water-network-asset-be\Dockerfile' }
    'water-network-design-be'   = @{ Context = $BeDir; File = 'src\services\water-network-design-be\Dockerfile' }
    'water-network-bff'         = @{ Context = $BeDir; File = 'src\services\water-network-bff\Dockerfile' }
    'water-network-topology-rs' = @{ Context = $BeDir; File = 'src\services\water-network-topology-rs\Dockerfile' }
    'water-network-import'      = @{ Context = $ImportDir; File = 'Dockerfile' }
    'water-network-gis-3d'      = @{ Context = (Join-Path $AppDir 'dist'); File = (Join-Path $DeployDir 'web.Dockerfile') }
}
if (-not $SkipBuild) {
    foreach ($cmd in 'docker', 'pnpm') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "$cmd not found" } }
    $ErrorActionPreference = 'Continue'   # Windows PowerShell turns redirected native stderr into errors
    & docker info *> $null
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { Fail 'Docker is not running - start Docker Desktop.' }

    Step 'Building the frontend bundle (Keycloak sign-in, real backend through /api/gis)'
    foreach ($pkg in 'contracts', 'component-models', 'map-runtime', 'map-runtime-3d') {
        Push-Location (Join-Path $FeDir "packages\$pkg")
        try {
            Note "packages\$pkg"
            if (-not $SkipInstall) { Native pnpm @('install') }
            Native pnpm @('run', 'build')
        } finally { Pop-Location }
    }
    $viteEnv = @{
        VITE_AUTH_MODE = 'keycloak'; VITE_USE_MOCK_AUTH = 'false'; VITE_USE_MOCK_DATA = 'false'; VITE_DEMO = 'false'
        VITE_ENABLE_MSW = 'false'; VITE_E2E_HOOKS = 'false'; VITE_USE_RUNTIME_CONFIG = 'true'; VITE_API_URL = '/api/gis'
        VITE_KEYCLOAK_ON_LOAD = 'login-required'; VITE_KEYCLOAK_URL = $cfg['KEYCLOAK_URL']; VITE_KEYCLOAK_REALM = $cfg['KEYCLOAK_REALM']
        VITE_KEYCLOAK_CLIENT_ID = $cfg['KEYCLOAK_CLIENT_ID']; VITE_MENU_APP_URL = $cfg['MENU_APP_URL']; VITE_MOCK_PERMISSIONS = ''
    }
    $saved = @{}
    foreach ($k in $viteEnv.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $viteEnv[$k]) }
    Push-Location $AppDir
    try {
        if (-not $SkipInstall) { Native pnpm @('install') }
        Native pnpm @('exec', 'vite', 'build', '--mode', 'production')
    } finally {
        Pop-Location
        foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    }
    if (-not (Test-Path (Join-Path $AppDir 'dist\index.html'))) { Fail 'the frontend build produced no dist\index.html' }

    foreach ($name in $images.Keys) {
        $img = $images[$name]
        Step "Building image $name"
        $file = if ([IO.Path]::IsPathRooted($img.File)) { $img.File } else { Join-Path $img.Context $img.File }
        Native docker @('build', '-f', $file, '-t', "$Reg/${name}:$Tag", $img.Context)
    }
    Step "Pushing images to $Reg"
    foreach ($name in $images.Keys) {
        & docker push "$Reg/${name}:$Tag"
        if ($LASTEXITCODE -ne 0) { Fail "push of $name failed - run 'docker login $($Reg.Split('/')[0])' and try again" }
    }
}

# ------------------------------------------------------------------------------------- deploy
Step 'Checking the host is free'
$demo = (Remote "$Kubectl -n $Ns get ingress water-network-gis-3d-demo -o jsonpath='{.spec.rules[*].host}' --ignore-not-found")
if ($demo -and ($demo -split '\s+') -contains $cfg['FRONTEND_HOST']) {
    Write-Host "   $($cfg['FRONTEND_HOST']) is served by the frontend-only demo (water-network-gis-3d-demo)." -ForegroundColor Yellow
    if (-not $Yes) {
        $replace = $Interactive -and (Ask 'Replace it with the full system?' $false)
        if (-not $replace) { Fail 'stopped; set FRONTEND_HOST to another host in deploy.env, or confirm the replacement (unattended: -Yes)' }
    }
    Kube 'delete deployment,service,ingress,configmap -l app.kubernetes.io/name=water-network-gis-3d-demo --ignore-not-found'
}

Step 'Applying the shared settings (secret water-network-system, configmaps)'
Kube 'apply -f -' $secretYaml
$configOnly = ($systemYaml -split "(?m)^---\s*$") | Where-Object { $_ -match 'kind: ConfigMap' -or $_ -match 'kind: PersistentVolumeClaim' }
Kube 'apply -f -' ($configOnly -join "`n---`n")

Step 'Migrating the databases (wn_gis, wn_asset, wn_design)'
Kube 'delete job -l water-network/migration=true --ignore-not-found'
Kube 'apply -f -' $migrateYaml
$jobs = 'water-network-gis-be', 'water-network-asset-be', 'water-network-design-be' | ForEach-Object { "$_-migrate-$($vars['JOB_SUFFIX'])" }
foreach ($job in $jobs) {
    try { Kube "wait --for=condition=complete job/$job --timeout=300s" }
    catch {
        try { Remote "$Kubectl -n $Ns logs job/$job --tail=60" } catch { }
        Fail "migration $job did not complete (logs above). Check the PostgreSQL settings and that the user may create databases/extensions."
    }
}

Step 'Rolling out the services'
Kube 'apply -f -' $importYaml
Kube 'apply -f -' $systemYaml
$deployments = 'water-network-gis-be', 'water-network-asset-be', 'water-network-design-be', 'water-network-topology-rs',
    'water-network-import', 'water-network-bff', 'water-network-gis-3d'
$failed = @()
foreach ($d in $deployments) {
    try { Kube "rollout status deployment/$d --timeout=300s" }
    catch {
        $failed += $d
        Write-Host "   $d did not become ready; last log lines:" -ForegroundColor Yellow
        try { Remote "$Kubectl -n $Ns logs deployment/$d --tail=40" } catch { }
    }
}
if ($failed) { Fail "not ready: $($failed -join ', ')" }

Step 'Checking'
try { Remote "$Kubectl -n $Ns exec deployment/water-network-gis-3d -- wget -qO- http://water-network-bff:8080/health"; Write-Host '' } catch { Fail 'the BFF health check failed' }
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 "https://$($cfg['FRONTEND_HOST'])/config.json"
    Note "https://$($cfg['FRONTEND_HOST'])/config.json -> $($r.StatusCode)"
} catch {
    Write-Host "   https://$($cfg['FRONTEND_HOST']) is not reachable from this machine yet ($($_.Exception.Message)). Check DNS (or a hosts entry) for it." -ForegroundColor Yellow
}

# --------------------------------------------------------------------------------------- seed
if ($Seed) {
    Step 'Loading the Vinh Thinh Dot 3 network (only if gis-be is empty)'
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node not found' }
    Write-Host '   Sign in at https://' -NoNewline; Write-Host $cfg['FRONTEND_HOST'] -NoNewline
    Write-Host ' as a user of the target tenant with network-gis write rights, copy the access token'
    Write-Host '   (browser dev tools > Network > any /api/gis request > Authorization header, without "Bearer ").'
    $secure = Read-Host '   Access token' -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if (-not $token) { Fail 'no token given' }
    $port = 18081
    $tunnel = Start-Process ssh -ArgumentList @('-o', 'ExitOnForwardFailure=yes', '-L', "${port}:127.0.0.1:$port", $SshHost,
        "$Kubectl -n $Ns port-forward svc/water-network-gis-be ${port}:8080") -PassThru -WindowStyle Hidden
    try {
        Start-Sleep -Seconds 6
        $env:WN_TOKEN = $token
        Push-Location $AppDir
        try { Native node @('scripts/local-stack/seed.mjs', '--gis', "http://127.0.0.1:$port") } finally { Pop-Location }
    } finally {
        Remove-Item Env:WN_TOKEN -ErrorAction SilentlyContinue
        if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
    }
}

Write-Host "`nDeployed $Tag. SYSTEM 3D: https://$($cfg['FRONTEND_HOST'])" -ForegroundColor Green
