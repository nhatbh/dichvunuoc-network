<#
  Builds the 3D GIS DEMO (frontend only: mock login + mock Hanoi data) and publishes it to the
  tino k3s cluster at https://gis3d-dev.dichvunuoc.vn

  Needs: VPN on, the tino32 dev access pack installed (ssh tino32 works, account dev-k3s),
  pnpm, and Windows tar.
  Run from anywhere:
    powershell -ExecutionPolicy Bypass -File .\deploy.ps1
  Options:
    -SkipInstall   do not run "pnpm install" (faster when dependencies are unchanged)
    -SkipBuild     upload the existing apps\gis-3d\dist as is
    -SshHost       ssh alias of server tino-32 (default: tino32 = dev account dev-k3s;
                   use -SshHost tino-32 for the personal account nhat)

  What it changes on the server (nothing else):
    /srv/water-network/gis-3d-demo/releases/<timestamp>   the uploaded files (last 3 kept)
    /srv/water-network/gis-3d-demo/current                symlink to the newest release
    namespace platform-core: deployment, service, ingress and configmap "water-network-gis-3d-demo*"
#>
param(
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [string]$SshHost = 'tino32',
    [string]$HostName = 'gis3d-dev.dichvunuoc.vn',
    [string]$IngressClass = 'nginx'
)
$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Native {
    # run a native command and stop on a non-zero exit code
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') failed (exit $LASTEXITCODE)" }
}

$deployDir = $PSScriptRoot
$appDir = (Resolve-Path (Join-Path $deployDir '..\..')).Path          # apps\gis-3d
$feDir = (Resolve-Path (Join-Path $appDir '..\..')).Path               # water-network-fe
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Step 'Checking tools'
foreach ($cmd in 'ssh', 'scp', 'tar') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found. Install OpenSSH Client / use Windows 10+ (tar is built in)." }
}
if (-not $SkipBuild -and -not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm not found (npm install -g pnpm).' }

Step "Checking the server ($SshHost) - VPN must be on"
Native ssh @('-o', 'ConnectTimeout=15', $SshHost, 'sudo -n k3s kubectl get nodes --no-headers')
$classes = (& ssh $SshHost 'sudo -n k3s kubectl get ingressclass -o name' | Out-String)
if ($classes -notmatch "(?m)ingressclass[^/]*/$IngressClass\s*$") {
    throw "Ingress class '$IngressClass' not found on the cluster. Available: $($classes.Trim()). Re-run with -IngressClass <name>."
}

if (-not $SkipBuild) {
    Step 'Building shared packages'
    foreach ($pkg in 'contracts', 'map-runtime', 'map-runtime-3d') {
        Push-Location (Join-Path $feDir "packages\$pkg")
        try {
            Write-Host "-- packages\$pkg"
            if (-not $SkipInstall) { Native pnpm @('install') }
            Native pnpm @('run', 'build')
        } finally { Pop-Location }
    }
    Step 'Building the demo bundle (vite --mode demo)'
    Push-Location $appDir
    try {
        if (-not $SkipInstall) { Native pnpm @('install') }
        Native pnpm @('run', 'build:demo')
    } finally { Pop-Location }
}
$dist = Join-Path $appDir 'dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "No build found in $dist" }
if (-not (Test-Path (Join-Path $dist 'mockServiceWorker.js'))) { throw 'dist has no mockServiceWorker.js - was it built with build:demo?' }

Step 'Packing'
$tgz = Join-Path $env:TEMP "gis3d-$stamp.tgz"
Native tar @('-czf', $tgz, '-C', $dist, '.')
Write-Host ("{0} ({1:N1} MB)" -f $tgz, ((Get-Item $tgz).Length / 1MB))

Step 'Uploading'
$remoteDeploy = "/tmp/gis3d-deploy-$stamp"
Native ssh @($SshHost, "mkdir -p $remoteDeploy")
Native scp @('-q', $tgz, "${SshHost}:/tmp/gis3d-$stamp.tgz")
$manifests = Get-ChildItem -LiteralPath $deployDir -File | Where-Object { $_.Extension -in '.yaml', '.conf' }
Native scp (@('-q') + ($manifests | ForEach-Object { $_.FullName }) + "${SshHost}:$remoteDeploy/")

Step 'Publishing on the server'
$remote = @'
set -euo pipefail
TS="$1"; ROOT=/srv/water-network/gis-3d-demo; DEPLOY="$2"; CLASS="$3"; HOST="$4"
sudo mkdir -p "$ROOT/releases/$TS"
sudo tar -xzf "/tmp/gis3d-$TS.tgz" -C "$ROOT/releases/$TS"
sudo chmod -R a+rX "$ROOT"
# switch atomically to the new release (relative link: valid inside the pod's mount too)
sudo ln -sfn "releases/$TS" "$ROOT/current.new" && sudo mv -Tf "$ROOT/current.new" "$ROOT/current"
# keep the 3 newest releases
cd "$ROOT/releases" && ls -1t | tail -n +4 | xargs -r sudo rm -rf
if [ "$CLASS" != "nginx" ]; then sed -i "s/ingressClassName: nginx/ingressClassName: $CLASS/" "$DEPLOY/ingress.yaml"; fi
if [ "$HOST" != "gis3d-dev.dichvunuoc.vn" ]; then sed -i "s/gis3d-dev.dichvunuoc.vn/$HOST/g" "$DEPLOY/ingress.yaml"; fi
sudo k3s kubectl apply -k "$DEPLOY"
sudo k3s kubectl -n platform-core rollout status deploy/water-network-gis-3d-demo --timeout=180s
rm -rf "$DEPLOY" "/tmp/gis3d-$TS.tgz"
echo "--- ingress"
sudo k3s kubectl -n platform-core get ingress water-network-gis-3d-demo
echo "--- health through the ingress on this node"
curl -sk --max-time 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/health" -o /dev/null -w "HTTPS /health -> %{http_code}\n" || echo "HTTPS /health -> not reachable from the node itself (check the ingress controller)"
'@
$remote = $remote -replace "`r", ''
$remote | & ssh $SshHost "bash -s -- $stamp $remoteDeploy $IngressClass $HostName"
if ($LASTEXITCODE -ne 0) { throw "Publishing failed (exit $LASTEXITCODE). Nothing else was changed; the previous release stays live unless 'current' was already switched." }
Remove-Item -LiteralPath $tgz -ErrorAction SilentlyContinue

Step 'Checking DNS'
$ips = @()
try { $ips = @(Resolve-DnsName $HostName -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress }) } catch { }
if (-not $ips.Count) {
    Write-Host "$HostName does not resolve yet. Ask the DNS admin for an A record -> 103.142.24.213." -ForegroundColor Yellow
    Write-Host "To try it right away on this PC, add this line to C:\Windows\System32\drivers\etc\hosts (as Administrator):" -ForegroundColor Yellow
    Write-Host "    103.142.24.213  $HostName"
} elseif ($ips -notcontains '103.142.24.213') {
    Write-Host "$HostName resolves to $($ips -join ', '), not 103.142.24.213 - check that this is the cluster's ingress address." -ForegroundColor Yellow
} else {
    Write-Host "$HostName -> $($ips -join ', ')" -ForegroundColor Green
}

Write-Host "`nDone: https://$HostName  (release $stamp)" -ForegroundColor Green
Write-Host 'Sign in with demo@example.com / password123'
