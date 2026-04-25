##############################################################################
#  start-qa-platform.ps1
#  Startup script for QA Agent Platform (Windows)
#
#  Usage:
#    Run manually:    powershell -ExecutionPolicy Bypass -File "C:\qa-agent-platform\scripts\start-qa-platform.ps1"
#    As a service:    Installed via NSSM — see docs\INSTALLATION_GUIDE.md Section 8
#
#  What this script does:
#    1. Verifies Node.js is installed
#    2. Verifies node_modules exist (reminds to run npm install if not)
#    3. Verifies the TypeScript build exists (rebuilds if needed)
#    4. Loads environment from .env in the install directory
#    5. Starts the QA Agent Platform server
#    6. Restarts automatically if the server crashes (up to 5 times)
##############################################################################

$ErrorActionPreference = "Stop"

# ── Configuration ─────────────────────────────────────────────────────────────

# Set this to the folder where qa-agent-platform is installed
$INSTALL_DIR = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$LOG_DIR      = Join-Path $INSTALL_DIR "logs"
$LOG_FILE     = Join-Path $LOG_DIR "server.log"
$MAX_RESTARTS = 5
$RESTART_WAIT = 5   # seconds between restart attempts

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line      = "[$timestamp] [$Level] $Message"
    Write-Host $line
    if (!(Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null }
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
}

function Exit-WithError {
    param([string]$Message)
    Write-Log $Message "ERROR"
    exit 1
}

# ── Banner ────────────────────────────────────────────────────────────────────

Write-Log "============================================================"
Write-Log " QA Agent Platform - Startup Script"
Write-Log " Install directory : $INSTALL_DIR"
Write-Log "============================================================"

# ── Step 1: Verify Node.js ────────────────────────────────────────────────────

Write-Log "Checking Node.js..."
try {
    $nodeVersion = node --version 2>&1
    Write-Log "Node.js found: $nodeVersion"
} catch {
    Exit-WithError "Node.js is not installed or not in PATH. Install from https://nodejs.org LTS version."
}

# ── Step 2: Verify install directory ─────────────────────────────────────────

if (!(Test-Path $INSTALL_DIR)) {
    Exit-WithError "Install directory not found: $INSTALL_DIR"
}

Set-Location $INSTALL_DIR
Write-Log "Working directory: $INSTALL_DIR"

# -- Step 3: Verify node_modules -----------------------------------------------

$nodeModules = Join-Path $INSTALL_DIR "node_modules"
if (!(Test-Path $nodeModules)) {
    Write-Log "node_modules not found - running npm install..." "WARN"
    try {
        npm install 2>&1 | Tee-Object -FilePath $LOG_FILE -Append
        Write-Log "npm install completed."
    } catch {
        Exit-WithError "npm install failed. Check your internet connection and try again."
    }
}

# -- Step 4: Verify TypeScript build ------------------------------------------

$distServer = Join-Path $INSTALL_DIR "dist\ui\server.js"
if (!(Test-Path $distServer)) {
    Write-Log "Build output not found - running npm run build..." "WARN"
    try {
        npm run build 2>&1 | Tee-Object -FilePath $LOG_FILE -Append
        Write-Log "Build completed."
    } catch {
        Exit-WithError "Build failed. Contact the vendor with the error above."
    }
}

# -- Step 5: Verify .env -------------------------------------------------------

$envFile = Join-Path $INSTALL_DIR ".env"
if (!(Test-Path $envFile)) {
    Write-Log ".env file not found - server will use built-in defaults." "WARN"
} else {
    Write-Log ".env found."
}

# -- Step 6: Verify Playwright browsers ---------------------------------------

Write-Log "Checking Playwright browser..."
$pwChromePath = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (!(Test-Path $pwChromePath)) {
    Write-Log "Playwright browsers not installed - running install..." "WARN"
    try {
        npx playwright install chromium 2>&1 | Tee-Object -FilePath $LOG_FILE -Append
        Write-Log "Playwright chromium installed."
    } catch {
        Write-Log "Playwright browser install failed. Suite runs may fail." "WARN"
    }
} else {
    Write-Log "Playwright browsers found."
}

# -- Step 7: Start server with auto-restart ------------------------------------

$restartCount = 0

while ($restartCount -le $MAX_RESTARTS) {

    if ($restartCount -gt 0) {
        Write-Log "Restart attempt $restartCount of $MAX_RESTARTS in $RESTART_WAIT seconds..." "WARN"
        Start-Sleep -Seconds $RESTART_WAIT
    }

    Write-Log "Starting QA Agent Platform server..."
    Write-Log "Access at: http://localhost:$( if ($env:UI_PORT) { $env:UI_PORT } else { '3000' } )"
    Write-Log "------------------------------------------------------------"

    try {
        # Use tsx to run TypeScript directly (no separate build step needed at runtime)
        $process = Start-Process -FilePath "node" `
            -ArgumentList "node_modules\tsx\dist\cli.mjs", "src\ui\server.ts" `
            -WorkingDirectory $INSTALL_DIR `
            -NoNewWindow `
            -PassThru `
            -Wait

        $exitCode = $process.ExitCode
        Write-Log "Server exited with code: $exitCode" "WARN"

        # Exit code 0 = clean shutdown (e.g. NSSM stop command) — do not restart
        if ($exitCode -eq 0) {
            Write-Log "Clean shutdown detected. Not restarting."
            break
        }

    } catch {
        Write-Log "Server process error: $_" "ERROR"
    }

    $restartCount++

    if ($restartCount -gt $MAX_RESTARTS) {
        Exit-WithError "Server crashed $MAX_RESTARTS times. Manual intervention required. Check logs at: $LOG_FILE"
    }
}

Write-Log "QA Agent Platform stopped."
