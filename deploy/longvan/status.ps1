<#
  Read-only status of the SYSTEM 3D Compose stack on the longvan-dev server (decision 0033).
  Started by deploy-status.cmd when deploy.env targets compose. Changes nothing.
#>
. (Join-Path $PSScriptRoot 'common.ps1')
Step "SYSTEM 3D on $SshHost (~/$StackDir)"
try {
    $rows = Invoke-Server @'
cd water-network 2>/dev/null || { echo "not deployed"; exit 0; }
sed -n 's/^IMAGE_TAG=/tag /p; s/^FRONTEND_HOST=/host /p' .env
docker compose ps -a --format '{{.Service}}|{{.State}}|{{.Status}}|{{.Image}}'
'@
} catch { Fail "cannot reach $SshHost ($_)" }
if ($rows -contains 'not deployed') { Fail 'nothing deployed yet: run deploy-system.cmd' }
$bad = @()
foreach ($row in $rows) {
    if ($row -like 'tag *' -or $row -like 'host *') { Note $row; continue }
    $svc, $state, $status, $image = $row -split '\|'
    if (-not $svc) { continue }
    $ok = $state -eq 'running' -or ($svc -like '*-migrate' -and $status -match 'Exited \(0\)')
    $line = '{0,-28} {1,-30} {2}' -f $svc, $status, $image
    if ($ok) { Good $line } else { Bad $line; $bad += $svc }
}
foreach ($svc in $bad) {
    Write-Host "`n   last log lines of ${svc}:" -ForegroundColor Yellow
    Invoke-Server "cd water-network`ndocker compose logs --tail 25 $svc" -AllowFail | ForEach-Object { Note $_ }
}

Step 'Path: nginx-proxy-manager -> web -> /api/gis -> BFF'
Invoke-Server @'
cd water-network
docker inspect -f '{{json .NetworkSettings.Networks}}' nginx-proxy-manager 2>/dev/null | grep -q '"water-network-proxy"' \
  && echo "OK nginx-proxy-manager is on water-network-proxy" || echo "FAIL nginx-proxy-manager is not on water-network-proxy (run deploy-system.cmd)"
docker exec nginx-proxy-manager sh -c 'wget -qO- http://water-network-web:8080/health 2>&1 || curl -s http://water-network-web:8080/health' 2>&1 | head -1 | sed 's/^/nginx-proxy-manager -> web: /'
docker compose exec -T water-network-web wget -qO- http://water-network-bff:8080/health 2>&1 | head -1 | sed 's/^/web -> BFF \/health: /'
docker compose exec -T water-network-web wget -S -qO /dev/null http://water-network-bff:8080/api/gis/bootstrap 2>&1 | grep -m1 HTTP | sed 's/^ */web -> BFF \/api\/gis\/bootstrap (no token, 401 expected): /'
'@ -AllowFail | ForEach-Object { if ($_ -like 'FAIL*') { Bad $_.Substring(5) } elseif ($_ -like 'OK *') { Good $_.Substring(3) } else { Note $_ } }

$hostName = $cfg['FRONTEND_HOST']
if ($hostName) {
    Step "From this computer: https://$hostName"
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 "https://$hostName/health"
        Good "https://$hostName/health -> $($r.StatusCode) $($r.Content)"
    } catch { Bad "https://$hostName/health: $($_.Exception.Message) (DNS A record to the server? proxy host in nginx-proxy-manager?)" }
    try { $ip = [Net.Dns]::GetHostAddresses($hostName) | Select-Object -First 1; Note "$hostName resolves to $ip" } catch { }
}
Write-Host ''
