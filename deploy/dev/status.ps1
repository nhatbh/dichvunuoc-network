<#
  Read-only status of the SYSTEM 3D deployment on the dev cluster, through the tino32 ssh profile.
  Double-click deploy-status.cmd at the repository root. Changes nothing.

  Per component: who owns the deployment (this deploy or something older), desired/ready replicas,
  autoscalers, every pod with its node, phase and restarts, recent warning events, the network
  policies that select it, and the reason a pod is not ready.
#>
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
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
function Json([string]$Command) {
    $out = & ssh -o ConnectTimeout=15 $SshHost $Command
    if ($LASTEXITCODE -ne 0) { throw "on $SshHost`: $Command failed" }
    $out | Out-String | ConvertFrom-Json
}

$names = 'water-network-gis-be', 'water-network-asset-be', 'water-network-design-be', 'water-network-topology-rs',
    'water-network-import', 'water-network-bff', 'water-network-gis-3d'
Write-Host "Reading namespace $Ns on $SshHost (VPN must be on)..." -ForegroundColor Cyan
$deps = (Json "$K get deploy -o json").items
$pods = (Json "$K get pods -o json").items
$hpas = (Json "$K get hpa -o json").items
$pols = (Json "$K get networkpolicy -o json").items
$events = (Json "$K get events -o json").items | Where-Object { $_.type -eq 'Warning' }
$rsAll = (Json "$K get rs -o json").items

$selMatch = {
    param($selector, $labels)
    if (-not $selector) { return $true }
    foreach ($p in @($selector.matchLabels.PSObject.Properties)) { if ($labels.($p.Name) -ne $p.Value) { return $false } }
    return $true
}

foreach ($n in $names) {
    $d = $deps | Where-Object { $_.metadata.name -eq $n }
    Write-Host "`n== $n" -ForegroundColor Cyan
    if (-not $d) { Write-Host '   no deployment'; continue }
    $owner = if ($d.metadata.labels.'app.kubernetes.io/part-of' -eq 'water-network-system') { 'this deploy (water-network-system)' } else { 'NOT this deploy: an older deployment of the same name' }
    $applied = if ($d.metadata.annotations.'kubectl.kubernetes.io/last-applied-configuration') { 'managed by kubectl apply' } else { 'not created by kubectl apply (other fields kept on apply)' }
    Write-Host "   owner: $owner; created $($d.metadata.creationTimestamp), $applied"
    Write-Host ("   replicas: desired {0}, updated {1}, ready {2}, available {3}" -f $d.spec.replicas, $d.status.updatedReplicas, $d.status.readyReplicas, $d.status.availableReplicas)
    foreach ($c in @($d.status.conditions)) { if ($c.status -ne 'True') { Write-Host "   condition $($c.type)=$($c.status): $($c.message)" -ForegroundColor Yellow } }
    foreach ($h in $hpas | Where-Object { $_.spec.scaleTargetRef.name -eq $n }) { Write-Host "   autoscaler $($h.metadata.name): min $($h.spec.minReplicas) max $($h.spec.maxReplicas)" -ForegroundColor Yellow }
    $sel = $d.spec.selector.matchLabels
    $mine = $pods | Where-Object { $p = $_; -not (@($sel.PSObject.Properties) | Where-Object { $p.metadata.labels.($_.Name) -ne $_.Value }) }
    foreach ($p in $mine) {
        $rs = ($p.metadata.ownerReferences | Select-Object -First 1).name
        $rsObj = $rsAll | Where-Object { $_.metadata.name -eq $rs }
        $rev = $rsObj.metadata.annotations.'deployment.kubernetes.io/revision'
        $img = ($p.spec.containers | Select-Object -First 1).image
        $cs = $p.status.containerStatuses | Select-Object -First 1
        $state = if ($p.metadata.deletionTimestamp) { 'Terminating' } elseif ($cs.state.waiting) { $cs.state.waiting.reason } elseif ($cs.ready) { 'Ready' } else { "$($p.status.phase), not ready" }
        $color = if ($state -eq 'Ready') { 'Green' } else { 'Yellow' }
        Write-Host ("   pod {0,-48} rev {1,-3} {2,-22} node {3,-12} restarts {4}  {5}" -f $p.metadata.name, $rev, $state, $p.spec.nodeName, $cs.restartCount, $img) -ForegroundColor $color
        if ($p.metadata.deletionTimestamp -and $p.metadata.finalizers) { Write-Host "      finalizers: $($p.metadata.finalizers -join ', ')" -ForegroundColor Yellow }
        foreach ($cond in @($p.status.conditions) | Where-Object { $_.status -ne 'True' -and $_.message }) { Write-Host "      $($cond.type): $($cond.message)" -ForegroundColor Yellow }
        foreach ($e in $events | Where-Object { $_.involvedObject.name -eq $p.metadata.name } | Select-Object -Last 3) { Write-Host "      event $($e.reason): $($e.message)" -ForegroundColor Yellow }
    }
    foreach ($pol in $pols) {
        $any = $mine | Select-Object -First 1
        if ($any -and (& $selMatch $pol.spec.podSelector $any.metadata.labels)) {
            $types = $pol.spec.policyTypes -join '+'
            $egress = if ($pol.spec.policyTypes -contains 'Egress') { " egress rules: $(@($pol.spec.egress).Count)" } else { '' }
            Write-Host "   network policy $($pol.metadata.name) ($types)$egress" -ForegroundColor Yellow
        }
    }
    $envNames = (($d.spec.template.spec.containers | Select-Object -First 1).env | ForEach-Object { $_.name }) -join ', '
    Write-Host "   env: $envNames" -ForegroundColor DarkGray
}
Write-Host ''
