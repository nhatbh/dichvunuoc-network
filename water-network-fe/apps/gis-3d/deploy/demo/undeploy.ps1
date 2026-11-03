<#
  Removes the 3D GIS demo from the tino cluster (deployment, service, ingress, configmap).
  The uploaded files stay in /srv/water-network/gis-3d-demo unless you pass -RemoveFiles.
    powershell -ExecutionPolicy Bypass -File .\undeploy.ps1 [-RemoveFiles]
#>
param([switch]$RemoveFiles, [string]$SshHost = 'tino32')
$ErrorActionPreference = 'Stop'
$cmd = 'sudo -n k3s kubectl -n platform-core delete deployment,service,ingress -l app.kubernetes.io/name=water-network-gis-3d-demo --ignore-not-found; sudo -n k3s kubectl -n platform-core delete configmap -l app.kubernetes.io/name=water-network-gis-3d-demo --ignore-not-found'
if ($RemoveFiles) { $cmd += '; sudo rm -rf /srv/water-network/gis-3d-demo' }
& ssh $SshHost $cmd
if ($LASTEXITCODE -ne 0) { throw "Failed (exit $LASTEXITCODE). Is the VPN on?" }
Write-Host 'Demo removed.' -ForegroundColor Green
