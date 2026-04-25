# QA Agent Platform — Implementation & Installation Guide
> **Audience:** Implementation Engineers / Support Engineers  
> **Version:** 2.0 — 2026-04-19  
> **Time to complete (automated):** 10–20 minutes on a clean server

---

## Quick Start — One Command Install

### Windows (run as Administrator)
```powershell
powershell -ExecutionPolicy Bypass -File "C:\qa-agent-platform\scripts\install.ps1"
```

### Linux (Ubuntu / Debian / RHEL / CentOS / Rocky — run as root)
```bash
sudo bash /opt/qa-agent-platform/scripts/install.sh
```

The installer handles everything:  Node.js, dependencies, build, Windows Service / systemd, firewall, .env secrets, and first-start verification.

**Skip to [Section 6 — Activate the License](#6-activate-the-license) when the installer finishes.**

---

## Table of Contents

1. [What the Installer Does](#1-what-the-installer-does)
2. [Prerequisites](#2-prerequisites)
3. [Server Sizing](#3-server-sizing)
4. [Download & Place the Software](#4-download--place-the-software)
5. [Run the Installer](#5-run-the-installer)
6. [Activate the License](#6-activate-the-license)
7. [Verify the Installation](#7-verify-the-installation)
8. [Create the First Real Admin Account](#8-create-the-first-real-admin-account)
9. [Hand Off to the Customer](#9-hand-off-to-the-customer)
10. [Manual Installation (if installer fails)](#10-manual-installation-if-installer-fails)
11. [Service Management](#11-service-management)
12. [Troubleshooting Quick Reference](#12-troubleshooting-quick-reference)
13. [Licensing — Deep Dive](#13-licensing--deep-dive)
14. [Uninstall / Re-install](#14-uninstall--re-install)

---

## 1. What the Installer Does

Both `install.ps1` (Windows) and `install.sh` (Linux) perform these steps automatically:

| Step | Action |
|------|--------|
| 1 | Detect / install **Node.js 20 LTS** |
| 2 | Install system dependencies (NSSM on Windows; Playwright libs on Linux) |
| 3 | Copy platform files to the chosen install directory |
| 4 | Create **runtime directories** (data/, results/, logs/, etc.) |
| 5 | Generate `.env` with **cryptographically secure random secrets** |
| 6 | Run `npm install` |
| 7 | Run `npm run build` (TypeScript → JavaScript) |
| 8 | Install **Playwright Chromium** browser |
| 9 | Register as a **Windows Service** (NSSM) or **systemd service** (Linux) |
| 10 | Add **firewall rule** for the chosen port |
| 11 | Optionally add a **/etc/hosts** or **hosts file** entry for a friendly URL |
| 12 | **Start the service** and verify HTTP 200 |
| 13 | Print a **final summary** with URL and default credentials |
| 14 | On first boot: seed **default admin user** + **demo project** (1 script, 1 locator) |

---

## 2. Prerequisites

### Both Platforms
- The installer downloads Node.js automatically if missing. No pre-install needed.
- An internet connection is required **only during installation** (to download Node.js and npm packages).
- After installation, the platform runs fully **on-premises** with no internet dependency.

### Windows Only
- **Run PowerShell as Administrator** (right-click → Run as Administrator)
- Windows Server 2019 or later (Windows 10/11 also works)
- `winget` available (pre-installed on Windows Server 2022 and Windows 10 1709+)

### Linux Only
- **Run as root** (`sudo bash install.sh`)
- Ubuntu 20.04+, Debian 11+, RHEL 8/9, CentOS Stream 8/9, Rocky 8/9, AlmaLinux 8/9
- `curl` installed (usually pre-installed; install with `sudo apt install curl` or `sudo dnf install curl`)

---

## 3. Server Sizing

| Attribute | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Windows Server 2019 / Ubuntu 20.04 | Windows Server 2022 / Ubuntu 22.04 / RHEL 9 |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 50 GB |
| Port | 3000 (configurable) | 3000 |
| Internet | Required during install only | — |

---

## 4. Download & Place the Software

### Option A — From ZIP (most common for on-prem)

1. Receive the `qa-agent-platform-vX.X.zip` file from the vendor.
2. Extract it:
   - **Windows:** Right-click → Extract All → `C:\` → creates `C:\qa-agent-platform\`
   - **Linux:** `sudo unzip qa-agent-platform-vX.X.zip -d /opt/`

3. Verify the folder contains:
   ```
   qa-agent-platform/
   ├── scripts/
   │   ├── install.ps1      ← Windows installer
   │   ├── install.sh       ← Linux installer
   │   └── ...
   ├── src/
   ├── docs/
   ├── package.json
   └── ...
   ```

### Option B — From GitHub

```bash
# Windows PowerShell
git clone https://github.com/HarmeetSaini87/QA-Agent-Platform.git C:\qa-agent-platform

# Linux
sudo git clone https://github.com/HarmeetSaini87/QA-Agent-Platform.git /opt/qa-agent-platform
```

---

## 5. Run the Installer

### Windows

1. Open **PowerShell as Administrator**
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "C:\qa-agent-platform\scripts\install.ps1"
   ```
3. Answer the 4 prompts (press Enter to accept defaults):
   ```
   Install path  [C:\qa-agent-platform]   ← press Enter
   Server port   [3000]                   ← press Enter
   Friendly hostname                      ← e.g. qa-platform.local  or blank
   Organisation name [QA Platform]        ← e.g. Acme Corp
   ```
4. Type `Y` to confirm and wait (~10 minutes).

### Linux

1. Open a terminal on the server
2. Run:
   ```bash
   sudo bash /opt/qa-agent-platform/scripts/install.sh
   ```
3. Answer the 4 prompts (press Enter to accept defaults):
   ```
   Install path  [/opt/qa-agent-platform]  ← press Enter
   Server port   [3000]                    ← press Enter
   Friendly hostname                       ← e.g. qa-platform.local  or blank
   Organisation name [QA Platform]         ← e.g. Acme Corp
   ```
4. Type `Y` to confirm and wait (~10 minutes).

### What Success Looks Like

```
==============================================================
  Installation Complete!
==============================================================

  Platform URL  :  http://qa-platform.local
  Local URL     :  http://localhost:3000

  Default login :
    Username : admin
    Password : Admin@123   (you will be forced to change this)

  Service name  : QAAgentPlatform
  Install dir   : C:\qa-agent-platform
```

---

## 6. Activate the License

> The customer NEVER needs to touch any file or folder. License activation is done entirely through the browser.

### 6.1 How Licensing Works on First Start

```
Fresh install
    │
    ▼
Server starts → looks for data/license.json
    │
    ├─ NOT FOUND → Auto-Trial activates (14 days, 3 seats, 3 projects)
    │              Admin can log in and activate a key immediately
    │
    └─ FOUND     → Licensed mode (tier / seats / expiry as per key)
```

- `data/license.json` is **AES-256-GCM encrypted** — cannot be tampered with or copied to another server.
- The encryption key is derived from `QA_SECRET_KEY` in `.env`. If `.env` is lost, the license must be re-activated.
- **Machine binding:** enterprise/team licenses are fingerprinted to the server hardware (MAC + hostname + CPU). If the server changes, use Transfer in Admin → License.

### 6.2 What the Vendor Sends

| License Type | Format | Example |
|---|---|---|
| Starter / Team / Enterprise (HMAC) | Text string | `QAP-ENT-ACME001-202612-010-001-A3F7` |
| Enterprise (RSA-signed file) | `.lic` file | `acme-corp.lic` |

### 6.3 Activation Steps (Browser)

1. Open browser → `http://<server-ip>:3000` (or the hostname you configured)
2. Log in as `admin` / `Admin@123`
3. Click **Admin** in the top navigation
4. Click **License** sub-tab
5. **If you have a key string:** paste it in the License Key box → click **Activate**  
   **If you have a `.lic` file:** click Upload .lic File → select the file → click **Activate**
6. Green confirmation appears: *"License activated successfully"*
7. Restart the service:
   - **Windows:** `nssm restart QAAgentPlatform`
   - **Linux:** `sudo systemctl restart qa-agent-platform`

### 6.4 Protecting Vendor's Own Servers (Internal Use)

Seed a perpetual enterprise license so the auto-trial never activates:

```powershell
# Windows
cd C:\qa-agent-platform
npx tsx scripts\seed-internal-license.ts
```
```bash
# Linux
cd /opt/qa-agent-platform
sudo -u qa-platform npx tsx scripts/seed-internal-license.ts
```

---

## 7. Verify the Installation

Run through this checklist before handing off:

```
[ ] Installer completed without errors
[ ] Service is running (nssm status / systemctl status)
[ ] Login page loads at http://<ip>:3000
[ ] Default admin login works (Admin@123)
[ ] Password change forced on first login — change it
[ ] Admin → License shows correct tier and expiry
[ ] Demo Project visible in project selector (see Section 7.1)
[ ] Create a test Suite — add the demo script
[ ] Execution History shows the run
[ ] Service auto-starts after reboot
```

### 7.1 Demo Data — What Gets Created on First Start

On the very first server start, the platform automatically creates demo data so the UI is not blank:

| Item | Details |
|---|---|
| **Project** | "Demo Project" — with DEV and QA environments |
| **Test Script** | `DEMO-01` — "Login — Happy Path" — 5 steps (Navigate, Fill username, Fill password, Click Login, Assert URL) |
| **Locator** | "Login Button" — selector `#login-btn` — page module "Login Page" |

> **These are placeholders.** Update the selectors and URLs to match the customer's application, or delete them and create your own. Demo data is only created once — it will not be recreated if deleted.

To delete demo data: go to the project selector → open Demo Project → delete the script, locator, then the project itself via Admin → Projects.

---

## 7.2 Email / SMTP Notifications (Optional)

Notifications are **off by default**. To enable email alerts for failed runs or healing events:

1. Open the `.env` file on the server:
   - **Windows:** `C:\qa-agent-platform\.env`
   - **Linux:** `/opt/qa-agent-platform/.env`

2. Uncomment and fill in the SMTP section:
   ```env
   SMTP_HOST=smtp.yourcompany.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=qa-platform@yourcompany.com
   SMTP_PASS=your-smtp-password
   SMTP_FROM=QA Platform <qa-platform@yourcompany.com>
   NOTIFY_ON_FAIL=true
   NOTIFY_ON_HEAL=false
   ```

3. Restart the service:
   - **Windows:** `nssm restart QAAgentPlatform`
   - **Linux:** `sudo systemctl restart qa-agent-platform`

4. Test via **Admin → Settings → Test Notification** in the browser.

> SMTP is entirely optional. The platform runs fully without it.

---

## 7.3 HTTPS / TLS Setup (Optional)

The platform runs on **HTTP by default**. This is sufficient for internal/on-premise networks where the server is behind a corporate firewall.

If the customer requires HTTPS (public-facing deployment, compliance requirement, or browser security warnings are not acceptable), follow the separate guide:

**📋 [docs/HTTPS_SETUP.md](HTTPS_SETUP.md)** — covers:
- nginx reverse proxy (Linux, recommended)
- IIS reverse proxy (Windows)
- Self-signed certificate (internal/dev)
- Certbot / Let's Encrypt (public domain, free cert)

> **Do not force HTTPS** on customers who do not need it. HTTP is perfectly valid for closed on-premise networks.

---

## 8. Create the First Real Admin Account

The seed `admin / Admin@123` account must not be left as the customer's permanent account.

1. Log in as `admin`
2. Go to **Admin → Users → Add User**
3. Set Role: **Admin**, create a strong temporary password
4. Give credentials to the customer's IT admin
5. Ask them to log in and change the password immediately

Optionally deactivate the seed `admin` account after the real admin logs in.

---

## 9. Hand Off to the Customer

Give the customer:

1. **URL:** `http://<server-ip-or-hostname>:3000`
2. **Admin credentials** (the account you created in step 8)
3. **Customer License Guide** — [docs/CUSTOMER_LICENSE_GUIDE.md](CUSTOMER_LICENSE_GUIDE.md)
4. **Support contact** for license renewals

Brief the customer admin:
- How to create users (Admin → Users)
- How to create a project (Projects tab)
- Where to see license status (Admin → License)
- What happens when trial/license expires (read-only mode — data always safe)

---

## 10. Manual Installation (if installer fails)

Only follow this if the automated installer fails.

### Step 10.1 — Install Node.js manually

**Windows:** Download from https://nodejs.org (LTS), install with defaults.  
**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```
**Linux (RHEL/Rocky):**
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
```

### Step 10.2 — Create .env

Copy this template and fill in your values:

```ini
UI_PORT=3000
APP_ENV=production
APP_ENV_LABEL=QA Platform
SESSION_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
QA_SECRET_KEY=<run the same command again>
DATA_DIR=./data
TEST_RESULTS_DIR=./test-results
RESULTS_DIR=./results
REPORTS_DIR=./reports
TEST_PLANS_DIR=./test-plans
HEADLESS=true
DEFAULT_TIMEOUT=30000
SCREENSHOT_MODE=only-on-failure
APP_BASE_URL=https://your-app-url.com
SESSION_COOKIE_NAME=qa-platform.sid
```

### Step 10.3 — Install, build, browser

```bash
npm install
npm run build
npx playwright install chromium
```

### Step 10.4 — Register Windows Service (NSSM)

```powershell
nssm install QAAgentPlatform powershell.exe -ExecutionPolicy Bypass -File "C:\qa-agent-platform\scripts\start-qa-platform.ps1"
nssm set QAAgentPlatform AppDirectory "C:\qa-agent-platform"
nssm set QAAgentPlatform Start SERVICE_AUTO_START
nssm start QAAgentPlatform
```

### Step 10.4 — Register Linux systemd Service

Create `/etc/systemd/system/qa-agent-platform.service`:

```ini
[Unit]
Description=QA Agent Platform
After=network.target

[Service]
Type=simple
User=qa-platform
WorkingDirectory=/opt/qa-agent-platform
EnvironmentFile=/opt/qa-agent-platform/.env
ExecStart=/usr/bin/node /opt/qa-agent-platform/node_modules/.bin/tsx src/ui/server.ts
Restart=on-failure
RestartSec=5s
StandardOutput=append:/opt/qa-agent-platform/logs/service.log
StandardError=append:/opt/qa-agent-platform/logs/service-error.log

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now qa-agent-platform
```

---

## 11. Service Management

### Windows

| Action | Command |
|--------|---------|
| Start | `nssm start QAAgentPlatform` |
| Stop | `nssm stop QAAgentPlatform` |
| Restart | `nssm restart QAAgentPlatform` |
| Status | `nssm status QAAgentPlatform` |
| View logs | `notepad C:\qa-agent-platform\logs\service.log` |
| Uninstall | `nssm remove QAAgentPlatform confirm` |

### Linux

| Action | Command |
|--------|---------|
| Start | `sudo systemctl start qa-agent-platform` |
| Stop | `sudo systemctl stop qa-agent-platform` |
| Restart | `sudo systemctl restart qa-agent-platform` |
| Status | `sudo systemctl status qa-agent-platform` |
| View live logs | `journalctl -u qa-agent-platform -f` |
| View log file | `tail -f /opt/qa-agent-platform/logs/service.log` |

---

## 12. Troubleshooting Quick Reference

| Problem | Check | Fix |
|---------|-------|-----|
| Installer fails at npm install | Proxy / firewall blocking npm | Set `npm config set proxy http://...` or use an npm mirror |
| Port already in use | `netstat -ano \| findstr :3000` (Win) / `ss -tlnp \| grep 3000` (Linux) | Change `UI_PORT` in `.env`, restart |
| Login page doesn't load | Check service log | Usually node_modules missing — run `npm install` manually |
| License shows Trial after activation | Key accepted but not reloaded | Restart the service |
| "Invalid license key" | Key format wrong | Must start with `QAP-`, no extra spaces |
| ".lic file invalid" | File for different server | Machine binding mismatch — re-request `.lic` from vendor |
| Machine mismatch after server move | Hardware fingerprint changed | Set `QA_SKIP_MACHINE_CHECK=1` in `.env`, start, Admin → License → Transfer, remove env var |
| "Seat limit reached" at login | All seats occupied | Admin → License → Active Sessions → force logout idle users |
| Suite run never starts | Playwright missing | `npx playwright install chromium` |
| Suite run fails with browser error | Headless issues | Ensure `HEADLESS=true` in `.env` |
| Linux: permission denied errors | Wrong file owner | `sudo chown -R qa-platform:qa-platform /opt/qa-agent-platform` |
| Linux: service won't start (RHEL) | SELinux blocking | `sudo setenforce 0` (temp), investigate with `ausearch -m avc` |
| Windows: service won't start | NSSM AppDirectory wrong | Re-check with `nssm edit QAAgentPlatform` |

---

## 13. Licensing — Deep Dive

See [docs/LICENSING_USERFLOW.md](LICENSING_USERFLOW.md) for the complete licensing architecture, tier comparison, quota table, and testing checklist.

Key points for your team:

| Topic | Detail |
|-------|--------|
| License file location | `<install>/data/license.json` — AES-256-GCM encrypted |
| Tampering | Editing `license.json` directly causes decryption failure → read-only mode |
| Machine binding | Enterprise/Team fingerprinted to hardware; trial has none |
| Transfer (new server) | Admin → License → Transfer — rewrites fingerprint to current machine |
| Auto-trial | Activates automatically on first start if no license; 14 days, 3 seats |
| Internal perpetual | Run `scripts/seed-internal-license.ts` for vendor's own servers |
| Lost `.env` | `QA_SECRET_KEY` changed → old `license.json` unreadable → re-activate key |

---

## 14. Uninstall / Re-install

### Windows
```powershell
nssm stop   QAAgentPlatform
nssm remove QAAgentPlatform confirm
# Back up data\ first if you want to keep run history
Remove-Item -Recurse -Force "C:\qa-agent-platform"
```

### Linux
```bash
sudo systemctl stop    qa-agent-platform
sudo systemctl disable qa-agent-platform
sudo rm /etc/systemd/system/qa-agent-platform.service
sudo systemctl daemon-reload
# Back up data/ first if needed
sudo rm -rf /opt/qa-agent-platform
sudo userdel qa-platform
```

---

*Document maintained by the QA Agent Platform vendor team. Last updated: 2026-04-19.*
