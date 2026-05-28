# QA Agent Platform — Complete Installation Guide
> **Version:** 2.1 — 2026-05-28
> **Covers:** Building a release package (vendor) + Installing on a customer server (IT Admin)

---

## Who Should Read What

| You are... | Read... |
|---|---|
| **Vendor / Developer** shipping a new version | Part A — Building the Release Package |
| **IT Admin** installing on a customer server | Part B — Installing the Platform |
| **Customer Admin** activating a license | Part C — Activating the License |

---

# PART A — Building the Release Package
### For Vendor / Developer Only

This section explains how to produce the ZIP file you send to the customer.
You do this once per release from the **dev machine**.

---

## A.1 — Two Types of Package

| Package | When to use | File size |
|---|---|---|
| **Slim** | Customer has good internet access | ~3 MB |
| **Fat (with browsers)** | Customer has slow / restricted internet | ~460 MB |

The fat package includes all browser engines (Chromium, Firefox, WebKit) pre-bundled.
The installer detects them automatically and skips all downloads on the customer machine.

---

## A.2 — Build the Package

Open PowerShell in the project root and run:

**Slim package** (customer downloads browsers during install):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1
```

**Fat package** (browsers included — recommended for most customers):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1 -BundleBrowsers
```

The packager will:
1. Verify the TypeScript build is current
2. Copy only the files the customer needs into a clean staging folder
3. Run a safety check — blocks the build if any dev files (`.env`, `data/`, licenses, AI configs) leaked in
4. Bundle browser engines if `-BundleBrowsers` was specified
5. Create the ZIP in the `releases\` folder

**Output example:**
```
releases\qa-agent-platform-v1.0.0-browsers.zip   (fat)
releases\qa-agent-platform-v1.0.0.zip             (slim)
```

---

## A.3 — What Is and Is Not in the Package

| Included | Not Included (intentionally) |
|---|---|
| `src/` — platform source code | `node_modules/` — reinstalled by installer |
| `scripts/` — installer scripts | `dist/` — rebuilt by installer |
| `docs/` — documentation | `.env` — installer generates a fresh one with new secrets |
| `tools/` — license generator | `data/` — dev users, dev licenses, dev test data |
| `package.json`, build configs | `.git/`, `.claude/`, `.gemini/` — dev tooling |
| `.env.example` — reference only | `CLAUDE.md`, `AGENTS.md` — AI assistant configs |
| `.playwright-browsers/` (fat only) | `results/`, `logs/`, `screenshots/` — dev artifacts |

---

## A.4 — Future Releases

1. Bump the version number in `package.json`
2. Run `npm run build` to update the TypeScript build
3. Run the packager again — the new version number is picked up automatically
4. Send the new ZIP to the customer

---

# PART B — Installing the Platform
### For IT Admin on the Customer Server

You have received a ZIP file from the vendor.
This guide walks you through the complete installation — it takes about 10-20 minutes.

---

## B.1 — What You Need Before Starting

- [ ] The ZIP file from the vendor (e.g. `qa-agent-platform-v1.0.0-browsers.zip`)
- [ ] A Windows Server 2019 or later (Windows 10/11 also works)
- [ ] At least **4 GB RAM** and **20 GB free disk space**
- [ ] You must be able to **Run PowerShell as Administrator**
- [ ] Internet access is required only if you received the slim package (no `-browsers` in the filename)

---

## B.2 — Step 1: Extract the ZIP

1. Copy the ZIP file to the server
2. Right-click the ZIP → **Extract All**
3. Extract to `C:\` — this creates the folder `C:\qa-agent-platform\`

> **Important:** Extract directly to `C:\`, not inside another folder.
> After extraction you should see `C:\qa-agent-platform\scripts\install.ps1`

If you want to install to a different drive (e.g. `E:\`), extract there instead.
The installer will ask you for the path.

---

## B.3 — Step 2: Run the Installer as Administrator

1. Click the **Start** menu
2. Search for **PowerShell**
3. Right-click **Windows PowerShell** → click **Run as administrator**
4. A blue PowerShell window opens — type this command and press Enter:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\qa-agent-platform\scripts\install.ps1"
```

> If you extracted to a different location, replace `C:\qa-agent-platform` with your path.

---

## B.4 — Step 3: Answer the Setup Questions

The installer asks 4 questions. Press **Enter** to accept the default shown in brackets,
or type your own value.

```
Install path  [C:\qa-agent-platform]    <- press Enter to accept, or type a different path
Server port   [3000]                    <- press Enter (change only if port 3000 is in use)
Friendly hostname                       <- optional, e.g. qa-platform.local  (leave blank if unsure)
Organisation name [QA Platform]         <- type your company name, e.g. Acme Corp
```

After answering, type **Y** and press Enter to begin.

---

## B.5 — What the Installer Does Automatically

You do not need to do anything while the installer runs. It handles everything:

| Step | What happens |
|---|---|
| 1 | Checks if Node.js is installed — installs it automatically if not |
| 2 | Checks if NSSM (service manager) is installed — installs it automatically if not |
| 3 | Copies platform files to the install folder |
| 4 | Creates a `.env` configuration file with unique security keys |
| 5 | Installs Node.js dependencies (`npm install`) |
| 6 | Builds the platform (`npm run build`) |
| 7 | Installs browser engines — **skipped automatically** if browsers are pre-bundled |
| 8 | Registers the platform as a Windows Service (auto-starts on boot) |
| 9 | Opens the firewall for the chosen port |
| 10 | Starts the service and verifies it is running |

---

## B.6 — What a Successful Install Looks Like

When the installer finishes you will see:

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

The platform is now running as a Windows Service and will start automatically every time the server reboots.

---

## B.7 — Step 4: Verify the Installation

Open a web browser on the server (or any computer on the same network) and go to:

```
http://<server-ip-address>:3000
```

Replace `<server-ip-address>` with the actual IP address of your server.
If you set a friendly hostname (e.g. `qa-platform.local`), you can use that instead.

You should see the **QA Agent Platform login screen**.

---

## B.8 — Step 5: First Login

1. Enter username: `admin`
2. Enter password: `Admin@123`
3. Click **Log In**
4. The platform will immediately ask you to **set a new password** — do this before anything else
5. You are now on the main dashboard

> The platform starts in **Free Trial mode** — fully functional for 14 days.
> You will see an orange banner at the top. This is normal.
> Activate a license key (Part C) to replace the trial.

---

## B.9 — Creating the First Real Admin Account

The default `admin` account is a seed account for setup only. Create a proper account for day-to-day use:

1. Click **Admin** in the top navigation
2. Click **Users**
3. Click **Add User**
4. Set Role to **Admin**
5. Create a strong password and give the credentials to the IT/QA admin
6. Ask them to log in and change the password immediately

Optionally deactivate the seed `admin` account after the real admin is set up.

---

## B.10 — Service Management Commands

After installation, use these commands to manage the service:

| Action | Command |
|---|---|
| Start | `nssm start QAAgentPlatform` |
| Stop | `nssm stop QAAgentPlatform` |
| Restart | `nssm restart QAAgentPlatform` |
| Check status | `nssm status QAAgentPlatform` |
| View logs | `notepad C:\qa-agent-platform\logs\service.log` |
| Uninstall service | `nssm remove QAAgentPlatform confirm` |

---

## B.11 — Troubleshooting

| Problem | What to check | Fix |
|---|---|---|
| Installer fails at Step 5 (npm install) | Is `package.json` in the install folder? | Re-extract the ZIP and re-run |
| Installer fails at Step 7 (browsers) | Internet connection on slim package | Use the fat package (`-browsers` ZIP) |
| Login page does not load | Is the service running? | Run `nssm status QAAgentPlatform` |
| Port already in use | Another app on port 3000 | Re-run installer, choose a different port |
| "Access denied" error | Not running as Administrator | Close PowerShell, right-click, Run as Administrator |
| Service stops after a few seconds | Check the error log | `notepad C:\qa-agent-platform\logs\service-error.log` |
| Forgot admin password | Cannot recover — reset required | Delete `data\users.json`, restart service — re-seeds admin |

---

# PART C — Activating the License
### For Customer Admin

> You do NOT need to touch any files or folders.
> Everything is done through the web browser.

---

## C.1 — What You Need

- [ ] The platform already installed and running (Part B complete)
- [ ] Your admin username and password
- [ ] The **license key** or **license file (.lic)** sent to you by the vendor

---

## C.2 — Activate Your License

1. Open your browser and go to the platform URL
2. Log in as admin
3. Click **Admin** in the top navigation
4. Click the **License** tab
5. Choose one of the following:

**If you received a license key** (looks like `QAP-ENT-ACME001-202612-010-001-A3F7`):
- Paste the key into the **License Key** box
- Click **Activate**

**If you received a .lic file** (attachment in email):
- Click **Upload .lic File**
- Select the file from your computer
- Click **Activate**

6. A green message appears: **"License activated successfully"**
7. The platform now shows your tier, seat count, and expiry date

---

## C.3 — What the Trial Gives You

If you have not yet received a license key, the platform runs in free trial mode:

| Feature | Trial |
|---|---|
| Duration | 14 days |
| Users (concurrent) | 3 |
| Projects | 3 |
| Test Recorder | Yes |
| Test Debugger | Yes |
| Scheduler | Yes |
| SSO / LDAP | No |

When the trial expires the platform goes into read-only mode — your data is safe.
Activating a license key immediately restores full access.

---

## C.4 — License Expiry and Renewal

- You will see a warning banner **14 days before** your license expires
- When it expires, the platform enters read-only mode (data always safe)
- Contact the vendor to renew — activate the new key the same way as above

---

## C.5 — Common License Issues

| Problem | Solution |
|---|---|
| "Invalid license key" | Check the full key was copied — starts with `QAP-`, no spaces |
| "License file could not be verified" | File is for a different server — contact vendor for a new one |
| "Seat limit reached" | Admin → License → Active Sessions → revoke an idle session |
| License activated but still shows Trial | Restart the service: `nssm restart QAAgentPlatform` |

---

## Support

Contact the vendor support team with:
- Your **Organisation ID** (shown on Admin → License page)
- A **screenshot** of any error message
- Your **platform version** (shown at the bottom of Admin → License page)

---

*QA Agent Platform — Installation Guide — v2.1 — 2026-05-28*
