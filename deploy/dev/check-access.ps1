<#
  Why does /api/gis answer 403? Paste the access token of the signed-in user; this checks, in the
  BFF's order, every gate a request must pass, and says which one refuses it. Read-only.

  1. The token (decoded here, never sent anywhere else): tenant (organization with tenant_id, or a
     flat tenant_id), exactly one azp (the client), the subject, the permissions.
  2. The app-catalog gate: what the BFF is configured with (AppEntitlement settings of the running
     and the earlier BFF), the apps the catalog lists for this user, and the answer of
     /me/apps/<code>/access for the configured code - asked from a pod in the cluster with the token.
  3. /api/gis/bootstrap through the BFF with the token.

  Get the token: sign in to the app, open the browser's developer tools > Network, click a
  /api/gis request, copy the Authorization header value without "Bearer ".
#>
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Good($msg) { Write-Host "   OK   $msg" -ForegroundColor Green }
function Bad($msg) { Write-Host "   FAIL $msg" -ForegroundColor Red }
function Note($msg) { Write-Host "        $msg" -ForegroundColor DarkGray }

$EnvFile = Join-Path $PSScriptRoot 'deploy.env'
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
function Remote([string]$Command, [string]$StdIn) {
    if ($PSBoundParameters.ContainsKey('StdIn')) { $StdIn | & ssh -o ConnectTimeout=15 $SshHost $Command }
    else { & ssh -o ConnectTimeout=15 $SshHost $Command }
    if ($LASTEXITCODE -ne 0) { throw "on $SshHost`: $Command failed (exit $LASTEXITCODE)" }
}
function Json([string]$Command) { Remote $Command | Out-String | ConvertFrom-Json }

if ($env:WN_TOKEN) { $token = $env:WN_TOKEN.Trim() }
else {
    $sec = Read-Host '   Access token (input hidden)' -AsSecureString
    $token = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))).Trim()
}
if ($token -match '^Bearer\s+(.+)$') { $token = $Matches[1] }
$parts = $token.Split('.')
if ($parts.Count -lt 2) { Write-Host 'That is not a JWT (three parts separated by dots).' -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------------- 1. token
Step '1. The token'
$b64 = $parts[1].Replace('-', '+').Replace('_', '/')
switch ($b64.Length % 4) { 2 { $b64 += '==' } 3 { $b64 += '=' } }
$claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) | ConvertFrom-Json
$exp = [DateTimeOffset]::FromUnixTimeSeconds([long]$claims.exp).LocalDateTime
if ($exp -gt (Get-Date)) { Good "valid until $exp" } else { Bad "expired at $exp - sign in again and copy a fresh token" }
Note "issuer $($claims.iss); audience $(@($claims.aud) -join ', ')"
if (@($claims.aud) -contains 'water-platform') { Good 'audience includes water-platform' } else { Bad "audience is $(@($claims.aud) -join ', '), the services expect water-platform (Keycloak: an audience mapper on the client)" }
$azp = @($claims.azp)
if ($azp.Count -eq 1 -and $azp[0]) { Good "client (azp) $($azp[0])" } else { Bad 'no single azp claim' }
if ($claims.sub) { Good "subject $($claims.sub)" } else { Bad 'no sub claim (Keycloak 26: the basic scope must be on the client)' }
$tenant = $null
if ($claims.organization -is [array] -or $claims.organization -is [string]) {
    Bad "organization is a plain list ($(@($claims.organization) -join ', ')): its tenant_id attribute is not in the token (Keycloak: organization mapper with 'Add organization attributes')"
} elseif ($claims.organization) {
    $orgs = @($claims.organization.PSObject.Properties)
    foreach ($o in $orgs) {
        $tid = @($o.Value.tenant_id) | Select-Object -First 1
        if ($tid) { Good "organization $($o.Name), tenant_id $tid"; $tenant = $tid } else { Bad "organization $($o.Name) has no tenant_id attribute" }
    }
    if ($orgs.Count -gt 1) { Bad "member of $($orgs.Count) organizations in this token; the services need exactly one (sign in with organization:<alias>)" }
} elseif ($claims.tenant_id) { Note "flat tenant_id $($claims.tenant_id) (accepted only without an organization claim, and only where flat tenants are allowed)"; $tenant = $claims.tenant_id }
else { Bad 'no organization (and no tenant_id) in the token: the user is not a member of an organization, or the organization scope is not requested' }
$perms = @($claims.permission) + @($claims.permissions) | Where-Object { $_ }
if ($perms) { Note "permissions: $($perms -join ', ')" } else { Bad 'no permission claims' }
foreach ($p in 'network-gis:read', 'network-design:read', 'network-design:write', 'network-design:approve') {
    if ($perms -contains $p) { Good $p } elseif ($p -eq 'network-gis:read') { Bad "$p missing: the map (bootstrap) is refused" } else { Note "$p missing (needed for the editor / approval)" }
}

# ------------------------------------------------------------------------ 2. app-catalog gate
Step '2. The app-catalog gate'
$rsList = (Json "$K get rs -l app=water-network-bff -o json").items | Where-Object { $_.spec.replicas -gt 0 -or $_.status.replicas -gt 0 }
$code = $null; $catalog = $null
$earlier = $null
foreach ($rs in $rsList) {
    $rsEnv = @{}
    foreach ($e in @(($rs.spec.template.spec.containers | Select-Object -First 1).env)) { if ($null -ne $e.value) { $rsEnv[$e.name] = $e.value } }
    $who = if ($rs.spec.template.metadata.labels.'app.kubernetes.io/part-of' -eq 'water-network-system') { 'this deploy' } else { 'earlier deployment' }
    Note ("BFF {0} ({1}): AppCode={2}  BaseUrl={3}" -f $rs.metadata.name, $who, $rsEnv['AppEntitlement__AppCode'], $rsEnv['AppEntitlement__BaseUrl'])
    if ($who -eq 'this deploy') { $code = $rsEnv['AppEntitlement__AppCode']; $catalog = $rsEnv['AppEntitlement__BaseUrl'] }
    elseif ($rsEnv['AppEntitlement__AppCode'] -and -not $earlier) { $earlier = @{ Code = $rsEnv['AppEntitlement__AppCode']; Url = $rsEnv['AppEntitlement__BaseUrl'] } }
}
if (-not $catalog) { $catalog = $cfg['APP_CATALOG_URL']; $code = $cfg['APP_CODE'] }
# The app catalog only accepts the BFF (network policies), and the BFF image has no HTTP client.
# A short-lived probe pod with the BFF's app label asks it instead: the web image (busybox wget),
# a readiness probe that never passes so the BFF service never sends it traffic, removed after.
$web = Json "$K get deploy water-network-gis-3d -o json --ignore-not-found"
if (-not $web) { $web = Json "$K get deploy water-network-gis -o json" }
$image = ($web.spec.template.spec.containers | Select-Object -First 1).image
$probe = 'water-network-bff-access-probe'
$manifest = @"
apiVersion: v1
kind: Pod
metadata:
  name: $probe
  namespace: $Ns
  labels: { app: water-network-bff, app.kubernetes.io/part-of: water-network-system, water-network/probe: "true" }
spec:
  restartPolicy: Never
  activeDeadlineSeconds: 300
  containers:
    - name: probe
      image: $image
      command: ["sh", "-c", "sleep 240"]
      readinessProbe: { exec: { command: ["false"] }, periodSeconds: 60 }
"@
$base = $catalog.TrimEnd('/')
$out = @()
try {
    Remote "$K delete pod $probe --ignore-not-found --wait=true" | Out-Null
    Remote "$K apply -f -" $manifest | Out-Null
    Remote "$K wait --for=jsonpath={.status.phase}=Running pod/$probe --timeout=90s" | Out-Null
    $script = @"
echo '--- apps listed for this user'
wget -q -T 10 -O - --header "Authorization: Bearer `$T" '$base/api/platform/app-catalog/me/apps' 2>&1 | head -c 3000; echo
echo '--- access to $code'
wget -S -T 10 -O /dev/null --header "Authorization: Bearer `$T" '$base/api/platform/app-catalog/me/apps/$code/access' 2>&1 | grep -E 'HTTP/|wget:' | head -3
echo '--- /api/gis/bootstrap through the BFF'
wget -S -T 15 -O - --header "Authorization: Bearer `$T" 'http://water-network-bff:8080/api/gis/bootstrap' 2>&1 | grep -E 'HTTP/|wget:|schemaVersion|hasData' | head -4
"@
    # the token goes on stdin first, read into T (never on a command line)
    $out = Remote "$K exec -i pod/$probe -- sh -c 'read -r T; export T; sh -s'" ($token + "`n" + $script.Replace("`r", '') + "`nexit 0`n")
} catch { $out = @("could not run the probe pod: $_") }
finally { try { Remote "$K delete pod $probe --ignore-not-found --wait=false" | Out-Null } catch { } }
$out | ForEach-Object { Write-Host "        $_" }
$joined = ($out | Out-String)
if ($joined -match "access to [^\n]*\n[^\n]*HTTP/\S+ 204") { Good "the catalog allows app '$code' for this user" }
elseif ($joined -match "access to [^\n]*\n[^\n]*HTTP/\S+ 403") { Bad "the catalog denies app '$code' for this user: check the code in the list above (APP_CODE in deploy.env) or give the user's organization the app" }
if ($joined -match 'bootstrap[^\n]*\n[^\n]*HTTP/\S+ 200') { Good '/api/gis/bootstrap answers 200 with this token' }

# the earlier BFF ran with other app-catalog settings: offer them
if ($earlier -and ($earlier.Code -ne $code -or ($earlier.Url -and $earlier.Url -ne $catalog))) {
    Write-Host "`n   The earlier BFF used AppCode=$($earlier.Code), BaseUrl=$($earlier.Url) (this deploy: $code, $catalog)." -ForegroundColor Yellow
    $a = (Read-Host '   Use the earlier settings in deploy.env (then run deploy-system.cmd without building)? [Y/n]').Trim()
    if ($a -eq '' -or $a -match '^(y|yes|c|co)$') {
        $lines = [System.Collections.Generic.List[string]](Get-Content $EnvFile -Encoding UTF8)
        foreach ($kv in @(@('APP_CODE', $earlier.Code), @('APP_CATALOG_URL', $earlier.Url))) {
            if (-not $kv[1]) { continue }
            $i = $lines.FindIndex([Predicate[string]]{ param($l) $l -match "^\s*$($kv[0])\s*=" })
            if ($i -ge 0) { $lines[$i] = "$($kv[0])=$($kv[1])" } else { $lines.Add("$($kv[0])=$($kv[1])") }
        }
        Set-Content $EnvFile $lines -Encoding UTF8
        Write-Host "   saved to $EnvFile" -ForegroundColor Green
    }
}
Write-Host ''
