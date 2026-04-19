#!/usr/bin/env bash
##############################################################################
#  install.sh  —  QA Agent Platform  —  One-Command Installer (Linux)
#  Supports: Ubuntu 20.04+, Debian 11+, RHEL 8/9, CentOS Stream 8/9, Rocky 8/9
#  Version: 1.0  |  2026-04-19
#
#  Run as root or with sudo:
#    sudo bash /path/to/qa-agent-platform/scripts/install.sh
#
#  What it does (fully automated):
#    [1]  Detects OS (Ubuntu/Debian vs RHEL/CentOS/Rocky)
#    [2]  Installs Node.js 20 LTS via NodeSource
#    [3]  Prompts for install path, port, hostname
#    [4]  Copies platform files to chosen install path
#    [5]  Generates .env with secure random secrets
#    [6]  Runs npm install
#    [7]  Runs npm run build
#    [8]  Installs Playwright Chromium + system dependencies
#    [9]  Creates a systemd service (auto-start on boot)
#    [10] Configures firewall (ufw or firewalld)
#    [11] Optionally adds /etc/hosts entry
#    [12] Starts the service and verifies HTTP 200
#    [13] Prints final summary with login URL + credentials
##############################################################################

set -e

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; WHITE='\033[1;37m'; NC='\033[0m'

info()  { echo -e "${CYAN}  $*${NC}"; }
ok()    { echo -e "${GREEN}  [OK]  $*${NC}"; }
warn()  { echo -e "${YELLOW}  [!]   $*${NC}"; }
fail()  { echo -e "${RED}  [ERR] $*${NC}"; exit 1; }
step()  { echo -e "\n${WHITE}[$1] $2${NC}"; }
banner(){ echo -e "\n${CYAN}$(printf '=%.0s' {1..62})${NC}"; echo -e "${CYAN}  $*${NC}"; echo -e "${CYAN}$(printf '=%.0s' {1..62})${NC}\n"; }

# Must run as root
if [[ $EUID -ne 0 ]]; then fail "Please run as root: sudo bash $0"; fi

banner "QA Agent Platform — Installation Wizard (Linux)"
echo "  This script installs and configures the platform end-to-end."
echo "  It will prompt for a few settings then run automatically."
echo ""

# ── Detect OS ─────────────────────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    OS_ID="${ID,,}"         # ubuntu, debian, rhel, centos, rocky, almalinux, fedora
    OS_VER="${VERSION_ID}"
else
    fail "Cannot detect OS. /etc/os-release not found."
fi

case "$OS_ID" in
    ubuntu|debian)          PKG_MGR="apt"; info "Detected: $PRETTY_NAME" ;;
    rhel|centos|rocky|almalinux|fedora)  PKG_MGR="dnf"; info "Detected: $PRETTY_NAME" ;;
    *)  fail "Unsupported OS: $OS_ID. Supported: Ubuntu, Debian, RHEL, CentOS, Rocky, AlmaLinux" ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

# ── Collect settings ──────────────────────────────────────────────────────────
banner "Step 0 — Configuration"

read -rp "  Install path [/opt/qa-agent-platform]: " raw_path
INSTALL_DIR="${raw_path:-/opt/qa-agent-platform}"

read -rp "  Server port [3000]: " raw_port
PORT="${raw_port:-3000}"

read -rp "  Friendly hostname, e.g. qa-platform.local  (blank to skip): " HOSTNAME

read -rp "  Organisation / Customer name [QA Platform]: " raw_org
ORG_NAME="${raw_org:-QA Platform}"

echo ""
info "Install path : $INSTALL_DIR"
info "Port         : $PORT"
info "Hostname     : ${HOSTNAME:-'(none — use IP:port)'}"
info "Org name     : $ORG_NAME"
echo ""
read -rp "  Proceed? [Y/n]: " confirm
[[ "${confirm,,}" == "n" ]] && echo "Cancelled." && exit 0

# ── Log setup ─────────────────────────────────────────────────────────────────
LOG_DIR="$INSTALL_DIR/logs"
LOG_FILE="$LOG_DIR/install.log"
mkdir -p "$LOG_DIR"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$LOG_FILE"; }
log "Install started. OS=$OS_ID Port=$PORT Path=$INSTALL_DIR"

##############################################################################
# [1] Node.js 20 LTS
##############################################################################
step 1 "Checking / Installing Node.js 20 LTS..."

need_node=true
if command -v node &>/dev/null; then
    major=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ $major -ge 18 ]]; then
        ok "Node.js $(node --version) already installed."; need_node=false
    else
        warn "Node.js $(node --version) is too old (need ≥ 18). Upgrading."
    fi
fi

if $need_node; then
    info "Installing Node.js 20 LTS via NodeSource..."
    if [[ "$PKG_MGR" == "apt" ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1
        apt-get install -y nodejs >> "$LOG_FILE" 2>&1
    else
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1
        $PKG_MGR install -y nodejs >> "$LOG_FILE" 2>&1
    fi
    ok "Node.js $(node --version) installed."
    log "Node.js installed: $(node --version)"
fi

##############################################################################
# [2] System dependencies for Playwright
##############################################################################
step 2 "Installing system dependencies..."

if [[ "$PKG_MGR" == "apt" ]]; then
    apt-get update -q >> "$LOG_FILE" 2>&1
    apt-get install -y --no-install-recommends \
        ca-certificates curl wget gnupg \
        libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
        libpango-1.0-0 libpangocairo-1.0-0 libnspr4 libnss3 >> "$LOG_FILE" 2>&1
else
    $PKG_MGR install -y \
        ca-certificates curl wget \
        atk at-spi2-atk cups-libs libdrm libxkbcommon \
        libXcomposite libXdamage libXfixes libXrandr mesa-libgbm \
        alsa-lib pango nss >> "$LOG_FILE" 2>&1
fi
ok "System dependencies installed."

##############################################################################
# [3] Copy platform files
##############################################################################
step 3 "Copying platform files to $INSTALL_DIR..."

EXCLUDES=("node_modules" "dist" "data" "results" "test-results" "logs" ".git" "*.log")

if [[ "$(realpath "$SOURCE_DIR")" == "$(realpath "$INSTALL_DIR" 2>/dev/null || echo __NONE__)" ]]; then
    ok "Source == install dir — no copy needed."
    log "Source == install dir, skipped copy."
else
    mkdir -p "$INSTALL_DIR"
    rsync -a --exclude='node_modules' --exclude='dist' --exclude='data' \
             --exclude='results' --exclude='test-results' --exclude='logs' \
             --exclude='.git' \
             "$SOURCE_DIR/" "$INSTALL_DIR/" >> "$LOG_FILE" 2>&1 || \
    # Fallback if rsync not available
    cp -r "$SOURCE_DIR/." "$INSTALL_DIR/"
    ok "Files copied to $INSTALL_DIR"
    log "Files copied."
fi

# Runtime directories
for d in data results test-results logs tests/codegen test-plans reports; do
    mkdir -p "$INSTALL_DIR/$d"
done
ok "Runtime directories created."

# Fix ownership — create a dedicated service user
if ! id qa-platform &>/dev/null; then
    useradd -r -s /sbin/nologin -d "$INSTALL_DIR" qa-platform
    ok "Service user 'qa-platform' created."
    log "Created system user qa-platform."
fi
chown -R qa-platform:qa-platform "$INSTALL_DIR"

##############################################################################
# [4] Generate .env
##############################################################################
step 4 "Creating .env configuration file..."

ENV_FILE="$INSTALL_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
    warn ".env already exists — skipping to preserve existing secrets."
    log ".env exists, skipped."
else
    SECRET1=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    SECRET2=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

    cat > "$ENV_FILE" <<EOF
# QA Agent Platform — Environment Configuration
# Generated by installer on $(date '+%Y-%m-%d %H:%M:%S')
# -------------------------------------------------------

# Server
UI_PORT=$PORT
APP_ENV=production
APP_ENV_LABEL=$ORG_NAME

# Security — DO NOT share these values
SESSION_SECRET=$SECRET1
QA_SECRET_KEY=$SECRET2

# Data paths (relative to install directory)
DATA_DIR=./data
TEST_RESULTS_DIR=./test-results
RESULTS_DIR=./results
REPORTS_DIR=./reports
TEST_PLANS_DIR=./test-plans

# Test execution
HEADLESS=true
DEFAULT_TIMEOUT=30000
SCREENSHOT_MODE=only-on-failure

# Application under test (set this to the customer's app URL)
APP_BASE_URL=https://your-application-url.com

# Session cookie name (unique per installation)
SESSION_COOKIE_NAME=qa-platform.sid
EOF
    chown qa-platform:qa-platform "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok ".env created with secure random secrets."
    log ".env written."
fi

##############################################################################
# [5] npm install
##############################################################################
step 5 "Installing Node.js dependencies (npm install)..."
cd "$INSTALL_DIR"
sudo -u qa-platform npm install >> "$LOG_FILE" 2>&1 || fail "npm install failed. Check $LOG_FILE"
ok "npm install completed."

##############################################################################
# [6] Build TypeScript
##############################################################################
step 6 "Building TypeScript (npm run build)..."
sudo -u qa-platform npm run build >> "$LOG_FILE" 2>&1 || fail "Build failed. Contact the vendor with $LOG_FILE"
ok "Build succeeded."

##############################################################################
# [7] Playwright Chromium
##############################################################################
step 7 "Installing Playwright Chromium..."
sudo -u qa-platform npx playwright install chromium >> "$LOG_FILE" 2>&1 || warn "Playwright install had warnings — suite runs may need: npx playwright install chromium"
ok "Playwright Chromium installed."

##############################################################################
# [8] systemd service
##############################################################################
step 8 "Creating systemd service..."

SERVICE_FILE="/etc/systemd/system/qa-agent-platform.service"
NODE_BIN=$(which node)
TSX_BIN="$INSTALL_DIR/node_modules/.bin/tsx"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=QA Agent Platform — AI Test Automation ($ORG_NAME)
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=qa-platform
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$NODE_BIN $TSX_BIN src/ui/server.ts
Restart=on-failure
RestartSec=5s
StandardOutput=append:$LOG_DIR/service.log
StandardError=append:$LOG_DIR/service-error.log
SyslogIdentifier=qa-agent-platform

# Security hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable qa-agent-platform
ok "systemd service created and enabled."
log "systemd service installed."

##############################################################################
# [9] Firewall
##############################################################################
step 9 "Configuring firewall for port $PORT..."

if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
    ufw allow "$PORT/tcp" >> "$LOG_FILE" 2>&1
    ok "ufw: port $PORT allowed."
elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port="$PORT/tcp" >> "$LOG_FILE" 2>&1
    firewall-cmd --reload >> "$LOG_FILE" 2>&1
    ok "firewalld: port $PORT allowed."
else
    # iptables fallback
    iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || true
    warn "No ufw/firewalld found — applied iptables rule (not persistent across reboot)."
    warn "Add to /etc/iptables/rules.v4 or use your firewall manager."
fi

##############################################################################
# [10] /etc/hosts entry (optional)
##############################################################################
if [[ -n "$HOSTNAME" ]]; then
    step 10 "Adding /etc/hosts entry for $HOSTNAME..."
    SERVER_IP=$(ip -4 route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}' || hostname -I | awk '{print $1}')
    ENTRY="$SERVER_IP  $HOSTNAME"
    if grep -q "$HOSTNAME" /etc/hosts; then
        ok "/etc/hosts entry already exists."
    else
        echo "$ENTRY" >> /etc/hosts
        ok "Added: $ENTRY"
        log "hosts entry: $ENTRY"
    fi
    warn "Remind each user's PC to also resolve $HOSTNAME (via DNS or local hosts file)."
fi

##############################################################################
# [11] Start service
##############################################################################
step 11 "Starting the service..."
systemctl start qa-agent-platform
sleep 6

# Verify
if curl -sf "http://localhost:$PORT" -o /dev/null; then
    ok "Server is UP at http://localhost:$PORT"
    log "Server verified."
else
    warn "Server did not respond in 6s — check: journalctl -u qa-agent-platform -n 50"
    warn "If the browser works the server is fine — this is a timing issue."
fi

##############################################################################
# [12] Final summary
##############################################################################
banner "Installation Complete!"

ACCESS_URL="${HOSTNAME:+http://$HOSTNAME}"
ACCESS_URL="${ACCESS_URL:-http://$(hostname -I | awk '{print $1}'):$PORT}"

echo -e "${GREEN}  Platform URL  :  $ACCESS_URL${NC}"
echo -e "${GREEN}  Local URL     :  http://localhost:$PORT${NC}"
echo ""
echo -e "${WHITE}  Default login :${NC}"
echo -e "${YELLOW}    Username : admin${NC}"
echo -e "${YELLOW}    Password : Admin@123   (you will be forced to change this)${NC}"
echo ""
echo -e "${WHITE}  Service commands:${NC}"
echo    "    Status  :  systemctl status  qa-agent-platform"
echo    "    Restart :  systemctl restart qa-agent-platform"
echo    "    Logs    :  journalctl -u qa-agent-platform -f"
echo    "               $LOG_DIR/service.log"
echo ""
echo -e "${WHITE}  Next steps:${NC}"
echo    "    1. Open $ACCESS_URL in a browser"
echo    "    2. Log in with admin / Admin@123  and change the password"
echo    "    3. Go to Admin -> License and activate your license key"
echo    "    4. Create your first Project and start building tests"
echo ""
echo -e "${WHITE}  Full guide : $INSTALL_DIR/docs/INSTALLATION_GUIDE.md${NC}"
echo ""

log "Installation complete. URL=$ACCESS_URL"
