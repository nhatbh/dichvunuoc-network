<#
  Serves SYSTEM 3D in place of the current GIS frontend on the dev cluster (the 2D app at
  https://gis-dev.dichvunuoc.vn, deployment "water-network-gis"), through the tino32 ssh profile.
  Double-click replace-gis-fe.cmd at the repository root. It asks before changing anything.

  What it does:
  1. Reads the current frontend: its deployment, the service and ingress in front of it (hosts).
  2. Saves them to deploy\dev\.backup\gis-fe-<time>\ so it can be put back exactly (rollback).
  3. Replaces the deployment's pods with the SYSTEM 3D web image (the one deploy-system.cmd
     pushed and runs as water-network-gis-3d), keeping the deployment's name and labels so the
     existing service and ingress (same host, same TLS certificate) now serve SYSTEM 3D. Its nginx
     serves /config.json from configmap water-network-gis-3d and proxies /api/gis/ to
     water-network-bff, so no gateway route changes. The service's target port is set to 8080 if
     it pointed elsewhere (saved in the backup too).
  4. Waits for the rollout and checks https://<host>/config.json is the SYSTEM 3D one.
  5. Offers to remove the separate copy at gis3d-dev (its deployment, service and ingress).

  The Keycloak client water-network-gis-fe already allows the current frontend's host, so
  sign-in works there without a Keycloak change.

  Rollback: run it again and answer yes to "Put back the previous GIS frontend".
  Needs: deploy-system.cmd has run (backend, the web image and configmap water-network-gis-3d).
#>
$ErrorActionPreference = 'Stop'
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

$DeployDir = $PSScriptRoot
$BackupRoot = Join-Path $DeployDir '.backup'
$EnvFile = Join-Path $DeployDir 'deploy.env'
$cfg = @{}
if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
        $t = $line.Trim()
        if ($t -and -not $t.StartsWith('#') -and $t.IndexOf('=') -gt 0) { $cfg[$t.Substring(0, $t.IndexOf('=')).Trim()] = $t.Substring($t.IndexOf('=') + 1).Trim() }
    }
}
$SshHost = if ($cfg['SSH_HOST']) { $cfg['SSH_HOST'] } else { 'tino32' }
$Ns = if ($cfg['NAMESPACE']) { $cfg['NAMESPACE'] } else { 'platform-core' }
$K = "sudo -n k3s kubectl -n $Ns"
$Target = 'water-network-gis'

function Remote([string]$Command, [string]$StdIn) {
    if ($PSBoundParameters.ContainsKey('StdIn')) { $StdIn | & ssh -o ConnectTimeout=15 $SshHost $Command }
    else { & ssh -o ConnectTimeout=15 $SshHost $Command }
    if ($LASTEXITCODE -ne 0) { throw "on $SshHost`: $Command failed (exit $LASTEXITCODE)" }
}
function Json([string]$Command) { Remote $Command | Out-String | ConvertFrom-Json }
function ToJson($obj) { $obj | ConvertTo-Json -Depth 64 }
<# An object as it can be created again: no server-managed fields. #>
function Clean($o) {
    foreach ($f in 'uid', 'resourceVersion', 'creationTimestamp', 'managedFields', 'generation', 'selfLink') { $o.metadata.PSObject.Properties.Remove($f) }
    if ($o.metadata.annotations) {
        foreach ($a in 'deployment.kubernetes.io/revision', 'kubectl.kubernetes.io/last-applied-configuration') { $o.metadata.annotations.PSObject.Properties.Remove($a) }
    }
    $o.PSObject.Properties.Remove('status')
    if ($o.kind -eq 'Service') {
        foreach ($f in 'clusterIP', 'clusterIPs') { $o.spec.PSObject.Properties.Remove($f) }
    }
    $o
}

Step "Connecting to the cluster ($SshHost) - VPN must be on"
try { Remote "$K get deploy $Target -o name" | Out-Null } catch { Fail "no deployment $Target in $Ns (or the cluster is unreachable): $_" }

# ------------------------------------------------------------------------------------- rollback
$backups = @(Get-ChildItem $BackupRoot -Directory -Filter 'gis-fe-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
$current = Json "$K get deploy $Target -o json"
$isSystem3d = ($current.spec.template.spec.containers | Where-Object { $_.image -match 'water-network-gis-3d' }) -ne $null
$oldImage = ($current.spec.template.spec.containers | Select-Object -First 1).image
if ($backups -and $isSystem3d -and (Ask "SYSTEM 3D serves the GIS frontend now. Put back the previous GIS frontend (backup $($backups[0].Name))?" $false)) {
    Step "Restoring the previous GIS frontend from $($backups[0].FullName)"
    Remote "$K replace -f -" (Get-Content (Join-Path $backups[0].FullName 'deployment.json') -Raw -Encoding UTF8)
    # a service cannot be replaced without its cluster IP: put its target port back instead
    $svcFile = Join-Path $backups[0].FullName 'service.json'
    if (Test-Path $svcFile) {
        $old = Get-Content $svcFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $tp = ($old.spec.ports | Select-Object -First 1).targetPort
        $value = if ($tp -is [string]) { '"' + $tp + '"' } else { "$tp" }
        Remote "$K patch svc $($old.metadata.name) --type=json --patch-file=/dev/stdin" "[{`"op`":`"replace`",`"path`":`"/spec/ports/0/targetPort`",`"value`":$value}]"
    }
    Remote "$K rollout status deployment/$Target --timeout=300s"
    Write-Host "`nThe previous GIS frontend is back." -ForegroundColor Green
    exit 0
}

# ------------------------------------------------------------------------------- what is there
Step 'Reading the current GIS frontend'
$svcs = (Json "$K get svc -o json").items
$sel = $current.spec.selector.matchLabels
$labels = $current.spec.template.metadata.labels
$selects = { param($svcSel) $svcSel -and -not (@($svcSel.PSObject.Properties) | Where-Object { $labels.($_.Name) -ne $_.Value }) }
$svc = @($svcs | Where-Object { & $selects $_.spec.selector }) | Select-Object -First 1
if (-not $svc) { Fail "no service selects the pods of $Target" }
$ings = @((Json "$K get ingress -o json").items | Where-Object { $_.spec.rules.http.paths.backend.service.name -contains $svc.metadata.name })
$hosts = @($ings | ForEach-Object { $_.spec.rules.host } | Where-Object { $_ } | Sort-Object -Unique)
Note "deployment $Target  image $oldImage  replicas $($current.spec.replicas)"
Note "service $($svc.metadata.name)  ports $(($svc.spec.ports | ForEach-Object { "$($_.port)->$($_.targetPort)" }) -join ', ')"
Note "ingress $(($ings | ForEach-Object { $_.metadata.name }) -join ', ')  hosts $($hosts -join ', ')"
if ($isSystem3d) { Note 'it already runs SYSTEM 3D; the steps below update it to the current SYSTEM 3D image' }

# ------------------------------------------------------------------------------ SYSTEM 3D image
$web = Json "$K get deploy water-network-gis-3d -o json --ignore-not-found"
$image = if ($web) { ($web.spec.template.spec.containers | Select-Object -First 1).image }
elseif ($isSystem3d) { $oldImage }
if (-not $image) { Fail 'no SYSTEM 3D web image found (deployment water-network-gis-3d). Run deploy-system.cmd first.' }
$conf = Remote "$K get configmap water-network-gis-3d -o name --ignore-not-found"
if (-not $conf) { Fail 'configmap water-network-gis-3d is missing. Run deploy-system.cmd first.' }
Note "SYSTEM 3D web image: $image"
$bff = Remote "$K get deploy water-network-bff -o jsonpath='{.status.readyReplicas}' --ignore-not-found"
if (-not $bff) { Write-Host '   water-network-bff has no ready pod: the app will load but its API calls fail until it is ready.' -ForegroundColor Yellow }

Write-Host ''
if (-not (Ask "Replace the GIS frontend at $($hosts -join ', ') with SYSTEM 3D (the previous one is backed up for rollback)?" $false)) { Note 'nothing changed'; exit 0 }

# ---------------------------------------------------------------------------------------- backup
$dir = Join-Path $BackupRoot ('gis-fe-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force $dir | Out-Null
if (-not $isSystem3d) {
    ToJson (Clean (Json "$K get deploy $Target -o json")) | Set-Content (Join-Path $dir 'deployment.json') -Encoding UTF8
    ToJson (Clean (Json "$K get svc $($svc.metadata.name) -o json")) | Set-Content (Join-Path $dir 'service.json') -Encoding UTF8
    foreach ($i in $ings) { ToJson (Clean $i) | Set-Content (Join-Path $dir "ingress-$($i.metadata.name).json") -Encoding UTF8 }
    Note "backup saved to $dir"
} else { Remove-Item $dir; Note 'the backup of the previous frontend is kept as it was' }

# ------------------------------------------------------------------------------------ replace it
Step "Serving SYSTEM 3D from $Target"
$port = $svc.spec.ports | Select-Object -First 1
$portName = if ($port.targetPort -is [string] -and $port.targetPort -notmatch '^\d+$') { $port.targetPort } else { 'http' }
if ($port.targetPort -isnot [string] -and [int]$port.targetPort -ne 8080) {
    Note "service target port $($port.targetPort) -> 8080 (SYSTEM 3D's nginx)"
    # the patch goes on stdin: Windows PowerShell mangles double quotes inside ssh arguments
    Remote "$K patch svc $($svc.metadata.name) --type=json --patch-file=/dev/stdin" '[{"op":"replace","path":"/spec/ports/0/targetPort","value":8080}]'
}
$labelsYaml = ($labels.PSObject.Properties | ForEach-Object { "        $($_.Name): `"$($_.Value)`"" }) -join "`n"
$selYaml = ($sel.PSObject.Properties | ForEach-Object { "      $($_.Name): `"$($_.Value)`"" }) -join "`n"
$replicas = if ($current.spec.replicas) { $current.spec.replicas } else { 1 }
$deployment = @"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $Target
  namespace: $Ns
  labels:
    app: $Target
    app.kubernetes.io/part-of: water-network-system
  annotations:
    water-network/replaced: "SYSTEM 3D in place of the previous GIS frontend ($oldImage)"
spec:
  replicas: $replicas
  selector:
    matchLabels:
$selYaml
  template:
    metadata:
      labels:
$labelsYaml
      annotations:
        water-network/frontend: system-3d
    spec:
      containers:
        - name: web
          image: $image
          ports:
            - name: $portName
              containerPort: 8080
          volumeMounts:
            - { name: conf, mountPath: /etc/nginx/conf.d/default.conf, subPath: default.conf }
            - { name: conf, mountPath: /etc/water-network/config.json, subPath: config.json }
          readinessProbe: { httpGet: { path: /health, port: 8080 }, periodSeconds: 10 }
          resources: { requests: { cpu: 10m, memory: 32Mi }, limits: { cpu: 250m, memory: 128Mi } }
      volumes:
        - name: conf
          configMap: { name: water-network-gis-3d }
"@
# replace, not apply: nothing of the previous pod spec (env, volumes, probes) is kept
Remote "$K replace -f -" $deployment
Remote "$K rollout status deployment/$Target --timeout=300s"

# ------------------------------------------------------------------------------------------ check
foreach ($h in $hosts) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 "https://$h/config.json"
        if ($r.Content -match 'SYSTEM 3D') { Write-Host "   https://$h/config.json is SYSTEM 3D's" -ForegroundColor Green }
        else { Write-Host "   https://$h/config.json answers, but not with SYSTEM 3D's config (a cache?)" -ForegroundColor Yellow }
    } catch { Write-Host "   https://$h not reachable from this machine: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# ---------------------------------------------------------------------- the separate gis3d copy
$sepIng = Json "$K get ingress water-network-gis-3d -o json --ignore-not-found"
if ($sepIng -and (Ask "Remove the separate copy at $(@($sepIng.spec.rules.host) -join ', ') (its deployment, service and ingress; the configmap stays, it is used here)?" $false)) {
    Remote "$K delete ingress water-network-gis-3d --ignore-not-found"
    Remote "$K delete svc water-network-gis-3d --ignore-not-found"
    Remote "$K delete deploy water-network-gis-3d --ignore-not-found"
    Note 'removed; deploy-system.cmd creates it again (and updates the GIS frontend to each new image)'
}

Write-Host "`nSYSTEM 3D now serves $(($hosts | ForEach-Object { "https://$_" }) -join ', '). Rollback: run replace-gis-fe.cmd again." -ForegroundColor Green
