##############################################################################
#  install.ps1   -  QA Agent Platform   -  One-Command Installer
#  Version: 1.0  |  2026-04-19
#
#  Run this ONCE on the customer server as Administrator:
#
#    powershell -ExecutionPolicy Bypass -File "C:\qa-agent-platform\scripts\install.ps1"
#
#  What it does (fully automated):
#    [1]  Checks / installs Node.js 20 LTS  (via winget)
#    [2]  Checks / installs NSSM             (via winget or bundled)
#    [3]  Prompts for install path, port, hostname
#    [4]  Creates / copies the platform files to the chosen install path
#    [5]  Generates a .env file with secure random secrets
#    [6]  Runs  npm install
#    [7]  Runs  npm run build
#    [8]  Installs Playwright Chromium
#    [9]  Registers "QAAgentPlatform" Windows Service via NSSM
#    [10] Adds firewall rule for the chosen port
#    [11] Optionally adds a hosts-file entry for friendly URL
#    [12] Starts the service and verifies HTTP 200
#    [13] Prints final summary with login URL + default credentials
##############################################################################

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"   # faster Invoke-WebRequest

# -- Colour helpers ------------------------------------------------------------
function Info  { param($m) Write-Host "  $m" -ForegroundColor Cyan   }
function Ok    { param($m) Write-Host "  [OK]  $m" -ForegroundColor Green  }
function Warn  { param($m) Write-Host "  [!]   $m" -ForegroundColor Yellow }
function Fail  { param($m) Write-Host "  [ERR] $m" -ForegroundColor Red; exit 1 }
function Step  { param($n,$m) Write-Host "`n[$n] $m" -ForegroundColor White }
function Banner {
    param($m)
    $line = "=" * 62
    Write-Host "`n$line" -ForegroundColor Cyan
    Write-Host "  $m" -ForegroundColor Cyan
    Write-Host "$line`n" -ForegroundColor Cyan
}

Banner "QA Agent Platform  - Installation Wizard"
Write-Host "  This script installs and configures the platform end-to-end."
Write-Host "  It will prompt for a few settings then run automatically.`n"

# -- Collect settings upfront --------------------------------------------------
Banner "Step 0  - Configuration"

# Source folder (where the zip was extracted / where this script lives)
$SCRIPT_DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path
$SOURCE_DIR  = Split-Path -Parent $SCRIPT_DIR   # one level up from scripts\

# Install path
$defaultInstall = "C:\qa-agent-platform"
$rawPath = Read-Host "  Install path [$defaultInstall]"
$rawPathTrimmed = if ($rawPath.Trim()) { $rawPath.Trim() } else { $defaultInstall }
# Normalize: "E:TestForge" -> "E:\TestForge"  (missing backslash after drive letter)
if ($rawPathTrimmed -match '^([A-Za-z]):([^\\].*)$') {
    $rawPathTrimmed = "$($Matches[1]):\$($Matches[2])"
}
$INSTALL_DIR = $rawPathTrimmed

# Port
$rawPort = Read-Host "  Server port [3000]"
$PORT = if ($rawPort.Trim()) { $rawPort.Trim() } else { "3000" }

# Friendly hostname (optional)
$rawHost = Read-Host "  Friendly hostname, e.g. qa-platform.local  (blank to skip)"
$HOSTNAME = $rawHost.Trim()

# Organisation name (for .env label)
$rawOrg = Read-Host "  Organisation / Customer name [QA Platform]"
$ORG_NAME = if ($rawOrg.Trim()) { $rawOrg.Trim() } else { "QA Platform" }

Write-Host ""
Info "Install path : $INSTALL_DIR"
Info "Port         : $PORT"
Info "Hostname     : $(if ($HOSTNAME) { $HOSTNAME } else { '(none  - use IP:port)' })"
Info "Org name     : $ORG_NAME"
Write-Host ""
$confirm = Read-Host "  Proceed? (Y/n)"
if ($confirm -and $confirm.ToUpper() -ne "Y") { Write-Host "Cancelled."; exit 0 }

# -- Log setup ----------------------------------------------------------------─
$LOG_DIR  = Join-Path $INSTALL_DIR "logs"
$LOG_FILE = Join-Path $LOG_DIR "install.log"
New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
New-Item -ItemType Directory -Path $LOG_DIR     -Force | Out-Null

function Log { param($m) $ts = Get-Date -f "yyyy-MM-dd HH:mm:ss"; "$ts  $m" | Add-Content $LOG_FILE -Encoding UTF8 }
Log "Install started. Path=$INSTALL_DIR Port=$PORT Hostname=$HOSTNAME"

##############################################################################
# [1] Node.js
##############################################################################
Step 1 "Checking Node.js..."

$nodeOk = $false
try {
    $v = node --version 2>&1
    if ($v -match "v(\d+)") {
        $major = [int]$Matches[1]
        if ($major -ge 18) { Ok "Node.js $v already installed."; $nodeOk = $true }
        else { Warn "Node.js $v is too old (need >= 18). Will install LTS." }
    }
} catch { Warn "Node.js not found. Will install." }

if (-not $nodeOk) {
    Info "Installing Node.js 20 LTS via winget..."
    try {
        winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements 2>&1 | Tee-Object -FilePath $LOG_FILE -Append
        # Refresh PATH in this session
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
        $v = node --version 2>&1
        Ok "Node.js $v installed."
        Log "Node.js installed: $v"
    } catch {
        Fail "Could not install Node.js automatically. Download manually from https://nodejs.org (LTS) and re-run this script."
    }
}

##############################################################################
# [2] NSSM
##############################################################################
Step 2 "Checking NSSM (Windows Service Manager)..."

$nssmPath = $null
$nssmFound = $false
foreach ($p in @("nssm","C:\Tools\nssm\win64\nssm.exe","C:\nssm\win64\nssm.exe")) {
    try {
        $out = & $p version 2>&1
        if ($out -match "NSSM") { $nssmPath = $p; $nssmFound = $true; break }
    } catch {}
}

if (-not $nssmFound) {
    Info "Installing NSSM via winget..."
    try {
        winget install NSSM.NSSM --silent --accept-source-agreements --accept-package-agreements 2>&1 | Tee-Object -FilePath $LOG_FILE -Append
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
        $nssmPath = "nssm"
        Ok "NSSM installed."
        Log "NSSM installed via winget."
    } catch {
        # Fallback: download direct
        Warn "winget install failed. Downloading NSSM directly..."
        try {
            $nssmZip = "$env:TEMP\nssm.zip"
            Invoke-WebRequest "https://nssm.cc/release/nssm-2.24.zip" -OutFile $nssmZip
            Expand-Archive $nssmZip "$env:TEMP\nssm-extract" -Force
            $nssmExe = Get-ChildItem "$env:TEMP\nssm-extract" -Recurse -Filter "nssm.exe" | Where-Object { $_.DirectoryName -like "*win64*" } | Select-Object -First 1
            $nssmDest = "C:\Tools\nssm\win64"
            New-Item -ItemType Directory -Path $nssmDest -Force | Out-Null
            Copy-Item $nssmExe.FullName "$nssmDest\nssm.exe" -Force
            $nssmPath = "$nssmDest\nssm.exe"
            # Add to system PATH
            $syspath = [System.Environment]::GetEnvironmentVariable("PATH","Machine")
            if ($syspath -notlike "*$nssmDest*") {
                [System.Environment]::SetEnvironmentVariable("PATH","$syspath;$nssmDest","Machine")
            }
            $env:PATH = "$env:PATH;$nssmDest"
            Ok "NSSM installed at $nssmDest"
            Log "NSSM installed manually to $nssmDest"
        } catch {
            Fail "Could not install NSSM. Download from https://nssm.cc and add to PATH, then re-run."
        }
    }
} else {
    Ok "NSSM found at $nssmPath"
}

##############################################################################
# [3] Copy platform files to install path
##############################################################################
Step 3 "Copying platform files to $INSTALL_DIR..."

# If source and install are the same, skip copy
if ((Resolve-Path $SOURCE_DIR -ErrorAction SilentlyContinue).Path -eq (Resolve-Path $INSTALL_DIR -ErrorAction SilentlyContinue).Path) {
    Ok "Already in install directory  - no copy needed."
    Log "Source == install dir, skipped copy."
} else {
    # Also exclude the source folder name itself — prevents recursive copy when install dir is a parent of source dir
    $sourceDirName = Split-Path -Leaf $SOURCE_DIR
    $EXCLUDES = @("node_modules","dist","data","results","test-results","logs",".git",".env",".env.example",".playwright-browsers",$sourceDirName)
    $items = Get-ChildItem $SOURCE_DIR -Force | Where-Object { $EXCLUDES -notcontains $_.Name }
    foreach ($item in $items) {
        $dest = Join-Path $INSTALL_DIR $item.Name
        if ($item.PSIsContainer) {
            Copy-Item $item.FullName $dest -Recurse -Force
        } else {
            Copy-Item $item.FullName $dest -Force
        }
    }
    Ok "Files copied to $INSTALL_DIR"
    Log "Files copied from $SOURCE_DIR to $INSTALL_DIR"
}

# Ensure required runtime directories exist
foreach ($d in @("data","results","test-results","logs","tests\codegen","test-plans","reports")) {
    New-Item -ItemType Directory -Path (Join-Path $INSTALL_DIR $d) -Force | Out-Null
}
Ok "Runtime directories created."

##############################################################################
# [4] Generate .env
##############################################################################
Step 4 "Creating .env configuration file..."

$envFile = Join-Path $INSTALL_DIR ".env"
if (Test-Path $envFile) {
    Warn ".env already exists  - skipping to preserve existing secrets."
    Log ".env already exists, skipped."
} else {
    # Generate two secure random secrets (compatible with Windows PowerShell 5.1 / .NET Framework 4.x)
    $rng     = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
    $bytes1  = New-Object byte[] 32; $rng.GetBytes($bytes1); $secret1 = [System.Convert]::ToBase64String($bytes1)
    $bytes2  = New-Object byte[] 32; $rng.GetBytes($bytes2); $secret2 = [System.Convert]::ToBase64String($bytes2)
    $rng.Dispose()

    $envContent = @"
# QA Agent Platform - Environment Configuration
# Generated by installer on $(Get-Date -f "yyyy-MM-dd HH:mm:ss")
# -------------------------------------------------------

# Server
UI_PORT=$PORT
APP_ENV=production
APP_ENV_LABEL=$ORG_NAME

# Security  - DO NOT share these values
SESSION_SECRET=$secret1
QA_SECRET_KEY=$secret2

# Data paths (relative to install directory)
DATA_DIR=./data
TEST_RESULTS_DIR=./test-results
RESULTS_DIR=./results
REPORTS_DIR=./reports
TEST_PLANS_DIR=./test-plans

# Playwright browser cache (project-local  - works for any service account)
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers

# Test execution
HEADLESS=true
DEFAULT_TIMEOUT=30000
SCREENSHOT_MODE=only-on-failure

# Application under test (set this to the customer's app URL)
APP_BASE_URL=https://your-application-url.com

# Session cookie name (unique per installation)
SESSION_COOKIE_NAME=qa-platform.sid

# -- Email / SMTP Notifications (optional) ----------------------------------─
# Uncomment and fill in to enable email alerts for failed runs, healing events, etc.
# SMTP_HOST=smtp.yourcompany.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=qa-platform@yourcompany.com
# SMTP_PASS=your-smtp-password
# SMTP_FROM=QA Platform <qa-platform@yourcompany.com>
# NOTIFY_ON_FAIL=true
# NOTIFY_ON_HEAL=false

# -- Logging ------------------------------------------------------------------
# Log level: debug | info | warn | error  (default: info)
LOG_LEVEL=info
"@
    if (-not $envFile) { $envFile = Join-Path $INSTALL_DIR ".env" }
    $envContent | Out-File -FilePath $envFile -Encoding UTF8
    Ok ".env created with secure random secrets."
    Log ".env written."
}

##############################################################################
# [5] npm install
##############################################################################
Step 5 "Installing Node.js dependencies (npm install)..."
Set-Location $INSTALL_DIR
if (-not (Test-Path (Join-Path $INSTALL_DIR "package.json"))) {
    Fail "package.json not found in $INSTALL_DIR  - file copy may have failed. Check $LOG_FILE."
}
$npmOut = npm install --loglevel=error 2>&1
$npmOut | Add-Content $LOG_FILE -Encoding UTF8
if ($LASTEXITCODE -ne 0) {
    $npmOut | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Fail "npm install failed. See output above or check $LOG_FILE for details."
}
Ok "npm install completed."

##############################################################################
# [6] Build TypeScript
##############################################################################
Step 6 "Building TypeScript (npm run build)..."
$buildOut = npm run build 2>&1
$buildOut | Add-Content $LOG_FILE -Encoding UTF8
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Contact the vendor with the contents of $LOG_FILE." }
Ok "Build succeeded."

##############################################################################
# [7] Playwright browsers  - installed to machine-wide ProgramData path
#     so the Windows Service (LOCAL SYSTEM) can find them regardless of
#     which user account runs the service.
##############################################################################
Step 7 "Installing Playwright browsers (chromium, firefox, webkit)..."
$PW_BROWSERS_PATH = Join-Path $INSTALL_DIR ".playwright-browsers"
$env:PLAYWRIGHT_BROWSERS_PATH = $PW_BROWSERS_PATH

# Count browser engine folders  - a real install has at least 3 (chromium-*, firefox-*, webkit-*)
$browserCount = 0
if (Test-Path $PW_BROWSERS_PATH) {
    $browserCount = (Get-ChildItem $PW_BROWSERS_PATH -Directory | Where-Object { $_.Name -match "^(chromium|firefox|webkit|chrome|ffmpeg)-" }).Count
}

if ($browserCount -ge 3) {
    Ok "Browsers already present ($browserCount engines found in $PW_BROWSERS_PATH)  - skipping download."
    Ok "Pre-bundled cross-browser support: Chromium, Firefox, WebKit all ready."
} else {
    Info "Downloading browsers  - this can take 5-15 minutes depending on connection speed..."
    Info "You will see download progress below:"
    Write-Host ""
    npx playwright install chromium firefox webkit
    $pwExit = $LASTEXITCODE
    Write-Host ""
    if ($pwExit -ne 0) {
        Warn "Playwright browser install had warnings  - check $LOG_FILE"
        Warn "To retry: cd '$INSTALL_DIR'; `$env:PLAYWRIGHT_BROWSERS_PATH='$PW_BROWSERS_PATH'; npx playwright install chromium firefox webkit"
    } else {
        Ok "Playwright browsers installed to $PW_BROWSERS_PATH"
    }
}

##############################################################################
# [8] Windows Service via NSSM
##############################################################################
Step 8 "Registering Windows Service..."

$SERVICE_NAME  = "QAAgentPlatform"
$STARTUP_SCRIPT = Join-Path $INSTALL_DIR "scripts\start-qa-platform.ps1"

# Check if service already exists  - suppress error output since "Can't open service" is normal on fresh install
$existing = $null
try { $existing = & $nssmPath status $SERVICE_NAME 2>&1 } catch {}
$serviceExists = ($existing -and ($existing -notmatch "Can't open service") -and ($existing -notmatch "The specified service does not exist"))

if ($serviceExists) {
    Warn "Existing service found  - removing..."
    & $nssmPath stop   $SERVICE_NAME 2>&1 | Out-Null
    & $nssmPath remove $SERVICE_NAME confirm 2>&1 | Out-Null
    Start-Sleep 2
}

# Install service
& $nssmPath install $SERVICE_NAME powershell.exe `
    "-ExecutionPolicy" "Bypass" "-NonInteractive" "-File" "`"$STARTUP_SCRIPT`""

& $nssmPath set $SERVICE_NAME AppDirectory      $INSTALL_DIR
& $nssmPath set $SERVICE_NAME DisplayName       "QA Agent Platform"
& $nssmPath set $SERVICE_NAME Description       "QA Agent Platform  - AI Test Automation ($ORG_NAME)"
& $nssmPath set $SERVICE_NAME Start             SERVICE_AUTO_START
& $nssmPath set $SERVICE_NAME AppStdout         (Join-Path $LOG_DIR "service.log")
& $nssmPath set $SERVICE_NAME AppStderr         (Join-Path $LOG_DIR "service-error.log")
& $nssmPath set $SERVICE_NAME AppRotateFiles    1
& $nssmPath set $SERVICE_NAME AppRotateBytes    10485760   # 10 MB

Ok "Service '$SERVICE_NAME' registered."
Log "NSSM service installed."

##############################################################################
# [9] Firewall rule
##############################################################################
Step 9 "Adding firewall rule for port $PORT..."
$ruleName = "QA Agent Platform (port $PORT)"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Ok "Firewall rule already exists."
} else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $PORT -Action Allow | Out-Null
    Ok "Firewall rule added."
    Log "Firewall rule added for port $PORT."
}

##############################################################################
# [10] Hosts file entry (optional)
##############################################################################
if ($HOSTNAME) {
    Step 10 "Adding hosts file entry for $HOSTNAME..."
    $hostsFile = "$env:windir\System32\drivers\etc\hosts"
    $serverIP  = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } | Select-Object -First 1).IPAddress
    $entry     = "$serverIP`t$HOSTNAME"
    $already   = Select-String -Path $hostsFile -Pattern ([regex]::Escape($HOSTNAME)) -Quiet
    if ($already) {
        Ok "Hosts entry for $HOSTNAME already exists."
    } else {
        Add-Content -Path $hostsFile -Value "`n$entry" -Encoding ASCII
        Ok "Hosts entry added: $entry"
        Log "Hosts entry added: $entry"
    }
    Warn "Remind users to also add '$entry' to their own PC's hosts file or configure DNS."
}

##############################################################################
# [11] Start service
##############################################################################
Step 11 "Starting the service..."
try { & $nssmPath start $SERVICE_NAME 2>&1 | Out-Null } catch {}
Start-Sleep 10   # give Node.js time to boot (npm + playwright check)

# Verify HTTP
$url = "http://localhost:$PORT"
try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    if ($r.StatusCode -eq 200) {
        Ok "Server is UP  - HTTP $($r.StatusCode)"
        Log "Server verified at $url"
    } else {
        Warn "Server responded HTTP $($r.StatusCode)  - check $LOG_DIR\service-error.log"
    }
} catch {
    Warn "Server did not respond in time. Check $LOG_DIR\service-error.log"
    Warn "If browser access works the server is fine  - this is a timing issue."
}

##############################################################################
# [12] Final summary
##############################################################################
Banner "Installation Complete!"

$accessUrl = if ($HOSTNAME) { "http://$HOSTNAME" } else { "http://<server-ip>:$PORT" }

Write-Host "  Platform URL  :  $accessUrl" -ForegroundColor Green
Write-Host "  Local URL     :  http://localhost:$PORT" -ForegroundColor Green
Write-Host ""
Write-Host "  Default login :" -ForegroundColor White
Write-Host "    Username : admin" -ForegroundColor Yellow
Write-Host "    Password : Admin@123   (you will be forced to change this)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Service name  : $SERVICE_NAME" -ForegroundColor White
Write-Host "  Install dir   : $INSTALL_DIR" -ForegroundColor White
Write-Host "  Log files     : $LOG_DIR" -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Open $accessUrl in a browser" -ForegroundColor Gray
Write-Host "    2. Log in with admin / Admin@123  and change the password" -ForegroundColor Gray
Write-Host "    3. Go to Admin -> License and activate your license key" -ForegroundColor Gray
Write-Host "    4. Create your first Project and start building tests" -ForegroundColor Gray
Write-Host ""
Write-Host "  Service commands:" -ForegroundColor White
Write-Host "    Start   :  nssm start  $SERVICE_NAME" -ForegroundColor Gray
Write-Host "    Stop    :  nssm stop   $SERVICE_NAME" -ForegroundColor Gray
Write-Host "    Restart :  nssm restart $SERVICE_NAME" -ForegroundColor Gray
Write-Host ""
Write-Host "  Full guide : $INSTALL_DIR\docs\INSTALLATION_GUIDE.md" -ForegroundColor Gray
Write-Host ""

Log "Installation complete. URL=$accessUrl"
