<#
  The server part of check-access.ps1 for the Compose stack (decision 0033): with the access token
  decoded by check-access.ps1 ($token, $claims), asks the import service and the BFF from inside
  the stack and shows why a sign-in is refused. Dot-sourced by check-access.ps1.
#>
. (Join-Path $PSScriptRoot 'common.ps1')
Step "2. The stack on $SshHost"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($token))
# the token goes on stdin only and reaches the container through the environment
$probe = Invoke-Server @"
cd water-network
sed -n 's/^\(APP_ENTITLEMENT_ENABLED\|ALLOW_FLAT_TENANT\|KEYCLOAK_CLIENT_ID\|JWT_AUDIENCE\)=/setting &/p' .env
T=`$(echo '$b64' | base64 -d)
export T   # passed to the container by name (docker exec -e T), never as an argument
echo '--- /api/gis/bootstrap (BFF)'
docker compose exec -T -e T water-network-web sh -c 'wget -S -qO /dev/null --header "Authorization: Bearer `$T" http://water-network-bff:8080/api/gis/bootstrap' 2>&1 | grep -m2 -E 'HTTP/|wget:' || true
echo '--- /api/gis/imports/capabilities (import service)'
docker compose exec -T -e T water-network-web sh -c 'wget -S -qO /dev/null --header "Authorization: Bearer `$T" http://water-network-import:8090/api/gis/imports/capabilities' 2>&1 | grep -m2 -E 'HTTP/|wget:' || true
echo '--- refused sign-ins (import service, last 10 minutes)'
docker compose logs --since 10m water-network-import 2>&1 | grep 'import auth refused' | tail -3 || true
echo '--- BFF warnings (last 10 minutes)'
docker compose logs --since 10m water-network-bff 2>&1 | grep -E 'WRN|ERR' | tail -5 || true
"@ -AllowFail
$probe | ForEach-Object { if ($_ -match '^setting ') { Note $_.Substring(8) } elseif ($_ -like '---*') { Note $_ } elseif ($_ -match 'HTTP/\S+ 200') { Good $_.Trim() } elseif ($_ -match 'HTTP/|wget:|refused') { Bad $_.Trim() } else { Note $_ } }
$token = $null; $b64 = $null
Write-Host ''
