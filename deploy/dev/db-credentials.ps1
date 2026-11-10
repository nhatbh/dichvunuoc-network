<#
  Finds a PostgreSQL login that works for the SYSTEM 3D services on the dev cluster, through the
  tino32 ssh profile (VPN on). Double-click db-credentials.cmd at the repository root.

  1. Finds the database pod behind POSTGRES_HOST (deploy\dev\deploy.env).
  2. Shows how that database was started: the user/password settings of its container and where
     they come from (values or secret keys), and whether PostGIS is available.
  3. Tests every candidate login the way the services connect (TCP to the service, password
     checked): the one in deploy.env, the database pod's own settings, the namespace's secrets.
  4. Saves a working login to deploy.env (asks first).
  5. When none works and the database container lets its local admin in (the postgres image does,
     over its own socket), offers to create a dedicated login `water_network` with a generated
     password, the databases wn_gis / wn_asset / wn_design owned by it, and PostGIS in them
     (asks first; nothing else on the server is changed).

  Passwords are shown masked unless you answer yes to "Show passwords?".
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
$EnvFile = Join-Path $DeployDir 'deploy.env'
if (-not (Test-Path $EnvFile)) { Copy-Item (Join-Path $DeployDir 'deploy.env.example') $EnvFile }
$cfg = @{}
foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -gt 0) { $cfg[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim() }
}
$SshHost = if ($cfg['SSH_HOST']) { $cfg['SSH_HOST'] } else { 'tino32' }
$Ns = if ($cfg['NAMESPACE']) { $cfg['NAMESPACE'] } else { 'platform-core' }
$Kubectl = 'sudo -n k3s kubectl'

function Remote([string]$Command, [string]$StdIn) {
    if ($PSBoundParameters.ContainsKey('StdIn')) { $StdIn | & ssh -o ConnectTimeout=15 $SshHost $Command }
    else { & ssh -o ConnectTimeout=15 $SshHost $Command }
    if ($LASTEXITCODE -ne 0) { throw "on $SshHost`: $Command failed (exit $LASTEXITCODE)" }
}
function Json([string]$Command) { Remote $Command | Out-String | ConvertFrom-Json }
function Decode($raw) { if ($raw) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw)) } }
function Save-Settings([hashtable]$Values) {
    $lines = [System.Collections.Generic.List[string]](Get-Content $EnvFile -Encoding UTF8)
    foreach ($k in $Values.Keys) {
        $i = $lines.FindIndex([Predicate[string]]{ param($l) $l -match "^\s*$k\s*=" })
        if ($i -ge 0) { $lines[$i] = "$k=$($Values[$k])" } else { $lines.Add("$k=$($Values[$k])") }
    }
    Set-Content $EnvFile $lines -Encoding UTF8
}
$sq = { param([string]$v) "'" + $v.Replace("'", "'\''") + "'" }

Step "Connecting to the cluster ($SshHost) - VPN must be on"
try { Remote "$Kubectl get ns $Ns -o name" | Out-Null } catch { Fail "cannot reach the cluster through ssh $SshHost ($_)" }

# ------------------------------------------------------------------------------ the database pod
Step 'Finding the database'
if ($cfg['POSTGRES_HOST'] -notmatch '^([^.]+)\.([^.]+)\.svc') {
    Note 'POSTGRES_HOST in deploy.env is not an in-cluster service name; PostgreSQL services in the cluster:'
    Remote "$Kubectl get svc -A --no-headers | grep -iE 'postg|pgbouncer|cnpg|timescale' || true"
    $h = (Read-Host '   Service as <name>.<namespace> (e.g. postgres-water-business.platform-core)').Trim()
    if ($h -notmatch '^([^.]+)\.([^.]+)') { Fail 'no service given' }
    $cfg['POSTGRES_HOST'] = "$($Matches[1]).$($Matches[2]).svc.cluster.local"
    if (-not $cfg['POSTGRES_PORT']) { $cfg['POSTGRES_PORT'] = '5432' }
    $null = $cfg['POSTGRES_HOST'] -match '^([^.]+)\.([^.]+)\.svc'
}
$svcName = $Matches[1]; $dbNs = $Matches[2]
$port = if ($cfg['POSTGRES_PORT']) { $cfg['POSTGRES_PORT'] } else { '5432' }
$svc = Json "$Kubectl -n $dbNs get svc $svcName -o json"
$sel = ($svc.spec.selector.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ','
if (-not $sel) { Fail "service $svcName has no pod selector (an external database?); ask its owner for a login" }
$pod = @((Json "$Kubectl -n $dbNs get pods -l $sel --field-selector=status.phase=Running -o json").items) | Select-Object -First 1
if (-not $pod) { Fail "no running pod behind $svcName" }
$container = @($pod.spec.containers) | Where-Object { $_.image -match 'postg|timescale|cnpg|supabase' } | Select-Object -First 1
if (-not $container) { $container = @($pod.spec.containers)[0] }
$podRef = "pod/$($pod.metadata.name)"
$exec = "$Kubectl -n $dbNs exec -i $podRef -c $($container.name) -- sh -s"
<# Runs a shell script in the database container. Windows PowerShell ends piped text with CRLF; the
   final `exit 0` keeps sh from running that stray CR as a command. #>
function Sh([string]$Script) { (Remote $exec ($Script.Replace("`r", '') + "`nexit 0`n") | Out-String).Trim() }
Note "service $svcName.${dbNs}:$port -> $podRef, container $($container.name) ($($container.image))"

# ------------------------------------------------------------------- how the database was started
$Reveal = Ask 'Show passwords in the output?' $false
$mask = { param([string]$v) if ($Reveal) { $v } elseif ($v) { ('*' * [Math]::Min(8, $v.Length)) + " ($($v.Length) chars)" } else { '' } }
Step 'User/password settings of the database container'
$dbEnv = @{}
$secretCache = @{}
$readSecret = {
    param([string]$name)
    if (-not $secretCache.ContainsKey($name)) { $secretCache[$name] = Json "$Kubectl -n $dbNs get secret $name -o json --ignore-not-found" }
    $secretCache[$name]
}
foreach ($ef in @($container.envFrom)) {
    if ($ef.secretRef.name) {
        $s = & $readSecret $ef.secretRef.name
        foreach ($p in @($s.data.PSObject.Properties)) { $dbEnv[$p.Name] = @{ Value = (Decode $p.Value); From = "secret $($ef.secretRef.name)" } }
    }
}
foreach ($e in @($container.env)) {
    if ($null -ne $e.value) { $dbEnv[$e.name] = @{ Value = [string]$e.value; From = 'value' } }
    elseif ($e.valueFrom.secretKeyRef) {
        $r = $e.valueFrom.secretKeyRef
        $s = & $readSecret $r.name
        $dbEnv[$e.name] = @{ Value = (Decode $s.data.($r.key)); From = "secret $($r.name):$($r.key)" }
    }
}
$shown = $dbEnv.Keys | Where-Object { $_ -match 'USER|PASSWORD|DATABASE|^POSTGRES' } | Sort-Object
if (-not $shown) { Note 'none (the image may set them another way, e.g. an operator)' }
foreach ($k in $shown) {
    $v = if ($k -match 'PASSWORD') { & $mask $dbEnv[$k].Value } else { $dbEnv[$k].Value }
    Write-Host ("   {0,-32} {1,-24} {2}" -f $k, $v, $dbEnv[$k].From)
}

# ------------------------------------------------------------------------------- the candidates
$cands = [System.Collections.Generic.List[hashtable]]::new()
$addC = { param($u, $pw, $from) if ($u -and $pw -and -not ($cands | Where-Object { $_.User -eq $u -and $_.Password -eq $pw })) { $cands.Add(@{ User = $u; Password = $pw; From = $from }) } }
& $addC $cfg['POSTGRES_USER'] $cfg['POSTGRES_PASSWORD'] 'deploy.env'
foreach ($pair in @(@('POSTGRES_USER', 'POSTGRES_PASSWORD'), @('POSTGRESQL_USERNAME', 'POSTGRESQL_PASSWORD'))) {
    if ($dbEnv[$pair[1]]) {
        $u = if ($dbEnv[$pair[0]]) { $dbEnv[$pair[0]].Value } else { 'postgres' }
        & $addC $u $dbEnv[$pair[1]].Value "database container ($($pair[1]): $($dbEnv[$pair[1]].From))"
    }
}
foreach ($k in 'POSTGRES_POSTGRES_PASSWORD', 'POSTGRESQL_POSTGRES_PASSWORD') {
    if ($dbEnv[$k]) { & $addC 'postgres' $dbEnv[$k].Value "database container (${k}: $($dbEnv[$k].From))" }
}
foreach ($s in @((Json "$Kubectl -n $dbNs get secret -o json").items | Where-Object { $_.type -eq 'Opaque' -or $_.type -eq 'kubernetes.io/basic-auth' })) {
    $d = $s.data
    foreach ($pair in @(@('POSTGRES_USER', 'POSTGRES_PASSWORD'), @('username', 'password'), @('user', 'password'), @('postgres-user', 'postgres-password'), @('DB_USER', 'DB_PASSWORD'))) {
        & $addC (Decode $d.($pair[0])) (Decode $d.($pair[1])) "secret $($s.metadata.name) ($($pair[0])+$($pair[1]))"
    }
    foreach ($k in 'postgres-password', 'postgresql-password') { & $addC 'postgres' (Decode $d.$k) "secret $($s.metadata.name) ($k)" }
}

# --------------------------------------------------------------------------------- test each one
function Test-Login([string]$User, [string]$Password) {
    $script = "PGPASSWORD=$(& $sq $Password); export PGPASSWORD`n" +
        "command -v psql >/dev/null 2>&1 || { echo NO_PSQL; exit 0; }`n" +
        "psql -h $(& $sq $cfg['POSTGRES_HOST']) -p $port -U $(& $sq $User) -d postgres -tAc " +
        "`"select case when rolsuper then 'SUPERUSER' when rolcreatedb then 'CREATEDB' else 'PLAIN' end from pg_roles where rolname = current_user`" 2>&1; true`n"
    try { Sh $script } catch { "could not run psql in the database container: $_" }
}
Step "Testing $($cands.Count) candidate logins over TCP to $svcName (as the services connect)"
$working = $null
foreach ($c in $cands) {
    $out = Test-Login $c.User $c.Password
    $result = switch -Regex ($out) {
        'SUPERUSER' { 'OK (superuser)'; break }
        'CREATEDB' { 'OK (may create databases)'; break }
        'PLAIN' { 'OK (may not create databases)'; break }
        'NO_PSQL' { 'cannot test: no psql in the database container'; break }
        'password authentication failed' { 'wrong password'; break }
        'does not exist' { 'no such user'; break }
        default { ($out -split "`n")[0] }
    }
    $color = if ($result -like 'OK*') { 'Green' } else { 'Gray' }
    Write-Host ("   {0,-14} {1,-24} {2}" -f $c.User, $result, $c.From) -ForegroundColor $color
    if ($result -like 'OK*' -and -not $working) { $working = $c + @{ Result = $result } }
}

# ---------------------------------------------------------------------------- PostGIS available?
$postgis = try { Sh "psql -U postgres -d postgres -tAc `"select coalesce(max(default_version), 'none') from pg_available_extensions where name = 'postgis'`" 2>/dev/null || echo unknown" } catch { 'unknown' }
if ($postgis -match 'none') { Write-Host '   PostGIS is NOT available on this server; gis-be and design-be need it (use a postgis image).' -ForegroundColor Yellow }
elseif ($postgis -match '^\d') { Note "PostGIS $postgis available" }

if ($working) {
    Write-Host "`n   Working login: $($working.User) / $(& $mask $working.Password)  [$($working.Result); from $($working.From)]" -ForegroundColor Green
    if ($working.Result -like '*may not create*') {
        Write-Host '   This user may not create databases: wn_gis, wn_asset and wn_design (with PostGIS) must exist and be owned by it.' -ForegroundColor Yellow
    }
    if ($working.From -ne 'deploy.env' -and (Ask 'Save this login to deploy\dev\deploy.env (used by deploy-system.cmd)?' $true)) {
        Save-Settings @{ POSTGRES_USER = $working.User; POSTGRES_PASSWORD = $working.Password }
        Note "saved to $EnvFile"
    }
    exit 0
}

# --------------------------------------------- none works: a dedicated login via the local admin
Step 'No candidate logs in. Trying the database container''s local admin (its own socket)'
$admin = try { Sh "psql -U postgres -d postgres -tAc `"select 'ADMIN_OK'`" 2>&1; true" } catch { "$_" }
if ($admin -notmatch 'ADMIN_OK') {
    Fail "the local admin is not allowed either ($(($admin -split "`n")[0])). Ask the owner of $svcName for a login with CREATEDB (or the three databases with PostGIS), then put it in deploy.env."
}
Note 'the local admin (postgres over the socket) is allowed'
if (-not (Ask "Create a dedicated login 'water_network' with a generated password, and the databases wn_gis, wn_asset, wn_design owned by it (with PostGIS)? Nothing else on the server is changed." $false)) {
    Note 'nothing changed'
    exit 0
}
$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 28
$rng.GetBytes($bytes)
$newPw = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
$sql = @"
set -e
psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
DO `$`$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'water_network') THEN
    ALTER ROLE water_network WITH LOGIN CREATEDB PASSWORD '$newPw';
  ELSE
    CREATE ROLE water_network WITH LOGIN CREATEDB PASSWORD '$newPw';
  END IF;
END `$`$;
SQL
for db in wn_gis wn_asset wn_design; do
  psql -U postgres -d postgres -tAc "select 1 from pg_database where datname='`$db'" | grep -q 1 || psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "CREATE DATABASE `$db OWNER water_network"
  psql -U postgres -d `$db -c "CREATE EXTENSION IF NOT EXISTS postgis" >/dev/null 2>&1 && echo "`$db: PostGIS ready" || echo "`$db: PostGIS NOT available"
done
echo CREATED_OK
"@
$out = try { Sh $sql } catch { "$_" }
Write-Host ($out.Trim() -replace "(?m)^", '   ')
if ($out -notmatch 'CREATED_OK') { Fail 'creating the login failed (output above)' }
$check = Test-Login 'water_network' $newPw
if ($check -notmatch 'CREATEDB|SUPERUSER') { Fail "the new login does not log in over TCP: $check (the server's pg_hba.conf may not allow it)" }
Save-Settings @{ POSTGRES_USER = 'water_network'; POSTGRES_PASSWORD = $newPw }
Write-Host "`n   Login water_network created and saved to deploy.env (password $(& $mask $newPw))." -ForegroundColor Green
Write-Host '   Run deploy-system.cmd again.' -ForegroundColor Green
