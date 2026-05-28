##############################################################################
#  package-release.ps1  -  QA Agent Platform  -  Release Packager
#
#  Usage:
#    .\package-release.ps1                  # slim package (~3 MB, customer downloads browsers)
#    .\package-release.ps1 -BundleBrowsers  # fat package  (~300 MB, browsers pre-bundled)
#
#  Use -BundleBrowsers for customers with restricted internet / slow connections.
#  The installer detects pre-bundled browsers and skips all downloads automatically.
#
#  Output:
#    releases\qa-agent-platform-v<version>.zip          (slim)
#    releases\qa-agent-platform-v<version>-browsers.zip (fat)
##############################################################################

param(
    [switch]$BundleBrowsers
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

function Info  { param($m) Write-Host "  $m" -ForegroundColor Cyan }
function Ok    { param($m) Write-Host "  [OK]  $m" -ForegroundColor Green }
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

Banner "QA Agent Platform - Release Packager"

# ── Paths ─────────────────────────────────────────────────────────────────────
$SCRIPT_DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_DIR = Split-Path -Parent $SCRIPT_DIR
$RELEASES_DIR = Join-Path $PROJECT_DIR "releases"

# ── Read version from package.json ────────────────────────────────────────────
$pkgJson = Join-Path $PROJECT_DIR "package.json"
if (-not (Test-Path $pkgJson)) { Fail "package.json not found at $PROJECT_DIR" }
$version = (Get-Content $pkgJson -Raw | ConvertFrom-Json).version
if (-not $version) { Fail "Could not read version from package.json" }
Info "Version  : $version"

$ZIP_SUFFIX = if ($BundleBrowsers) { "-browsers" } else { "" }
$ZIP_NAME   = "qa-agent-platform-v$version$ZIP_SUFFIX.zip"
$ZIP_PATH   = Join-Path $RELEASES_DIR $ZIP_NAME
$STAGE_DIR  = Join-Path $env:TEMP "qa-platform-release-stage"

Info "Output   : $ZIP_PATH"
Info "Staging  : $STAGE_DIR"
if ($BundleBrowsers) { Info "Mode     : FAT package (browsers pre-bundled  - no internet needed on customer machine)" }
else                 { Info "Mode     : SLIM package (customer downloads browsers during install)" }
Write-Host ""

# ── Whitelist: only these top-level items go into the package ─────────────────
# Add items here as the product grows. This is intentional and explicit.
$INCLUDE_TOP = @(
    "src",
    "tools",
    "docs",
    "scripts",
    "tests",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "playwright.config.ts",
    "playwright.api-testing.config.ts",
    "vitest.config.ts",
    ".env.example",
    "iis-site",
    "setup-iis.ps1",
    "start-server.bat"
)

# Within the scripts/ folder, exclude dev-only scripts (keep only customer-facing ones)
$SCRIPTS_EXCLUDE = @(
    "concat-modules.js",
    "do-extract.js",
    "extract-routes.ts",
    "promote.js",
    "split-routes.js",
    "_merge-new-aliases.NOSCAN.js",
    "_seed-aliases.NOSCAN.js"
)

# Within tests/, only ship the empty folder skeleton - never ship generated specs
$TESTS_EXCLUDE_PATTERNS = @("*.spec.ts", "*.spec.js")

##############################################################################
# [1] Verify the build is current
##############################################################################
Step 1 "Verifying TypeScript build is up to date..."

$distServer = Join-Path $PROJECT_DIR "dist\ui\server.js"
if (-not (Test-Path $distServer)) {
    Warn "dist/ not found - running npm run build first..."
    Set-Location $PROJECT_DIR
    npm run build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Build failed. Fix build errors before packaging." }
    Ok "Build completed."
} else {
    Ok "dist/ exists - skipping rebuild. Run 'npm run build' manually if source changed."
}

##############################################################################
# [2] Clean staging directory
##############################################################################
Step 2 "Preparing clean staging directory..."

if (Test-Path $STAGE_DIR) {
    Remove-Item $STAGE_DIR -Recurse -Force
}
New-Item -ItemType Directory -Path $STAGE_DIR -Force | Out-Null
Ok "Staging directory ready: $STAGE_DIR"

##############################################################################
# [3] Copy whitelisted items into staging
##############################################################################
Step 3 "Copying release files..."

foreach ($item in $INCLUDE_TOP) {
    $src  = Join-Path $PROJECT_DIR $item
    $dest = Join-Path $STAGE_DIR   $item

    if (-not (Test-Path $src)) {
        Warn "Skipping '$item' - not found in project root."
        continue
    }

    $entry = Get-Item $src -Force

    if ($entry.PSIsContainer) {
        # ── Special handling for scripts/ ─────────────────────────────────
        if ($item -eq "scripts") {
            New-Item -ItemType Directory -Path $dest -Force | Out-Null
            Get-ChildItem $src | Where-Object { $SCRIPTS_EXCLUDE -notcontains $_.Name } | ForEach-Object {
                Copy-Item $_.FullName (Join-Path $dest $_.Name) -Force
            }
            Info "Copied scripts/ (dev-only scripts excluded)"
            continue
        }

        # ── Special handling for tests/ ───────────────────────────────────
        if ($item -eq "tests") {
            # Create empty skeleton: tests/codegen/ (installer creates it anyway,
            # but keeping the folder signals the expected structure)
            New-Item -ItemType Directory -Path (Join-Path $dest "codegen") -Force | Out-Null
            # Add a .gitkeep so the folder survives zip/unzip
            "" | Out-File -FilePath (Join-Path $dest "codegen\.gitkeep") -Encoding ASCII
            Info "Copied tests/ (empty codegen folder only - no generated specs)"
            continue
        }

        # ── Default: full recursive copy ──────────────────────────────────
        Copy-Item $src $dest -Recurse -Force
        Info "Copied $item/"

    } else {
        Copy-Item $src $dest -Force
        Info "Copied $item"
    }
}

##############################################################################
# [4] Safety check - make sure no sensitive dev files leaked in
##############################################################################
Step 4 "Running safety checks on staged files..."

$BLOCKED = @(".env", "data", "results", "logs", "node_modules", "dist",
             ".git", ".claude", ".gemini", ".kiro", "debug-runs", "screenshots",
             "CLAUDE.md", "AGENTS.md", "GEMINI.md")

$leaks = @()
foreach ($b in $BLOCKED) {
    if (Test-Path (Join-Path $STAGE_DIR $b)) { $leaks += $b }
}

if ($leaks.Count -gt 0) {
    Fail "SAFETY CHECK FAILED - these dev files leaked into the package: $($leaks -join ', '). Aborting."
}

# Make sure there is no data/license.json in the package (would carry dev license)
$licFile = Join-Path $STAGE_DIR "data\license.json"
if (Test-Path $licFile) { Fail "SAFETY CHECK FAILED - dev license file found in package. Aborting." }

Ok "Safety checks passed - no dev artifacts in package."

##############################################################################
# [5] Bundle browsers (only when -BundleBrowsers flag is set)
##############################################################################
Step 5 "Browser bundling..."

if ($BundleBrowsers) {
    $devBrowsersPath = Join-Path $PROJECT_DIR ".playwright-browsers"
    if (-not (Test-Path $devBrowsersPath)) {
        Fail "No .playwright-browsers folder found at $devBrowsersPath`nRun: npx playwright install chromium firefox webkit"
    }
    $browserItems = Get-ChildItem $devBrowsersPath
    if ($browserItems.Count -eq 0) {
        Fail ".playwright-browsers folder is empty. Run: npx playwright install chromium firefox webkit"
    }
    $destBrowsers = Join-Path $STAGE_DIR ".playwright-browsers"
    Info "Copying browsers from dev machine (this may take a moment)..."
    Copy-Item $devBrowsersPath $destBrowsers -Recurse -Force
    $browserSizeMB = [math]::Round((Get-ChildItem $destBrowsers -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB, 0)
    Ok "Browsers bundled ($browserSizeMB MB)  - installer will skip all downloads on customer machine."
} else {
    Ok "Skipped  - slim package. Customer machine will download browsers during install."
}

##############################################################################
# [6] Write a VERSION file into the package root
##############################################################################
Step 6 "Writing VERSION file..."
"$version" | Out-File -FilePath (Join-Path $STAGE_DIR "VERSION") -Encoding ASCII
Ok "VERSION = $version"

##############################################################################
# [7] Create the ZIP
##############################################################################
Step 7 "Creating ZIP archive..."

New-Item -ItemType Directory -Path $RELEASES_DIR -Force | Out-Null

if (Test-Path $ZIP_PATH) {
    Warn "Overwriting existing $ZIP_NAME"
    Remove-Item $ZIP_PATH -Force
}

Compress-Archive -Path "$STAGE_DIR\*" -DestinationPath $ZIP_PATH -CompressionLevel Optimal
$sizeMB = [math]::Round((Get-Item $ZIP_PATH).Length / 1MB, 1)
Ok "ZIP created: $ZIP_NAME  ($sizeMB MB)"

##############################################################################
# [8] Clean up staging
##############################################################################
Remove-Item $STAGE_DIR -Recurse -Force

##############################################################################
# Summary
##############################################################################
Banner "Package Ready!"
Write-Host "  File    : $ZIP_PATH" -ForegroundColor Green
Write-Host "  Size    : $sizeMB MB" -ForegroundColor Green
if ($BundleBrowsers) {
    Write-Host "  Mode    : FAT  - browsers pre-bundled, zero downloads on customer machine" -ForegroundColor Green
} else {
    Write-Host "  Mode    : SLIM - customer machine downloads browsers (~300 MB) during install" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Delivery steps:" -ForegroundColor White
Write-Host "    1. Send  $ZIP_NAME  to the customer" -ForegroundColor Gray
Write-Host "    2. Customer extracts to C:\ (creates C:\qa-agent-platform\)" -ForegroundColor Gray
Write-Host "    3. Customer runs (as Administrator):" -ForegroundColor Gray
Write-Host "         powershell -ExecutionPolicy Bypass -File C:\qa-agent-platform\scripts\install.ps1" -ForegroundColor Yellow
Write-Host ""
Write-Host "  First boot guarantees:" -ForegroundColor White
Write-Host "    - Fresh .env with unique secrets (generated by installer)" -ForegroundColor Gray
Write-Host "    - Auto-trial license (14 days, no key needed)" -ForegroundColor Gray
Write-Host "    - One admin user: admin / Admin@123 (forced password change on first login)" -ForegroundColor Gray
Write-Host "    - Demo project seeded (can be deleted from UI)" -ForegroundColor Gray
Write-Host "    - No dev data, no dev license, no dev users" -ForegroundColor Gray
Write-Host ""
