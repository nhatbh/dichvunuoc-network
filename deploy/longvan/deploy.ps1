<#
  Deploys SYSTEM 3D to the longvan-dev Docker host as one Docker Compose project
  "water-network" (decision 0033). Started by deploy-system.cmd when deploy.env targets compose
  (setup-longvan.cmd sets that), or directly. Needs: the ssh profile (setup-longvan.cmd),
  Docker Desktop and pnpm on this computer (to build), docker compose on the server.

  1. Builds every image here (deploy\dev\build-images.ps1) as water-network/<name>:<tag>.
  2. Copies the images the server does not have yet over ssh (docker save | ssh -C | docker load).
  3. Writes ~/water-network on the server: compose.yaml, web/default.conf, web/config.json and .env
     (settings + secrets generated once on the server in .secrets, never copied back).
  4. Creates the network water-network-proxy and attaches nginx-proxy-manager to it, so the proxy
     reaches the web container by name (nothing else of nginx-proxy-manager changes).
  5. docker compose up -d: PostGIS, Redis, RabbitMQ, migrations, services, web. No host ports.
  6. Creates or updates the nginx-proxy-manager proxy host for FRONTEND_HOST through its API,
     signed in with nginx-proxy-manager's own key on the server (no login to type); only if that
     fails, its admin login is asked (used once, never saved).
  Other containers on the server are not touched.

  Switches (unattended): -SkipBuild [-Tag <tag>]  -SkipInstall  -Yes
#>
param([switch]$SkipBuild, [switch]$SkipInstall, [string]$Tag, [switch]$Yes)
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $Root 'deploy\dev\build-images.ps1')
$script:Unattended = $PSBoundParameters.Count -gt 0
$Interactive = -not $script:Unattended

foreach ($k in 'KEYCLOAK_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_CLIENT_ID', 'JWT_AUDIENCE', 'FRONTEND_HOST') {
    if (-not $cfg[$k]) { Fail "$k is missing in $EnvFile (see deploy.env.example)" }
}
foreach ($k in @{ MAP_LON = '105.4935'; MAP_LAT = '21.178'; MAP_ZOOM = '14'; APP_CODE = 'ml-0'; MENU_APP_URL = '' }.GetEnumerator()) {
    if (-not $cfg.ContainsKey($k.Key)) { $cfg[$k.Key] = $k.Value }
}

Step "Checking the server ($SshHost)"
try {
    $info = Invoke-Server @'
echo "host $(hostname)"
docker compose version --short >/dev/null 2>&1 && echo "compose $(docker compose version --short)" || echo "compose missing"
docker inspect nginx-proxy-manager >/dev/null 2>&1 && echo "npm yes" || echo "npm no"
command -v python3 >/dev/null && echo "python3 yes" || echo "python3 no"
df -h ~ | awk 'NR==2 {print "disk " $4 " free"}'
test -f water-network/.env && sed -n 's/^IMAGE_TAG=//p' water-network/.env | sed 's/^/running /' || true
'@
} catch { Fail "cannot reach $SshHost over ssh - run setup-longvan.cmd ($_)" }
$info | ForEach-Object { Note $_ }
if ($info -contains 'compose missing') { Fail 'docker compose is not installed on the server' }
$running = ($info | Where-Object { $_ -like 'running *' } | Select-Object -First 1) -replace '^running ', ''
$hasNpm = $info -contains 'npm yes'
$hasPython = $info -contains 'python3 yes'

# --------------------------------------------------------------------------------- questions
if ($Interactive) {
    Write-Host ''
    $SkipBuild = -not (Ask 'Build new images of this commit (No = redeploy the images already on the server)?' $true)
    if (-not $SkipBuild) { $SkipInstall = -not (Ask 'Run pnpm install for the frontend packages (No = faster, dependencies unchanged)?' $true) }
    $flat = Ask 'Accept the flat tenant_id claim for CAD import and the editor (users without a Keycloak Organization)?' ($cfg['ALLOW_FLAT_TENANT'] -ne 'false')
    Save-Setting 'ALLOW_FLAT_TENANT' $(if ($flat) { 'true' } else { 'false' })
}
if (-not $cfg['ALLOW_FLAT_TENANT']) { $cfg['ALLOW_FLAT_TENANT'] = 'true' }
# no app catalog on this server: the BFF gate is off unless APP_CATALOG_URL points to one
$gate = if ($cfg['APP_CATALOG_URL'] -and $cfg['APP_ENTITLEMENT_ENABLED'] -eq 'true') { 'true' } else { 'false' }
$catalog = if ($cfg['APP_CATALOG_URL']) { $cfg['APP_CATALOG_URL'] } else { 'http://app-catalog.invalid/' }

if (-not $Tag) {
    if ($SkipBuild) {
        if (-not $running) { Fail 'nothing deployed on the server yet: build first' }
        $Tag = $running
    } else {
        Push-Location $Root
        try {
            $sha = (& git rev-parse --short=10 HEAD).Trim()
            $dirty = (& git status --porcelain --untracked-files=no)
        } finally { Pop-Location }
        $Tag = if ($dirty) { "$sha-dirty-$(Get-Date -Format 'yyyyMMddHHmmss')" } else { $sha }
    }
}
Note "image tag $Tag"
$Prefix = 'water-network'
$images = Get-SystemImages $Root

# ------------------------------------------------------------------------- build and copy
if (-not $SkipBuild) {
    try { Build-SystemImages -Root $Root -Cfg $cfg -Tag $Tag -Prefix $Prefix -SkipInstall:$SkipInstall } catch { Fail "$_" }
}
Step 'Copying images to the server'
$check = ($images.Keys | ForEach-Object { "docker image inspect $Prefix/${_}:$Tag >/dev/null 2>&1 || echo missing $Prefix/${_}:$Tag" }) -join "`n"
$missing = @(Invoke-Server $check | Where-Object { $_ -like 'missing *' } | ForEach-Object { $_.Substring(8) })
if ($missing) {
    foreach ($ref in $missing) {
        & docker image inspect $ref *> $null
        if ($LASTEXITCODE -ne 0) { Fail "$ref is neither on the server nor on this computer: build it (answer y to building)" }
    }
    Note "sending $($missing.Count) image(s) - the first time this is about 1-2 GB, compressed by ssh"
    # cmd.exe pipes bytes unchanged; Windows PowerShell 5.1 would re-encode the stream as text
    & cmd.exe /c "docker save $($missing -join ' ') | ssh -C -o BatchMode=yes $SshHost docker load"
    if ($LASTEXITCODE -ne 0) { Fail 'copying the images failed' }
    Good "$($missing.Count) image(s) loaded on the server"
} else { Good 'the server already has every image of this tag' }

# ------------------------------------------------------------------------------ the stack
Step 'Writing the stack (~/water-network)'
$vars = @{} + $cfg
$vars['FE_ORGANIZATION'] = if ($cfg['ALLOW_FLAT_TENANT'] -eq 'true') { '{ "context": "disabled", "allowLegacyTenantIdFallback": true }' } else { '{ "context": "disabled" }' }
function Render([string]$Text) {
    $out = [regex]::Replace($Text, '\$\{([A-Z0-9_]+)\}', { param($m) $k = $m.Groups[1].Value; if ($vars.ContainsKey($k)) { [string]$vars[$k] } else { $m.Value } })
    $left = [regex]::Matches($out, '\$\{[A-Z0-9_]+\}') | ForEach-Object { $_.Value } | Sort-Object -Unique
    if ($left) { Fail "no value for $($left -join ', ')" }
    return $out
}
$web = Get-Content (Join-Path $LvDir 'web.conf') -Raw -Encoding UTF8
$config = Get-Content (Join-Path $LvDir 'config.json') -Raw -Encoding UTF8
$settings = @(
    "# written by deploy/longvan/deploy.ps1 - settings; secrets are appended from .secrets"
    "IMAGE_TAG=$Tag"
    "FRONTEND_HOST=$($cfg['FRONTEND_HOST'])"
    "KEYCLOAK_URL=$($cfg['KEYCLOAK_URL'])"
    "KEYCLOAK_REALM=$($cfg['KEYCLOAK_REALM'])"
    "KEYCLOAK_CLIENT_ID=$($cfg['KEYCLOAK_CLIENT_ID'])"
    "JWT_AUDIENCE=$($cfg['JWT_AUDIENCE'])"
    "ALLOW_FLAT_TENANT=$($cfg['ALLOW_FLAT_TENANT'])"
    "APP_ENTITLEMENT_ENABLED=$gate"
    "APP_CATALOG_URL=$catalog"
    "APP_CODE=$($cfg['APP_CODE'])"
    "PROXY_NETWORK=water-network-proxy"
) -join "`n"
try {
    Write-ServerFile "$StackDir/compose.yaml" (Get-Content (Join-Path $LvDir 'compose.yaml') -Raw -Encoding UTF8)
    Write-ServerFile "$StackDir/web/default.conf" (Render $web)
    Write-ServerFile "$StackDir/web/config.json" (Render $config)
    Write-ServerFile "$StackDir/settings.env" $settings '600'
    Invoke-Server @'
cd water-network
umask 077
if [ ! -f .secrets ]; then
  gen() { tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 32; }
  printf 'POSTGRES_PASSWORD=%s\nREDIS_PASSWORD=%s\nRABBITMQ_PASSWORD=%s\n' "$(gen)" "$(gen)" "$(gen)" > .secrets
  echo "generated .secrets"
fi
cat settings.env .secrets > .env
chmod 600 .env .secrets settings.env
# the proxy network: nginx-proxy-manager reaches the web container on it by name
docker network inspect water-network-proxy >/dev/null 2>&1 || docker network create water-network-proxy >/dev/null
if docker inspect nginx-proxy-manager >/dev/null 2>&1; then
  docker inspect -f '{{json .NetworkSettings.Networks}}' nginx-proxy-manager | grep -q '"water-network-proxy"' \
    || docker network connect water-network-proxy nginx-proxy-manager
  echo "nginx-proxy-manager attached to water-network-proxy"
fi
'@ | ForEach-Object { Note $_ }
} catch { Fail "$_" }
Good 'compose.yaml, web/, .env written'

Step 'Starting the stack (databases, migrations, services, web)'
try {
    Invoke-Server @'
cd water-network
docker compose up -d --remove-orphans --wait --wait-timeout 300 2>&1 | tail -n 30
'@ -AllowFail | ForEach-Object { Note $_ }
    $ps = Invoke-Server @'
cd water-network
docker compose ps -a --format '{{.Service}} {{.State}} {{.Status}}'
'@
} catch { Fail "$_" }
$bad = @()
foreach ($row in $ps) {
    $name, $state = ($row -split ' ', 3)
    $ok = ($state -eq 'running') -or ($name -like '*-migrate' -and $row -match 'Exited \(0\)')
    if ($ok) { Good $row } else { Bad $row; $bad += $name }
}
if ($bad) {
    foreach ($svc in $bad) {
        Write-Host "   last log lines of ${svc}:" -ForegroundColor Yellow
        Invoke-Server "cd water-network`ndocker compose logs --tail 30 $svc" -AllowFail | ForEach-Object { Note $_ }
    }
    Fail "not running: $($bad -join ', ')"
}
$health = Invoke-Server @'
cd water-network
docker compose exec -T water-network-web wget -qO- http://water-network-bff:8080/health || echo unreachable
'@ -AllowFail
if (($health -join ' ') -match 'Healthy') { Good 'web -> BFF: Healthy' } else { Bad "web -> BFF: $($health -join ' ')" }

# ------------------------------------------------------------------- nginx-proxy-manager
$hostName = $cfg['FRONTEND_HOST']
Step "Publishing https://$hostName through nginx-proxy-manager"
$manual = @"
   In nginx-proxy-manager (open a tunnel: ssh -L 8181:127.0.0.1:81 $SshHost, then http://localhost:8181):
     Hosts > Proxy Hosts > $hostName (add it if missing)
       Details: scheme http, forward hostname water-network-web, port 8080,
                Block common exploits on, Websockets support on
       SSL:     the *.dichvunuoc.vn or $hostName certificate (or request a new one), Force SSL on
       Advanced: client_max_body_size 100m;
"@
$automated = $false
$py = Get-Content (Join-Path $LvDir 'npm-proxy-host.py') -Raw -Encoding UTF8
# Signs short-lived nginx-proxy-manager tokens with its own key, inside its container (ssh +
# docker on the server already control it fully): one per candidate admin user id. They stay on
# the server, in the environment of the python run below.
$mint = @'
NPM_TOKENS=$(docker exec -w /app nginx-proxy-manager node -e '
const fs = require("fs"); const jwt = require("jsonwebtoken");
let keys = null;
for (const p of ["/data/keys.json", "/app/config/keys.json"]) { try { keys = JSON.parse(fs.readFileSync(p, "utf8")); break } catch (e) {} }
if (!keys || !keys.key) process.exit(3);
const out = [];
for (let id = 1; id <= 10; id++) out.push(jwt.sign({ iss: "api", attrs: { id }, scope: ["user"], jti: "water-network-deploy-" + id }, keys.key, { algorithm: "RS256", expiresIn: "10m" }));
process.stdout.write(out.join(" "));
' 2>/dev/null) || NPM_TOKENS=""
export NPM_TOKENS
'@
function Publish([hashtable]$ArgsIn) {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($ArgsIn | ConvertTo-Json -Compress)))
    # any login travels on stdin only (never on a command line or in a file)
    return Invoke-Server ($mint + "`npython3 - <<'PY'`nimport base64, json`nARGS = json.loads(base64.b64decode('$b64'))`n" + $py + "`nPY") -AllowFail
}
if ($hasNpm -and $hasPython) {
    $requestCert = $Interactive -and (Ask "If no certificate covers $hostName yet: request one from Let's Encrypt now (needs DNS of $hostName already pointing to this server)?" $false)
    $result = Publish @{ host = $hostName; request = $requestCert }
    $result | ForEach-Object { Note $_ }
    $automated = ($result -join "`n") -match '(?m)^proxy host (created|updated)'
    if (-not $automated -and $Interactive -and ($result -join "`n") -match 'auto sign-in unavailable' -and
        (Ask 'Signing in with the server key did not work. Use the nginx-proxy-manager admin login instead?' $true)) {
        $npmUser = (Read-Host '   nginx-proxy-manager admin e-mail').Trim()
        $sec = Read-Host '   nginx-proxy-manager password (hidden)' -AsSecureString
        $npmPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
        $result = Publish @{ host = $hostName; request = $requestCert; user = $npmUser; password = $npmPass }
        $npmPass = $null
        $result | ForEach-Object { Note $_ }
        $automated = ($result -join "`n") -match '(?m)^proxy host (created|updated)'
    }
    if (($result -join "`n") -match '(?m)^no certificate') { Write-Host "   Add the certificate in nginx-proxy-manager once DNS points here:" -ForegroundColor Yellow; Write-Host $manual }
}
if (-not $automated) { Write-Host $manual -ForegroundColor Yellow }

Write-Host "`nDeployed $Tag on $SshHost. SYSTEM 3D: https://$hostName (DNS A record -> the server's address)." -ForegroundColor Green
Write-Host 'Demo data for an account: seed-demo.cmd. Status: deploy-status.cmd.' -ForegroundColor Green
