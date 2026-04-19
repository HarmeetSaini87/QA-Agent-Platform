# QA Agent Platform — Implementation & Installation Guide
> **Audience:** Implementation Engineers / Support Engineers  
> **Version:** 1.0 — 2026-04-19  
> **Time to complete:** 45–90 minutes on a clean server

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Server Sizing](#2-server-sizing)
3. [Download & Place the Software](#3-download--place-the-software)
4. [Configure the Environment File](#4-configure-the-environment-file)
5. [Install Node.js Dependencies](#5-install-nodejs-dependencies)
6. [First-Time Build](#6-first-time-build)
7. [Run the Server (Manual Test)](#7-run-the-server-manual-test)
8. [Install as a Windows Service (Production)](#8-install-as-a-windows-service-production)
9. [Firewall & Network](#9-firewall--network)
10. [Licensing — Complete Setup](#10-licensing--complete-setup)
11. [Activate the License (Admin UI)](#11-activate-the-license-admin-ui)
12. [Verify the Installation](#12-verify-the-installation)
13. [Create the First Real Admin Account](#13-create-the-first-real-admin-account)
14. [Hand Off to the Customer](#14-hand-off-to-the-customer)
15. [Troubleshooting Quick Reference](#15-troubleshooting-quick-reference)
16. [Uninstall / Re-install](#16-uninstall--re-install)

---

## 1. Prerequisites

Install the following on the **customer's server** before starting.

### 1.1 Node.js ≥ 18

```powershell
# Check if already installed
node --version     # must show v18.x.x or higher
npm  --version     # must show v8 or higher
```

Download from: https://nodejs.org/en/download  
Choose **Windows Installer (.msi) — LTS version**.  
Install with defaults. Tick "Add to PATH" if prompted.

### 1.2 Git (optional but recommended)

Only needed if deploying from a repository.  
Download from: https://git-scm.com/download/win

### 1.3 NSSM — Windows Service Manager

Used to run the platform as a background Windows Service.  
Download: https://nssm.cc/download  
Unzip to `C:\Tools\nssm\` and add `C:\Tools\nssm\win64` to System PATH.

### 1.4 Playwright System Dependencies

Run once after Node.js is installed:

```powershell
npx playwright install chromium
npx playwright install-deps chromium
```

---

## 2. Server Sizing

| Attribute | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Windows Server 2019+ | Windows Server 2022 |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 50 GB |
| Port | 3000 (configurable) | 3000 |
| Internet | Not required | Not required |

The platform runs entirely **on-premises**. No cloud calls are made.

---

## 3. Download & Place the Software

### Option A — From ZIP (most common)

1. Receive the `qa-agent-platform-vX.X.zip` file from the vendor.
2. Extract to: `C:\qa-agent-platform\`
3. Verify the folder structure:

```
C:\qa-agent-platform\
├── src\
├── scripts\
├── docs\
├── package.json
├── tsconfig.json
└── playwright.config.ts
```

### Option B — From GitHub (if customer has repo access)

```powershell
git clone https://github.com/HarmeetSaini87/QA-Agent-Platform.git C:\qa-agent-platform
```

---

## 4. Configure the Environment File

Navigate to the installation folder:

```powershell
cd C:\qa-agent-platform
```

Copy the sample environment file:

```powershell
copy .env.example .env
```

If no `.env.example` exists, create a new file named `.env` with this content:

```ini
# ── Server ────────────────────────────────────────────────
UI_PORT=3000
APP_ENV=production
APP_ENV_LABEL=PROD

# ── Security (CHANGE THESE — use long random strings) ─────
SESSION_SECRET=change-me-to-a-long-random-string-minimum-32-chars
QA_SECRET_KEY=change-me-to-another-long-random-string-32-chars

# ── Data & Output Paths ───────────────────────────────────
DATA_DIR=./data
TEST_RESULTS_DIR=./test-results
RESULTS_DIR=./results
REPORTS_DIR=./reports
TEST_PLANS_DIR=./test-plans

# ── Test Execution Defaults ───────────────────────────────
HEADLESS=true
DEFAULT_TIMEOUT=30000
SCREENSHOT_MODE=only-on-failure

# ── Application Under Test (set per customer environment) ─
APP_BASE_URL=https://your-app-url.com
```

### Critical: Change the Secrets

`SESSION_SECRET` and `QA_SECRET_KEY` encrypt session cookies and the license file.  
**If you reuse defaults across customers, license files become cross-compatible.**

Generate a secure value:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run this twice — once for each secret. Paste into `.env`.

---

## 5. Install Node.js Dependencies

```powershell
cd C:\qa-agent-platform
npm install
```

This downloads all packages into `node_modules\`. Takes 2–5 minutes on first run.  
If errors appear about optional dependencies, they are safe to ignore.

---

## 6. First-Time Build

Compile TypeScript source to JavaScript:

```powershell
npm run build
```

Expected output: command completes with **no errors**. If errors appear, contact the vendor.

---

## 7. Run the Server (Manual Test)

Start the server manually to confirm it works before installing as a service:

```powershell
npm run ui
```

Open a browser and go to: `http://localhost:3000`

You should see the QA Agent Platform login screen.

Login with the default credentials:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `Admin@123` |

> **The system will force a password change on first login.** Change it immediately.

Press `Ctrl+C` in the PowerShell window to stop the server when done testing.

---

## 8. Install as a Windows Service (Production)

This ensures the platform starts automatically after server reboots.

### Step 8.1 — Install the Service

```powershell
cd C:\qa-agent-platform

# Copy the startup script
copy scripts\start-qa-platform.ps1 C:\qa-agent-platform\start-qa-platform.ps1

# Install as a Windows Service using NSSM
nssm install QAAgentPlatform powershell.exe -ExecutionPolicy Bypass -File "C:\qa-agent-platform\start-qa-platform.ps1"

# Set working directory
nssm set QAAgentPlatform AppDirectory "C:\qa-agent-platform"

# Set service to start automatically
nssm set QAAgentPlatform Start SERVICE_AUTO_START

# Set service description
nssm set QAAgentPlatform Description "QA Agent Platform — AI Test Automation"

# Redirect logs
nssm set QAAgentPlatform AppStdout "C:\qa-agent-platform\logs\service.log"
nssm set QAAgentPlatform AppStderr "C:\qa-agent-platform\logs\service-error.log"
nssm set QAAgentPlatform AppRotateFiles 1
nssm set QAAgentPlatform AppRotateBytes 10485760
```

Create the logs directory:

```powershell
mkdir C:\qa-agent-platform\logs -Force
```

### Step 8.2 — Start the Service

```powershell
nssm start QAAgentPlatform
```

### Step 8.3 — Verify Service is Running

```powershell
nssm status QAAgentPlatform
# Expected: SERVICE_RUNNING

curl -s http://localhost:3000 -o NUL -w "%{http_code}"
# Expected: 200
```

### Step 8.4 — Service Management Commands

```powershell
nssm start   QAAgentPlatform   # start
nssm stop    QAAgentPlatform   # stop
nssm restart QAAgentPlatform   # restart
nssm remove  QAAgentPlatform   # uninstall service (confirm prompt)
```

---

## 9. Firewall & Network

Allow the platform port through Windows Firewall:

```powershell
netsh advfirewall firewall add rule name="QA Agent Platform" dir=in action=allow protocol=TCP localport=3000
```

If the customer uses IIS or nginx as a reverse proxy (to expose on port 80/443), configure it to forward to `http://localhost:3000`. Contact the vendor for IIS ARR proxy config.

### Hostname Access

To access via hostname instead of IP (e.g., `http://qa-platform.local`):

1. On each user's PC, add to `C:\Windows\System32\drivers\etc\hosts`:
   ```
   192.168.1.x    qa-platform.local
   ```
   Replace `192.168.1.x` with the actual server IP.

2. Or configure the customer's internal DNS to resolve the hostname.

---

## 10. Licensing — Complete Setup

### 10.1 How the License System Works

```
Fresh install
     ↓
Server starts → checks data\license.json
     ↓
  Not found → AUTO-TRIAL activates (14 days, 3 seats, 3 projects)
     ↓
Admin logs in → Admin → License tab → activates vendor key or .lic file
     ↓
data\license.json written (AES-256-GCM encrypted)
     ↓
Server restart → reads encrypted license → fully licensed
```

**Key points for your team:**
- `data\license.json` is encrypted — customers **cannot** manually edit or extend it.
- The encryption key comes from `QA_SECRET_KEY` in `.env`. If `.env` is lost, the license must be re-activated.
- Machine binding: enterprise/team licenses are bound to the server's hardware fingerprint (MAC + hostname + CPU). If the server changes, use the Transfer button in Admin → License.
- Trial (`AUTO-TRIAL`) has no machine binding.

### 10.2 What the Vendor Sends

The vendor sends one of the following:

| License Type | What You Receive | Format |
|---|---|---|
| Starter / Team / Enterprise (HMAC key) | A license key string | `QAP-ENT-ACME001-202612-010-001-A3F7` |
| Enterprise (signed .lic file) | A binary license file | `acme-corp.lic` |

### 10.3 Where to Put the License

**The customer does NOT need to place any file manually.**

The license is activated through the browser UI by an admin user:

```
Browser → http://localhost:3000 → Login → Admin tab → License sub-tab → Activate
```

Step-by-step is in [Section 11](#11-activate-the-license-admin-ui).

If a `.lic` file was provided, you only need to have the file accessible on the machine that opens the browser (it is uploaded via the UI form — not placed in a folder).

### 10.4 Protecting Your Own Server (Vendor Internal)

If you are setting up the vendor's own dev or prod instance, seed the perpetual license first:

```powershell
cd C:\qa-agent-platform
npx tsx scripts\seed-internal-license.ts
```

This writes a perpetual enterprise license that prevents the 14-day auto-trial from running.

---

## 11. Activate the License (Admin UI)

### For a License Key (string)

1. Open browser → `http://<server-ip>:3000`
2. Log in as `admin`
3. Click **Admin** in the top navigation
4. Click the **License** sub-tab
5. In the **Activate License** box, paste the key into the text field
6. Click **Activate**
7. The page refreshes showing tier, seats, and expiry date
8. **Restart the server** to fully apply:
   ```powershell
   nssm restart QAAgentPlatform
   ```

### For a .lic File

1. Open browser → `http://<server-ip>:3000`
2. Log in as `admin`
3. Click **Admin** → **License**
4. Click **Upload .lic File** (below the key field)
5. Select the `.lic` file provided by the vendor
6. Click **Activate**
7. Restart the server

### Confirming Activation

After restart, go back to Admin → License. Confirm:

- **Tier:** shows `enterprise` / `team` / `starter`
- **Seats:** shows the licensed seat count
- **Expires:** shows a date years in the future (not a 14-day trial date)
- **Auto-Trial badge** should be gone

---

## 12. Verify the Installation

Run through this checklist before handing off:

```
[ ] Server is running (curl returns 200)
[ ] Login page loads at http://<ip>:3000
[ ] Default admin login works (Admin@123)
[ ] Password change forced on first login — change it
[ ] Admin → License shows correct tier and expiry
[ ] Create a test Project — visible in project selector
[ ] Create a test Script with 2-3 keywords — saves correctly
[ ] Create a test Suite — can add the script
[ ] Run the Suite — execution completes (pass/fail shown)
[ ] Execution History shows the run
[ ] Service auto-starts after reboot (restart server, check service)
```

---

## 13. Create the First Real Admin Account

The default `admin / Admin@123` account is a seed account. Create a proper admin for the customer:

1. Log in as `admin`
2. Go to **Admin** → **Users**
3. Click **Add User**
4. Fill in Name, Email, set Role to **Admin**
5. Set a strong temporary password
6. Give credentials to the customer's IT admin
7. Ask them to change the password on first login

Optionally disable the seed `admin` account after the real admin is created.

---

## 14. Hand Off to the Customer

Give the customer:

1. **URL:** `http://<server-ip-or-hostname>:3000`
2. **Admin credentials** (the one you created in step 13)
3. **Customer License Guide** (`docs/CUSTOMER_LICENSE_GUIDE.md`) — non-technical activation steps
4. **Support contact** for license questions

Brief the customer admin:
- How to create users (Admin → Users)
- How to create a project (Projects tab)
- Where to see license status (Admin → License)
- What happens when trial/license expires (read-only mode — no new runs)

---

## 15. Troubleshooting Quick Reference

| Problem | Check | Fix |
|---------|-------|-----|
| `npm run build` fails | TypeScript errors in output | Contact vendor — do not modify source |
| Port 3000 already in use | `netstat -ano \| findstr :3000` | Change `UI_PORT` in `.env`, restart |
| Server starts but no login page | Check `logs\service-error.log` | Usually a missing `node_modules` — run `npm install` |
| Login works but license shows Trial | License not activated | Follow Section 11 |
| License activation fails "machine mismatch" | Server hardware changed | Admin → License → Transfer |
| License activation fails "key invalid" | Wrong key format | Verify key with vendor — must start with `QAP-` |
| `.lic` file upload fails | File corrupted or wrong server | Re-request `.lic` from vendor |
| Test suite run never starts | Playwright not installed | Run `npx playwright install chromium` |
| Suite run fails with browser error | Headless mode issue | Set `HEADLESS=true` in `.env`, restart |
| Seats full, admin can't log in | All seats occupied | Admin → License → Sessions → force logout idle users |
| Server crashes on restart after hardware change | Machine binding mismatch | Set `QA_SKIP_MACHINE_CHECK=1` in `.env` temporarily, log in, Admin → License → Transfer, remove env var |

---

## 16. Uninstall / Re-install

```powershell
# Stop and remove the service
nssm stop   QAAgentPlatform
nssm remove QAAgentPlatform confirm

# Remove the application (data\ folder contains run history — back up first if needed)
Remove-Item -Recurse -Force C:\qa-agent-platform
```

To re-install: start from Section 3.

---

*Document maintained by the QA Agent Platform vendor team. Last updated: 2026-04-19.*
