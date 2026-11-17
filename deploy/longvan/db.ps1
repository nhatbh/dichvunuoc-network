<#
  The SYSTEM 3D database on the longvan-dev Compose stack (decision 0033): the PostGIS login the
  stack generated (in ~/water-network/.secrets on the server), the databases, and how to reach
  them from this computer. Started by db-credentials.cmd when deploy.env targets compose.
#>
. (Join-Path $PSScriptRoot 'common.ps1')
Step "PostgreSQL of the stack on $SshHost"
$show = Ask 'Show the password (on screen; it is shown only here)?' $false
try {
    $rows = Invoke-Server @'
cd water-network 2>/dev/null || { echo "not deployed"; exit 0; }
sed -n 's/^POSTGRES_PASSWORD=/password /p' .secrets
echo "ip $(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' water-network-postgres-1 | cut -d' ' -f1)"
docker compose exec -T postgres psql -U water -d water -Atc "select datname from pg_database where datname like 'wn_%' order by 1" | sed 's/^/db /'
docker compose exec -T postgres psql -U water -d wn_gis -Atc "select 'postgis ' || extversion from pg_extension where extname='postgis'" 2>/dev/null || true
'@
} catch { Fail "cannot reach $SshHost ($_)" }
if ($rows -contains 'not deployed') { Fail 'nothing deployed yet: run deploy-system.cmd' }
$password = ($rows | Where-Object { $_ -like 'password *' }) -replace '^password ', ''
$ip = ($rows | Where-Object { $_ -like 'ip *' }) -replace '^ip ', ''
Good 'user water'
Good "password $(if ($show) { $password } else { ('*' * [Math]::Min(8, $password.Length)) + ' (hidden)' })"
$rows | Where-Object { $_ -like 'db *' -or $_ -like 'postgis *' } | ForEach-Object { Good $_ }
Write-Host @"

   From this computer (e.g. DBeaver, psql): keep this tunnel open, then connect to localhost:15432
     ssh -N -L 15432:${ip}:5432 $SshHost
   On the server: ssh $SshHost, then: cd water-network && docker compose exec postgres psql -U water -d wn_gis
"@
$password = $null
