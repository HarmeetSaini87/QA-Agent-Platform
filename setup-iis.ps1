# ============================================================
# QA Launchpad — IIS Reverse Proxy Setup
# Run this script ONCE as Administrator
# ============================================================

$siteName    = "qa-launchpad"
$hostName    = "qa-launchpad.local"
$serverIP    = "10.30.155.212"
$nodePort    = 3000
$siteRoot    = "C:\inetpub\qa-launchpad"
$appPoolName = "qa-launchpad-pool"

Write-Host "`n[1/6] Enabling ARR Proxy at server level..." -ForegroundColor Cyan
& "$env:windir\system32\inetsrv\appcmd.exe" set config `
    -section:system.webServer/proxy `
    /enabled:True `
    /commit:apphost
if ($LASTEXITCODE -eq 0) { Write-Host "     ARR proxy enabled." -ForegroundColor Green }
else { Write-Host "     ARR proxy may already be enabled or check permissions." -ForegroundColor Yellow }

Write-Host "`n[2/6] Creating site folder..." -ForegroundColor Cyan
if (-not (Test-Path $siteRoot)) {
    New-Item -ItemType Directory -Path $siteRoot | Out-Null
    Write-Host "     Created: $siteRoot" -ForegroundColor Green
} else {
    Write-Host "     Folder already exists: $siteRoot" -ForegroundColor Yellow
}

Write-Host "`n[3/6] Writing web.config (reverse proxy to localhost:$nodePort)..." -ForegroundColor Cyan
$webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="QALaunchpad-ReverseProxy" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{CACHE_URL}" pattern="^(https?)://" />
          </conditions>
          <action type="Rewrite" url="http://localhost:$nodePort/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
            <set name="HTTP_X_FORWARDED_PROTO" value="http" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>
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

Write-Host "`n[4/6] Creating IIS App Pool and Site..." -ForegroundColor Cyan

# Remove existing site/pool if present
$existingSite = & "$env:windir\system32\inetsrv\appcmd.exe" list site /name:$siteName 2>$null
if ($existingSite) {
    & "$env:windir\system32\inetsrv\appcmd.exe" delete site /site.name:$siteName | Out-Null
    Write-Host "     Removed existing site: $siteName" -ForegroundColor Yellow
}
$existingPool = & "$env:windir\system32\inetsrv\appcmd.exe" list apppool /name:$appPoolName 2>$null
if ($existingPool) {
    & "$env:windir\system32\inetsrv\appcmd.exe" delete apppool /apppool.name:$appPoolName | Out-Null
}

# Create App Pool (No Managed Code — Node.js is not .NET)
& "$env:windir\system32\inetsrv\appcmd.exe" add apppool /name:$appPoolName
& "$env:windir\system32\inetsrv\appcmd.exe" set apppool /apppool.name:$appPoolName `
    /managedRuntimeVersion:"" `
    /startMode:"AlwaysRunning" `
    /autoStart:"true"

# Create Site
& "$env:windir\system32\inetsrv\appcmd.exe" add site `
    /name:$siteName `
    /physicalPath:$siteRoot `
    "/bindings:http/*:80:$hostName"

# Assign pool to site
& "$env:windir\system32\inetsrv\appcmd.exe" set app "$siteName/" `
    /applicationPool:$appPoolName

Write-Host "     Site '$siteName' created and bound to http://$hostName" -ForegroundColor Green

Write-Host "`n[5/6] Adding hosts file entry..." -ForegroundColor Cyan
$hostsFile  = "$env:windir\System32\drivers\etc\hosts"
$hostEntry  = "$serverIP`t$hostName"
$existing   = Select-String -Path $hostsFile -Pattern ([regex]::Escape($hostName)) -Quiet
if ($existing) {
    Write-Host "     Hosts entry already exists for $hostName" -ForegroundColor Yellow
} else {
    Add-Content -Path $hostsFile -Value $hostEntry
    Write-Host "     Added: $hostEntry" -ForegroundColor Green
}

Write-Host "`n[6/6] Setting up pm2 to keep Node.js running..." -ForegroundColor Cyan
$projectPath = "E:\AI Agent\qa-agent-platform"
Push-Location $projectPath

# Stop any existing pm2 process for this app
& npm exec -y pm2 -- delete qa-launchpad 2>$null

# Start with pm2
& npm exec -y pm2 -- start npm --name "qa-launchpad" -- run ui
& npm exec -y pm2 -- save

Write-Host "     pm2 process 'qa-launchpad' registered." -ForegroundColor Green
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
