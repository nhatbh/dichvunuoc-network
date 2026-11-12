<#
  Loads the demo network (the Vinh Thinh Dot 3 drawing) into the unit (tenant) of one account on
  the deployed SYSTEM 3D, the way a user would: CAD import with the reviewed mapping, submit to
  Design, approve and publish. The network then shows on the map for every user of that unit.

  Double-click seed-demo.cmd at the repository root. Needs the account's access token:
  sign in to the site as that account, open the browser's developer tools > Network, click any
  /api/gis request, copy the Authorization header value without "Bearer ".
  The account needs network-gis:read and network-design:read/write/approve.

  Switches: -BaseUrl https://host (default: FRONTEND_HOST in deploy.env), -Drawing <dwg>, -Yes.
  Safe to run again: the same drawing for the same unit resumes its import job instead of
  creating a second network.
#>
param([string]$BaseUrl, [string]$Drawing, [switch]$Yes)
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
try { [Console]::OutputEncoding = $OutputEncoding } catch { }
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Good($msg) { Write-Host "   OK   $msg" -ForegroundColor Green }
function Note($msg) { Write-Host "        $msg" -ForegroundColor DarkGray }
function Fail($msg) { Write-Host "   FAIL $msg" -ForegroundColor Red; exit 1 }
function Ask([string]$Question, [bool]$Default) {
    if ($Yes) { return $Default }
    $hint = if ($Default) { '[Y/n]' } else { '[y/N]' }
    $a = (Read-Host "   $Question $hint").Trim()
    if (-not $a) { return $Default }
    return $a -match '^(y|yes|c|co)$'
}

$Root = Resolve-Path (Join-Path $PSScriptRoot '../..')
$Review = Join-Path $Root 'water-network-fe/apps/gis-3d/scripts/local-stack/networks/vinh-thinh-dot3.review.json'
$EnvFile = Join-Path $PSScriptRoot 'deploy.env'
$cfg = @{}
if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
        $t = $line.Trim()
        if ($t -and -not $t.StartsWith('#') -and $t.IndexOf('=') -gt 0) { $cfg[$t.Substring(0, $t.IndexOf('=')).Trim()] = $t.Substring($t.IndexOf('=') + 1).Trim() }
    }
}
if (-not $BaseUrl) { $BaseUrl = if ($cfg['FRONTEND_HOST']) { "https://$($cfg['FRONTEND_HOST'])" } else { (Read-Host '   Site address (e.g. https://gis-dev.dichvunuoc.vn)').Trim() } }
$BaseUrl = $BaseUrl.TrimEnd('/')
if (-not $Drawing) { $Drawing = Join-Path $Root '1.MB-PP-Vinh Thinh - Dot 3.dwg' }
if (-not (Test-Path $Drawing)) {
    $Drawing = (Read-Host '   Path of "1.MB-PP-Vinh Thinh - Dot 3.dwg"').Trim('" ')
    if (-not (Test-Path $Drawing)) { Fail "drawing not found: $Drawing" }
}
if (-not (Test-Path $Review)) { Fail "reviewed mapping not found: $Review" }

# ------------------------------------------------------------------------------------ account
Step 'The account'
if ($env:WN_TOKEN) { $token = $env:WN_TOKEN.Trim() }
else {
    Write-Host '   Sign in to the site as the account, then copy its access token (developer tools > Network >'
    Write-Host '   any /api/gis request > Authorization header, without "Bearer ").'
    $sec = Read-Host '   Access token (input hidden)' -AsSecureString
    $token = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))).Trim()
}
if ($token -match '^Bearer\s+(.+)$') { $token = $Matches[1] }
$parts = $token.Split('.')
if ($parts.Count -lt 2) { Fail 'that is not an access token (three parts separated by dots)' }
$b64 = $parts[1].Replace('-', '+').Replace('_', '/')
switch ($b64.Length % 4) { 2 { $b64 += '==' } 3 { $b64 += '=' } }
$claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) | ConvertFrom-Json
$who = @($claims.preferred_username, $claims.email, $claims.name, $claims.sub) | Where-Object { $_ } | Select-Object -First 1
$unit = $null
if ($claims.organization -and -not ($claims.organization -is [array] -or $claims.organization -is [string])) {
    $o = @($claims.organization.PSObject.Properties) | Select-Object -First 1
    $unit = @($o.Value.tenant_id) | Select-Object -First 1
    if (-not $unit) { $unit = $o.Name }
}
if (-not $unit) { $unit = $claims.tenant_id }
$exp = [DateTimeOffset]::FromUnixTimeSeconds([long]$claims.exp).LocalDateTime
Note "account $who, unit $unit, token valid until $exp"
if ($exp -le (Get-Date).AddMinutes(2)) { Fail 'the token has expired (or expires in 2 minutes): sign in again and copy a fresh one' }
$perms = @($claims.permission) + @($claims.permissions) | Where-Object { $_ }
$missing = 'network-gis:read', 'network-design:read', 'network-design:write', 'network-design:approve' | Where-Object { $perms -notcontains $_ }
if ($missing) { Fail "the account lacks $($missing -join ', ') (Keycloak: give its role these permissions)" }
if (-not $unit) { Fail 'the token carries no unit (organization or tenant_id)' }

# ------------------------------------------------------------------------------------- http
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromMinutes(5)
$http.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)
function Api([string]$Method, [string]$Path, $Content) {
    $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), "$BaseUrl$Path")
    if ($Content -is [string]) { $request.Content = New-Object System.Net.Http.StringContent($Content, [Text.Encoding]::UTF8, 'application/json') }
    elseif ($Content) { $request.Content = $Content }
    $response = $http.SendAsync($request).GetAwaiter().GetResult()
    $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
        $detail = try { ($text | ConvertFrom-Json).detail } catch { $text }
        $code = [int]$response.StatusCode
        $hint = switch ($code) {
            401 { ' - sign-in refused: token expired, or the import service does not accept this unit (run check-access.cmd)' }
            403 { ' - not allowed: permissions, or the app-catalog check' }
            default { '' }
        }
        throw "$Method $Path -> $code $detail$hint"
    }
    if ($text) { return $text | ConvertFrom-Json }
}
$imports = '/api/gis/imports'
function Wait-Job($job, [int]$Minutes = 10) {
    $until = (Get-Date).AddMinutes($Minutes)
    while ($job.state -in 'queued', 'analyzing', 'submitting') {
        if ((Get-Date) -gt $until) { Fail "the import job is still '$($job.state)' after $Minutes minutes" }
        Start-Sleep -Seconds 3
        $job = Api GET "$imports/$($job.id)"
    }
    return $job
}

try {
    Step "The site ($BaseUrl)"
    $boot = Api GET '/api/gis/bootstrap'
    if ($boot.hasData) {
        Write-Host ("   Unit $unit already has a network on the map: {0} assets, {1:N0} m of pipe." -f $boot.counts.total, $boot.pipeLengthM) -ForegroundColor Yellow
        Note 'Publishing the demo adds it next to that network (an earlier run of this script is resumed instead).'
        if (-not (Ask 'Continue?' $false)) { exit 0 }
    } else { Good "unit $unit has no network yet" }
    $caps = Api GET "$imports/capabilities"
    if (-not $caps.dwgAvailable) { Fail 'the import service has no DWG converter' }

    Write-Host ''
    if (-not (Ask "Load the demo network (Vinh Thinh Dot 3, ~15 km of pipe) into unit $unit as $who?" $true)) { exit 0 }

    # ------------------------------------------------------------------------------ import
    Step 'Uploading the drawing'
    $form = New-Object System.Net.Http.MultipartFormDataContent
    $form.Add((New-Object System.Net.Http.StringContent('Demo - Vinh Thinh Dot 3')), 'name')
    $bytes = [IO.File]::ReadAllBytes($Drawing)
    $file = New-Object System.Net.Http.ByteArrayContent(, $bytes)
    $file.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
    $form.Add($file, 'files', [IO.Path]::GetFileName($Drawing))
    $job = Api POST "$imports/" $form
    Good "import job $($job.id) ($($job.state))"
    $job = Wait-Job $job
    if ($job.state -eq 'failed') { Fail "the drawing could not be read: $($job.error)" }

    if ($job.state -in 'needs_review', 'ready' -and -not $job.submission) {
        Step 'Applying the reviewed mapping (coordinates, pipe layers, valves)'
        $body = [regex]::Replace((Get-Content $Review -Raw -Encoding UTF8), '"expectedVersion"\s*:\s*\d+', "`"expectedVersion`": $($job.version)")
        $job = Api PUT "$imports/$($job.id)/review" $body
        $job = Wait-Job $job
        if ($job.state -ne 'ready') {
            $errors = @($job.issues | Where-Object { $_.severity -eq 'error' } | Select-Object -First 5)
            $errors | ForEach-Object { Write-Host "   - $($_.message)" -ForegroundColor Red }
            Fail "the drawing is not ready after the mapping ($($job.state)); open it in Import CAD > Che do chuyen sau"
        }
        Good ("{0} pipes, {1:N0} m, {2} nodes, {3} devices" -f $job.summary.keptPipes, $job.summary.totalLengthM, $job.summary.nodes, $job.summary.devices)
    }

    if (-not $job.submission -or $job.submission.status -in 'RetryRequired', 'Draft') {
        Step 'Submitting to Design'
        $job = Api POST "$imports/$($job.id)/submit" (@{ expectedVersion = $job.version; projectName = 'Demo - Vinh Thinh Dot 3' } | ConvertTo-Json)
        $job = Wait-Job $job
        if (-not $job.submission.revisionId) { Fail "Design did not accept the draft: $($job.submission.status) $($job.submission.message)" }
        Good "design revision $($job.submission.revisionId)"
    }

    Step 'Approving and publishing'
    $job = Api GET "$imports/$($job.id)/publish-result"
    if ($job.submission.status -notin 'Published', 'PartiallyPublished') {
        $evidence = "Demo data: drawing 1.MB-PP-Vinh Thinh - Dot 3, reviewed mapping vinh-thinh-dot3.review.json; loaded with seed-demo by $who."
        $job = Api POST "$imports/$($job.id)/publish" (@{ expectedVersion = $job.version; reason = 'Demo network'; lifecycleEvidence = $evidence } | ConvertTo-Json)
        $until = (Get-Date).AddMinutes(5)
        while ($job.submission.status -notin 'Published', 'PartiallyPublished') {
            if ((Get-Date) -gt $until) { Fail "not published after 5 minutes (Design status $($job.submission.status))" }
            Start-Sleep -Seconds 3
            $job = Api GET "$imports/$($job.id)/publish-result"
        }
    }
    Good "Design status $($job.submission.status)"

    Step 'Checking the map'
    $until = (Get-Date).AddMinutes(2)
    do {
        Start-Sleep -Seconds 3
        $boot = Api GET '/api/gis/bootstrap'
    } while (-not $boot.hasData -and (Get-Date) -lt $until)
    if (-not $boot.hasData) { Fail 'published, but the map has no data yet: gis-be has not applied the revision (check its RabbitMQ connection)' }
    Good ("unit {0}: {1} assets, {2:N0} m of pipe" -f $unit, $boot.counts.total, $boot.pipeLengthM)
    Write-Host "`nDone. Open $BaseUrl and sign in as an account of unit $unit." -ForegroundColor Green
} catch {
    Fail "$($_.Exception.Message)"
} finally {
    $http.Dispose()
}
