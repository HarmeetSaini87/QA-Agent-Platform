# ============================================================
# QA Launchpad — IIS Reverse Proxy Setup
# Run this script ONCE as Administrator on each machine.
#
# Enterprise usage: safe to re-run — idempotent where possible.
# ============================================================

# --- Auto-Elevate: re-launch as Admin if not already elevated ---
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Warning "Not running as Administrator — relaunching with elevation..."
    Start-Process PowerShell "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$siteName    = "qa-launchpad-dev"
$hostName    = "qa-launchpad.test"
$serverIP    = "10.30.155.212"
$nodePort    = 3003
$siteRoot    = "C:\inetpub\qa-launchpad-dev"
$appPoolName = "qa-launchpad-dev"
$appcmd      = "$env:windir\system32\inetsrv\appcmd.exe"

Write-Host "`n[1/7] Enabling ARR Proxy at server level..." -ForegroundColor Cyan
& $appcmd set config `
    -section:system.webServer/proxy `
    /enabled:True `
    /commit:apphost
if ($LASTEXITCODE -eq 0) { Write-Host "     ARR proxy enabled." -ForegroundColor Green }
else { Write-Host "     ARR proxy may already be enabled or check permissions." -ForegroundColor Yellow }

# ── NEW STEP: Unlock X-Forwarded-For server variable ─────────────────────────
# By default, IIS ARR does NOT allow rewrite rules to set the HTTP_X_FORWARDED_FOR
# server variable. Without this unlock, the web.config rule silently fails and the
# audit log records 127.0.0.1 (IIS loopback) instead of the real client IP.
#
# This unlock is written to applicationHost.config (machine-level) and persists
# across site/app-pool recreations. It must be done once per IIS installation.
Write-Host "`n[2/7] Unlocking required ARR server variables in applicationHost.config..." -ForegroundColor Cyan

$varsToUnlock = @(
    "HTTP_X_FORWARDED_FOR",
    "HTTP_X_FORWARDED_HOST",
    "HTTP_X_FORWARDED_PROTO"
)

foreach ($var in $varsToUnlock) {
    $result = & $appcmd set config `
        -section:system.webServer/rewrite/allowedServerVariables `
        /+"[name='$var']" `
        /commit:apphost 2>&1

    if ($result -match "already exists" -or $LASTEXITCODE -eq 0) {
        Write-Host "     Unlocked: $var" -ForegroundColor Green
    } else {
        Write-Host "     Warning unlocking $var — may already be set or check IIS ARR version." -ForegroundColor Yellow
        Write-Host "     Output: $result" -ForegroundColor DarkYellow
    }
}

Write-Host "`n[3/7] Creating site folder..." -ForegroundColor Cyan
if (-not (Test-Path $siteRoot)) {
    New-Item -ItemType Directory -Path $siteRoot | Out-Null
    Write-Host "     Created: $siteRoot" -ForegroundColor Green
} else {
    Write-Host "     Folder already exists: $siteRoot" -ForegroundColor Yellow
}

Write-Host "`n[4/7] Writing web.config (reverse proxy to localhost:$nodePort)..." -ForegroundColor Cyan
$webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!--
          QA Launchpad - IIS ARR Reverse Proxy Rule
          Forwards all traffic to the Node.js backend on localhost.

          Server variables injected for accurate audit logging:
            X-Forwarded-For   : real client IP (REMOTE_ADDR as seen by IIS)
            X-Forwarded-Host  : original Host header from the browser
            X-Forwarded-Proto : protocol used by the browser (http/https)

          IMPORTANT: HTTP_X_FORWARDED_FOR must be unlocked (step 2 above).
        -->
        <rule name="QALaunchpad-ReverseProxy" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{CACHE_URL}" pattern="^(https?)://" />
          </conditions>
          <action type="Rewrite" url="http://localhost:$nodePort/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_FOR"   value="{REMOTE_ADDR}" />
            <set name="HTTP_X_FORWARDED_HOST"  value="{HTTP_HOST}" />
            <set name="HTTP_X_FORWARDED_PROTO" value="{C:1}" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>
    <defaultDocument enabled="false" />
    <directoryBrowse enabled="false" />
    <httpProtocol>
      <customHeaders>
        <add name="Cache-Control" value="no-store, no-cache, must-revalidate" />
        <add name="Pragma" value="no-cache" />
      </customHeaders>
    </httpProtocol>
    <security>
      <requestFiltering>
        <requestLimits maxAllowedContentLength="104857600" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
"@
$webConfig | Out-File -FilePath "$siteRoot\web.config" -Encoding UTF8
Write-Host "     web.config written." -ForegroundColor Green

Write-Host "`n[5/7] Creating IIS App Pool and Site..." -ForegroundColor Cyan

# Remove existing site/pool if present
$existingSite = & $appcmd list site /name:$siteName 2>$null
if ($existingSite) {
    & $appcmd delete site /site.name:$siteName | Out-Null
    Write-Host "     Removed existing site: $siteName" -ForegroundColor Yellow
}
$existingPool = & $appcmd list apppool /name:$appPoolName 2>$null
if ($existingPool) {
    & $appcmd delete apppool /apppool.name:$appPoolName | Out-Null
}

# Create App Pool (No Managed Code — Node.js is not .NET)
& $appcmd add apppool /name:$appPoolName
& $appcmd set apppool /apppool.name:$appPoolName `
    /managedRuntimeVersion:"" `
    /startMode:"AlwaysRunning" `
    /autoStart:"true"

# Create Site
& $appcmd add site `
    /name:$siteName `
    /physicalPath:$siteRoot `
    "/bindings:http/*:80:$hostName"

# Assign pool to site
& $appcmd set app "$siteName/" `
    /applicationPool:$appPoolName

Write-Host "     Site '$siteName' created and bound to http://$hostName" -ForegroundColor Green

Write-Host "`n[6/7] Adding hosts file entry..." -ForegroundColor Cyan
$hostsFile  = "$env:windir\System32\drivers\etc\hosts"
$hostEntry  = "$serverIP`t$hostName"
$existing   = Select-String -Path $hostsFile -Pattern ([regex]::Escape($hostName)) -Quiet
if ($existing) {
    Write-Host "     Hosts entry already exists for $hostName" -ForegroundColor Yellow
} else {
    Add-Content -Path $hostsFile -Value $hostEntry
    Write-Host "     Added: $hostEntry" -ForegroundColor Green
}

Write-Host "`n[7/7] Setting up pm2 to keep Node.js running..." -ForegroundColor Cyan
$projectPath = "E:\AI Agent\qa-agent-platform-dev"
Push-Location $projectPath

# Stop any existing pm2 process for this app
& npm exec -y pm2 -- delete qa-launchpad-dev 2>$null

# Start with pm2
& npm exec -y pm2 -- start npm --name "qa-launchpad-dev" -- run ui
& npm exec -y pm2 -- save

Write-Host "     pm2 process 'qa-launchpad-dev' registered." -ForegroundColor Green
Pop-Location

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " Setup complete!" -ForegroundColor Green
Write-Host " Open: http://$hostName" -ForegroundColor White
Write-Host " Node.js running on: http://localhost:$nodePort" -ForegroundColor White
Write-Host " IIS proxying: http://$hostName  -->  localhost:$nodePort" -ForegroundColor White
Write-Host "============================================================`n" -ForegroundColor Cyan

# Quick connectivity check
Write-Host "Testing Node.js connectivity..." -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:$nodePort" -UseBasicParsing -TimeoutSec 5
    Write-Host " Node.js responded: HTTP $($r.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host " Node.js not responding yet — start the app first: npm run ui" -ForegroundColor Yellow
}

Write-Host "`n--- Verifying X-Forwarded-For unlock ---" -ForegroundColor Cyan
$check = & $appcmd list config -section:system.webServer/rewrite/allowedServerVariables 2>&1
if ($check -match "HTTP_X_FORWARDED_FOR") {
    Write-Host " HTTP_X_FORWARDED_FOR is unlocked — audit log IP capture will work correctly." -ForegroundColor Green
} else {
    Write-Host " WARNING: HTTP_X_FORWARDED_FOR may not be unlocked. Check applicationHost.config manually." -ForegroundColor Red
}

