<#
  Sets up the longvan-dev access pack on this Windows computer and checks what the server offers
  for the deploy scripts. Double-click setup-longvan.cmd at the repository root.

  1. Copies the key from the access-pack folder (default D:\Work\water-network\longvan-dev, or
     -Pack <folder>) to %USERPROFILE%\.ssh\id_ed25519_longvan, readable by you only.
  2. Adds "Host longvan-ubuntu" to %USERPROFILE%\.ssh\config and the server's pinned host key
     (ED25519 SHA256:lZ4hQauLA1J4sWsBwesIqZ6WZb6FwFZX0GkNKfG77W0) to known_hosts.
  3. Connects and reports: sudo, docker, which kubectl command works (k3s, kubectl, microk8s),
     the cluster's nodes, namespaces, ingress classes, and the water-network deployments.
  4. Saves SSH_HOST and KUBECTL in deploy\dev\deploy.env, so every deploy script
     (deploy-system, deploy-status, check-access, db-credentials, replace-gis-fe) uses this server.
  Changes nothing on the server.
#>
param([string]$Pack = 'D:\Work\water-network\longvan-dev', [string]$Alias = 'longvan-ubuntu')
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Good($msg) { Write-Host "   OK   $msg" -ForegroundColor Green }
function Bad($msg) { Write-Host "   FAIL $msg" -ForegroundColor Red }
function Note($msg) { Write-Host "        $msg" -ForegroundColor DarkGray }

$Server = '103.200.24.110'
$HostKey = "$Server ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAFNzVZoXcIBQDYT9/4geDgoFPqlS7EbB0Of5eZbR0eZ"
$SshDir = Join-Path $env:USERPROFILE '.ssh'
$KeyFile = Join-Path $SshDir 'id_ed25519_longvan'

# ------------------------------------------------------------------------------------ 1. key
Step 'Installing the access pack'
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Bad 'ssh not found (Windows: Settings > Apps > Optional features > OpenSSH Client)'; exit 1 }
if (-not (Test-Path (Join-Path $Pack 'id_ed25519_longvan'))) {
    $Pack = (Read-Host '   Folder of the longvan-dev access pack (with id_ed25519_longvan)').Trim('" ')
    if (-not (Test-Path (Join-Path $Pack 'id_ed25519_longvan'))) { Bad "id_ed25519_longvan not found in $Pack"; exit 1 }
}
New-Item -ItemType Directory -Force $SshDir | Out-Null
# The signed-in account by SID: its name can differ from USERNAME (Microsoft or domain account),
# and a grant to the wrong name leaves the key unreadable ("Load key ...: Permission denied").
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$grant = "*$($me.User.Value):F"
# a key left by an earlier run may already be locked to someone else: as its owner, open it first
if (Test-Path $KeyFile) { & icacls $KeyFile /grant $grant | Out-Null }
Copy-Item (Join-Path $Pack 'id_ed25519_longvan') $KeyFile -Force
Copy-Item (Join-Path $Pack 'id_ed25519_longvan.pub') "$KeyFile.pub" -Force
# OpenSSH refuses a private key anyone else can read. Replace the whole access list (not just
# add to it): this account only, nothing inherited, no entry left by an earlier run - a grant to
# the name "Admin" can resolve to the computer itself when the computer is also named ADMIN.
try {
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetOwner($me.User)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($me.User, 'FullControl', 'Allow')))
    Set-Acl -Path $KeyFile -AclObject $acl
} catch { Bad "could not restrict access to ${KeyFile}: $($_.Exception.Message)"; exit 1 }
$others = @((Get-Acl $KeyFile).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -ne $me.User.Value })
if ($others) { Bad "others can still read the key: $(($others | ForEach-Object { $_.IdentityReference }) -join ', ')"; exit 1 }
try { [IO.File]::ReadAllBytes($KeyFile) | Out-Null }
catch {
    Bad "the key is not readable by $($me.Name) after setting its access:"
    & icacls $KeyFile | ForEach-Object { Note $_ }
    exit 1
}
Good "key in $KeyFile (readable by $($me.Name) only)"

$config = Join-Path $SshDir 'config'
$text = if (Test-Path $config) { Get-Content $config -Raw } else { '' }
if ($text -notmatch "(?m)^Host\s+$([regex]::Escape($Alias))\s*$") {
    $block = @"

Host $Alias
  HostName $Server
  User dev
  IdentityFile ~/.ssh/id_ed25519_longvan
  IdentitiesOnly yes
  ServerAliveInterval 60
  ServerAliveCountMax 3
"@
    [IO.File]::AppendAllText($config, $block.Replace("`r", ''), (New-Object System.Text.UTF8Encoding $false))
    Good "added Host $Alias to $config"
} else { Note "Host $Alias already in $config (kept)" }

$known = Join-Path $SshDir 'known_hosts'
$knownText = if (Test-Path $known) { Get-Content $known -Raw } else { '' }
if ($knownText -notmatch [regex]::Escape($HostKey)) {
    [IO.File]::AppendAllText($known, "$HostKey`n", (New-Object System.Text.UTF8Encoding $false))
    Good 'pinned the server host key in known_hosts'
} else { Note 'host key already pinned' }

# ---------------------------------------------------------------------------------- 2. probe
Step "Connecting to $Alias ($Server)"
function Remote([string]$Command) {
    $ErrorActionPreference = 'Continue'  # stderr lines of a native command are not errors here
    $out = & ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes $Alias $Command 2>&1
    return @{ Code = $LASTEXITCODE; Out = ($out | Out-String).Trim() }
}
# no double quotes in remote commands: Windows PowerShell 5.1 mangles them in native arguments
$hello = Remote 'echo $(whoami)@$(hostname)'
if ($hello.Code -ne 0) {
    Bad "ssh $Alias failed: $($hello.Out)"
    Note 'If it says "Connection timed out": the server is not reachable from this network (VPN/firewall).'
    exit 1
}
Good "signed in as $($hello.Out)"
$sudo = Remote 'sudo -n true && echo yes'
if ($sudo.Out -eq 'yes') { Good 'sudo without password' } else { Bad 'sudo asks for a password: the deploy needs sudo -n for kubectl/k3s' }
$docker = Remote 'docker version --format {{.Server.Version}} 2>/dev/null || sudo -n docker version --format {{.Server.Version}}'
if ($docker.Code -eq 0) { Good "docker $($docker.Out)" } else { Note 'no docker access' }

$kubectl = $null
foreach ($candidate in 'sudo -n k3s kubectl', 'kubectl', 'sudo -n kubectl', 'sudo -n microk8s kubectl', 'microk8s kubectl') {
    $r = Remote "$candidate get nodes -o wide 2>&1"
    if ($r.Code -eq 0 -and $r.Out -match 'Ready') { $kubectl = $candidate; $nodes = $r.Out; break }
}
if ($kubectl) {
    Good "kubectl: $kubectl"
    $nodes -split "`n" | ForEach-Object { Note $_ }
    Step 'Cluster'
    (Remote "$kubectl get ns --no-headers -o custom-columns=NAME:.metadata.name").Out -split "`n" | ForEach-Object { Note "namespace $_" }
    (Remote "$kubectl get ingressclass -o name").Out -split "`n" | ForEach-Object { Note $_ }
    $wn = Remote "$kubectl get deploy -A --no-headers 2>/dev/null | grep -iE 'water-network|keycloak|postgres|redis|rabbit|catalog|registry' || true"
    if ($wn.Out) { $wn.Out -split "`n" | ForEach-Object { Note "deploy $_" } } else { Note 'no water-network / shared-service deployments found' }
    $svc = Remote "$kubectl get svc -A --no-headers 2>/dev/null | grep -iE 'postgres|redis|rabbit|catalog' || true"
    if ($svc.Out) { $svc.Out -split "`n" | ForEach-Object { Note "service $_" } }
} else {
    Bad 'no working kubectl on the server (tried k3s, kubectl, microk8s, with and without sudo)'
    $ps = Remote 'docker ps 2>/dev/null || sudo -n docker ps'
    if ($ps.Out) { Note 'running containers:'; $ps.Out -split "`n" | Select-Object -First 40 | ForEach-Object { Note $_ } }
    $compose = Remote 'docker compose version --short 2>/dev/null || sudo -n docker compose version --short'
    $npm = Remote 'docker inspect -f {{.State.Status}} nginx-proxy-manager 2>/dev/null'
    if ($compose.Code -eq 0) { Good "docker compose $($compose.Out): the deploy scripts use Docker Compose on this server (decision 0033)" }
    else { Bad 'docker compose is not installed on the server: the Compose deploy needs it' }
    if ($npm.Out -eq 'running') { Good 'nginx-proxy-manager is running (it will serve FRONTEND_HOST)' } else { Bad 'no running nginx-proxy-manager container' }
}

# ----------------------------------------------------------------------------------- 3. save
$EnvFile = Join-Path $PSScriptRoot 'deploy.env'
if (Test-Path $EnvFile) {
    $lines = [System.Collections.Generic.List[string]](Get-Content $EnvFile -Encoding UTF8)
    $values = [ordered]@{ SSH_HOST = $Alias; DEPLOY_TARGET = $(if ($kubectl) { 'k8s' } else { 'compose' }) }
    if ($kubectl) { $values.KUBECTL = $kubectl }
    foreach ($k in $values.Keys) {
        $i = $lines.FindIndex([Predicate[string]]{ param($l) $l -match "^\s*$k\s*=" })
        if ($i -ge 0) { $lines[$i] = "$k=$($values[$k])" } else { $lines.Add("$k=$($values[$k])") }
    }
    Set-Content $EnvFile $lines -Encoding UTF8
    Good "deploy.env: SSH_HOST=$Alias, DEPLOY_TARGET=$($values.DEPLOY_TARGET)$(if ($kubectl) { ", KUBECTL=$kubectl" })"
} else { Note "no deploy.env yet: deploy-system.cmd creates it; set SSH_HOST=$Alias there" }
Write-Host "`nDone. Send this output if anything above failed." -ForegroundColor Green
