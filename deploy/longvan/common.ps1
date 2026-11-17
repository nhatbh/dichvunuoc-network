<#
  Shared by the Docker Compose deploy scripts in deploy\longvan (decision 0033): settings from
  deploy\dev\deploy.env and the ssh helpers. Dot-source it.
  The server keeps the stack in ~/water-network (compose.yaml, .env, web/); generated secrets in
  ~/water-network/.secrets (mode 600), never on this computer or in git.
#>
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
try { [Console]::OutputEncoding = $OutputEncoding } catch { }
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Good($msg) { Write-Host "   OK   $msg" -ForegroundColor Green }
function Bad($msg) { Write-Host "   FAIL $msg" -ForegroundColor Red }
function Note($msg) { Write-Host "        $msg" -ForegroundColor DarkGray }
function Fail($msg) { Write-Host "`nFAILED: $msg" -ForegroundColor Red; exit 1 }
function Ask([string]$Question, [bool]$Default = $false) {
    if ($script:Unattended) { return $Default }
    $hint = if ($Default) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        $a = (Read-Host "   $Question $hint").Trim()
        if ($a -eq '') { return $Default }
        if ($a -match '^(y|yes|c|co)$') { return $true }
        if ($a -match '^(n|no|k|khong)$') { return $false }
        Write-Host '   Answer y or n.' -ForegroundColor Yellow
    }
}

$LvDir = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $LvDir '..\..')).Path
$EnvFile = Join-Path $Root 'deploy\dev\deploy.env'
$cfg = @{}
if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
        $t = $line.Trim()
        if ($t -and -not $t.StartsWith('#') -and $t.IndexOf('=') -gt 0) { $cfg[$t.Substring(0, $t.IndexOf('=')).Trim()] = $t.Substring($t.IndexOf('=') + 1).Trim() }
    }
}
$SshHost = if ($cfg['SSH_HOST']) { $cfg['SSH_HOST'] } else { 'longvan-ubuntu' }
$StackDir = 'water-network'   # relative to the ssh user's home on the server

function Save-Setting([string]$Key, [string]$Value) {
    $lines = [System.Collections.Generic.List[string]](Get-Content $EnvFile -Encoding UTF8)
    $i = $lines.FindIndex([Predicate[string]]{ param($l) $l -match "^\s*$Key\s*=" })
    if ($i -ge 0) { $lines[$i] = "$Key=$Value" } else { $lines.Add("$Key=$Value") }
    Set-Content $EnvFile $lines -Encoding UTF8
    $script:cfg[$Key] = $Value
}

<# Runs a shell script on the server (sent on stdin: no quoting through Windows PowerShell 5.1,
   which mangles double quotes in native arguments). Returns its output lines; throws on failure
   unless -AllowFail. #>
function Invoke-Server([string]$Script, [switch]$AllowFail) {
    $text = "set -e`n" + $Script.Replace("`r", '') + "`nexit 0`n"
    $ErrorActionPreference = 'Continue'
    $out = $text | & ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost 'sh -s' 2>&1
    $code = $LASTEXITCODE
    $lines = @($out | ForEach-Object { "$_" })
    if ($code -ne 0 -and -not $AllowFail) {
        $lines | Select-Object -Last 25 | ForEach-Object { Write-Host "        $_" -ForegroundColor DarkGray }
        throw "on ${SshHost}: script failed (exit $code)"
    }
    return $lines
}

<# Writes text to a file on the server through stdin (CR removed there: Windows PowerShell adds
   CRLF when piping to a native command). #>
function Write-ServerFile([string]$Path, [string]$Content, [string]$Mode = '644') {
    $dir = $Path.Substring(0, [Math]::Max(0, $Path.LastIndexOf('/')))
    $mk = if ($dir) { "mkdir -p $dir && " } else { '' }
    $ErrorActionPreference = 'Continue'
    $Content | & ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "${mk}tr -d '\r' > $Path.new && chmod $Mode $Path.new && mv $Path.new $Path" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not write $Path on $SshHost" }
}

function Get-Target {
    if ($cfg['DEPLOY_TARGET']) { return $cfg['DEPLOY_TARGET'] }
    if ($SshHost -eq 'longvan-ubuntu') { return 'compose' }
    return 'k8s'
}
