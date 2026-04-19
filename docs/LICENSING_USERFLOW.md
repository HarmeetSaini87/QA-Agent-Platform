# QA Agent Platform — Licensing User Flow & Test Guide
# Audience: Vendor Operations + Customer Admin + QA Tester
# Created: 2026-04-17 | Last Updated: 2026-04-19
# Covers: All license tiers, all enforcement layers, all user roles, auto-trial

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [License Tiers & SKUs](#2-license-tiers--skus)
3. [Quota Reference](#3-quota-reference)
4. [Vendor Flows](#4-vendor-flows)
   - 4.1 One-Time: Generate RSA Key Pair
   - 4.2 Issue a Trial Key (EVAL)
   - 4.3 Issue a Starter HMAC Key
   - 4.4 Issue a Team / Enterprise .lic File
   - 4.5 Issue a Perpetual Enterprise License
   - 4.6 Issue a White-label Enterprise License
5. [Customer Admin Flows](#5-customer-admin-flows)
   - 5.1 Get Your Machine ID (before activation)
   - 5.2 Activate a Starter HMAC Key
   - 5.3 Activate a Team / Enterprise .lic File
   - 5.4 View License Status
   - 5.5 Deactivate a License
   - 5.6 Transfer License to New Machine
6. [End-User Flows](#6-end-user-flows)
   - 6.1 Login with Seat Enforcement
   - 6.2 Using a Locked Feature (Upgrade CTA)
   - 6.3 Session Timeout
7. [Quota-Based Enforcement](#7-quota-based-enforcement)
   - 7.1 Seat Quota (Concurrent Sessions)
   - 7.2 Project Quota
   - 7.3 Instance Quota
   - 7.4 Audit Trail Retention Quota
8. [Machine Binding Flows](#8-machine-binding-flows)
   - 8.1 Normal Startup
   - 8.2 Machine Mismatch — Server Refuses to Start
   - 8.3 Transfer License
   - 8.4 CI/CD / Docker Mode
9. [Expiry Flows](#9-expiry-flows)
   - 9.1 14-Day Warning Banner
   - 9.2 7-Day Grace Period Banner
   - 9.3 License Expiry — Read-Only Mode
   - 9.4 License Renewal
10. [Trial / Evaluation Flow](#10-trial--evaluation-flow)
11. [Active Session Dashboard (Admin)](#11-active-session-dashboard-admin)
12. [License Audit Log](#12-license-audit-log)
13. [Seat Audit Report Export](#13-seat-audit-report-export)
14. [White-Label Flow (Enterprise)](#14-white-label-flow-enterprise)
15. [System-Level Tamper Protection](#15-system-level-tamper-protection)
16. [Environment Variables Reference](#16-environment-variables-reference)
17. [Testing Checklist — Vendor](#17-testing-checklist--vendor)
18. [Testing Checklist — Customer Admin](#18-testing-checklist--customer-admin)
19. [Testing Checklist — End User](#19-testing-checklist--end-user)
20. [Feature Override Add-ons (Phase 4)](#20-feature-override-add-ons-phase-4)
    - 20.1 Concepts
    - 20.2 Vendor Flow — Grant Add-on
    - 20.3 Vendor Flow — Revoke Feature
    - 20.4 Vendor Flow — Multiple Overrides
    - 20.5 Customer Admin Flow — Activate Override .lic
    - 20.6 What the Customer Admin Sees
    - 20.7 Error Cases
    - 20.8 Testing Checklist

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  VENDOR MACHINE (air-gapped from customer)                          │
│                                                                     │
│  tools/genVendorKeys.ts → vendor-private.pem (vault)               │
│                         → vendor-public.pem  (embedded in app)     │
│                                                                     │
│  tools/genLicense.ts   → HMAC key string  (Starter/Trial)          │
│                        → .lic file (RSA signed) (Team/Enterprise)  │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ email / USB / secure channel
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CUSTOMER MACHINE (on-premise, fully air-gapped)                    │
│                                                                     │
│  data/license.json  → AES-256-GCM encrypted                        │
│    ├── encKey        : license key or 'lic-file'                    │
│    ├── encMachineId  : bound machine fingerprint                    │
│    ├── encPayload    : full LicensePayload (tier, seats, expiry…)  │
│    └── licFilePath?  : path to data/license.lic                    │
│                                                                     │
│  data/license.lic   → RSA-signed JSON (Team/Enterprise only)       │
│  data/sessions.sqlite → connect-sqlite3 session store              │
│  data/audit.json    → all platform events including license events  │
│                                                                     │
│  src/ui/server.ts                                                   │
│    ├── STARTUP:  activateAutoTrial()  → no license.json → 14-day trial  │
│    │             checkStoredLicFile()  → RSA re-verify             │
│    │             checkMachineBinding() → fingerprint check         │
│    │             syncSeatsFromSessions() → rehydrate seat map       │
│    ├── EVERY REQUEST: getLicensePayload() → expiry re-check        │
│    ├── EVERY HOUR:   checkExpiryTick()                             │
│    └── ON LOGIN:     isSeatAvailable() (skipped if no license)     │
└─────────────────────────────────────────────────────────────────────┘
```

### No Network Required
All validation is local. The customer machine never makes any call to:
- A vendor license server
- A heartbeat endpoint
- Any external URL

The vendor and customer communicate out-of-band (email, ticket system).

---

## 2. License Tiers & SKUs

| Tier | Code | Activation | Machine Binding | Use Case |
|------|------|-----------|-----------------|----------|
| **Auto-Trial** | `AUTO-TRIAL` | Automatic on first install | None | 14-day built-in trial, no key needed |
| **Trial** | `EVAL` | HMAC key | None | 30-day vendor-issued evaluation key |
| **Starter** | `STR` | HMAC key | Yes (fingerprint) | 1 server, up to 3 users |
| **Team** | `TEAM` | RSA `.lic` file | Yes (signed into .lic) | 1–3 servers, paid user count |
| **Enterprise** | `ENT` | RSA `.lic` file | Yes (signed into .lic) | Multi-server, unlimited users, white-label |

### Standard Volume SKUs

| SKU ID | Tier | Seats | Instances | Typical Customer |
|--------|------|-------|-----------|-----------------|
| EVAL-30 | Trial | 5 | 1 | Evaluating before purchase |
| STR-1 | Starter | 3 | 1 | Solo SDET / freelancer |
| TEAM-5 | Team | 5 | 1 | Small QA team |
| TEAM-10 | Team | 10 | 1 | Mid-size QA team |
| TEAM-25 | Team | 25 | 1 | Large QA team |
| TEAM-HA | Team | 10 | 3 | 3-server HA cluster |
| ENT-50 | Enterprise | 50 | 5 | Enterprise department |
| ENT-UNL | Enterprise | ∞ | ∞ | Enterprise site license |
| ENT-PERP | Enterprise | varies | varies | Perpetual + SMA |

---

## 3. Quota Reference

### Per-Tier Quotas

| Quota | Auto-Trial | Trial (EVAL) | Starter | Team | Enterprise |
|-------|-----------|--------------|---------|------|------------|
| Max concurrent sessions (seats) | **3** | 5 | 3 | Paid SKU | Paid SKU |
| Max server instances | 1 | 1 | 1 | Per SKU | Per SKU |
| Max projects | **3** | ∞ | **1** | ∞ | ∞ |
| Audit log retention | 30 days | 7 days | 30 days | 90 days | ∞ |
| Duration | **14 days** | 30 days | Annual | Annual | Annual/Perpetual |
| Recorder | ✓ | ✓ | ✓ | ✓ | ✓ |
| Debugger | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scheduler | ✓ | ✓ | ✗ | ✓ | ✓ |
| SSO (SAML/LDAP) | ✗ | ✗ | ✗ | ✓ | ✓ |
| API Access | ✓ | ✗ | ✗ | ✗ | ✓ |
| White-label | ✗ | ✗ | ✗ | ✗ | ✓ |
| Machine binding | None | None | Yes | Yes | Yes |
| Key required | **No** | Yes | Yes | Yes | Yes |

### Key Format for Encoding Quotas

```
QAP-{TIER}-{ORG_ID}-{EXPIRY}-{SEATS}-{INSTANCES}-{CHECKSUM}

SEATS field:     001–998 = exact count | 999 = unlimited (-1)
INSTANCES field: 001–099 = exact count | 999 = unlimited (-1)
EXPIRY field:    YYYYMM | 999912 = Dec 9999 (perpetual)
```

---

## 4. Vendor Flows

### 4.1 One-Time: Generate RSA Key Pair

**Who:** Vendor engineer — run ONCE before any Team/Enterprise licenses are issued.

```bash
# On vendor machine only — never on customer machine
npx tsx tools/genVendorKeys.ts --out ./keys

# Output:
#   keys/vendor-private.pem  → store in Vault / AWS Secrets Manager — NEVER commit
#   keys/vendor-public.pem   → embed base64 in licenseManager.ts
#
# Console prints base64 of public key — copy into VENDOR_PUBLIC_KEY_B64 constant
```

**After running:**
1. Copy the base64 block from console output
2. Open `src/utils/licenseManager.ts`
3. Replace `'PLACEHOLDER'` in `VENDOR_PUBLIC_KEY_B64` with the base64 string
4. Rebuild and redeploy the application
5. Delete `vendor-private.pem` from this machine after storing in secrets vault

**Verification:** Run `npm run build` — if it compiles without error, the key is valid.

---

### 4.2 Issue a Trial Key (EVAL)

**Who:** Vendor sales / support  
**Customer provides:** Nothing (trial is issued without customer input)

```bash
# Calculate expiry = today + 30 days (Windows/PowerShell):
$expiry = (Get-Date).AddDays(30).ToString("yyyyMM")

npx tsx tools/genLicense.ts \
  --tier EVAL \
  --org TRIAL \
  --seats 5 \
  --instances 1 \
  --expiry $expiry

# Output example:
# Key: QAP-EVAL-TRIAL-202506-005-001-3F9A
# Tier: trial
# Seats: 5 concurrent users
# Expires: 2025-06-07 (end of May + 7 day grace)
# No machine binding — any machine can activate
```

**Send to customer:** The key string only (email/ticket).

**Enforcement:**
- EVAL tier skips machine binding — no Machine ID needed
- Max expiry enforced server-side: cannot generate EVAL key > 30 days from today
- On expiry: platform enters read-only mode identically to paid tiers

---

### 4.3 Issue a Starter HMAC Key

**Who:** Vendor operations  
**Customer provides:** Their Machine ID (from Admin → License panel)

```bash
npx tsx tools/genLicense.ts \
  --tier STR \
  --org ACME001 \
  --orgname "Acme Corp" \
  --seats 3 \
  --instances 1 \
  --expiry 202612

# Output example:
# Key: QAP-STR-ACME001-202612-003-001-7B2E
# Machine ID: not embedded in HMAC key — bound on customer activation
```

**Important:** Starter uses HMAC (not RSA). The machine ID is bound when the customer activates the key on their machine — not at issuance time. This means the same key could be activated on a different machine if deactivated first. For stronger binding, use Team/Enterprise `.lic`.

---

### 4.4 Issue a Team / Enterprise .lic File

**Who:** Vendor operations  
**Customer provides:** Machine ID (32-char hex) — one per server instance

```bash
# Step 1: Retrieve vendor-private.pem from secrets vault

# Step 2: Generate .lic file (machine-bound)
npx tsx tools/genLicense.ts \
  --tier TEAM \
  --org ACME001 \
  --orgname "Acme Corp" \
  --seats 10 \
  --instances 1 \
  --expiry 202612 \
  --machineid a3f7b2c1d9e4f2b8c3d4e5f6a7b8c9d0 \
  --lic \
  --privkey ./vendor-private.pem \
  --out acme001-server1.lic

# Output:
# Key:        QAP-TEAM-ACME001-202612-010-001-4C1D
# Machine ID: a3f7b2c1d9e4f2b8c3d4e5f6a7b8c9d0  (bound — only this machine can activate)
# .lic file written: acme001-server1.lic
```

**For HA cluster (3 servers):** Run the command 3 times with each server's Machine ID.

```bash
# Server 1
npx tsx tools/genLicense.ts --tier TEAM --org ACME001 --seats 10 --instances 3 \
  --expiry 202612 --machineid <machine-id-server1> --lic --privkey ./vendor-private.pem --out acme001-s1.lic

# Server 2
npx tsx tools/genLicense.ts --tier TEAM --org ACME001 --seats 10 --instances 3 \
  --expiry 202612 --machineid <machine-id-server2> --lic --privkey ./vendor-private.pem --out acme001-s2.lic

# Server 3
npx tsx tools/genLicense.ts --tier TEAM --org ACME001 --seats 10 --instances 3 \
  --expiry 202612 --machineid <machine-id-server3> --lic --privkey ./vendor-private.pem --out acme001-s3.lic
```

**Send to customer:** The corresponding `.lic` file for each server (via email/secure file transfer).

---

### 4.5 Issue a Perpetual Enterprise License

**Who:** Vendor operations (for government / regulated industry customers)

```bash
# Expiry 999912 = Dec 9999 (functionally perpetual)
npx tsx tools/genLicense.ts \
  --tier ENT \
  --org GOVDEPT \
  --orgname "Ministry of Finance" \
  --seats 50 \
  --instances 5 \
  --expiry 999912 \
  --machineid <machine-id> \
  --lic \
  --privkey ./vendor-private.pem \
  --out govdept-perpetual.lic
```

**Note:** Perpetual licenses still have machine binding. If the customer replaces hardware, they must request a new `.lic` with the new Machine ID. Vendor policy: free re-issuance for hardware failure; chargeable for deliberate migration.

---

### 4.6 Issue a White-Label Enterprise License

**Who:** Vendor operations (for OEM / reseller customers)

```bash
npx tsx tools/genLicense.ts \
  --tier ENT \
  --org OEMCO001 \
  --orgname "OEM Partner Corp" \
  --seats 999 \
  --instances 999 \
  --expiry 202712 \
  --machineid <machine-id> \
  --wl-appname "TestPilot Pro" \
  --wl-logourl "https://cdn.oemco.com/testpilot-logo.png" \
  --wl-color "#7c3aed" \
  --lic \
  --privkey ./vendor-private.pem \
  --out oemco001.lic
```

**Effect on customer platform:**
- Browser tab title → "TestPilot Pro"
- Nav bar heading → "TestPilot Pro" (with logo if URL provided)
- Primary accent color → purple (#7c3aed)
- Applied automatically at page load from `/api/branding`

---

## 5. Customer Admin Flows

### 5.0 Fresh Install — First Login (Auto-Trial)

**Who:** Customer platform admin — brand new install, no license key yet

```
1. Install and start the platform server
   → Server auto-activates 14-day trial (no key needed)
   → Console: "[license] No license found — auto-trial activated (14 days)"

2. Navigate to: http://your-server:3003
   → Login page appears normally

3. Log in with the seeded admin account (username: admin / password: Admin@1234 or as set during seed)
   → Seat check skipped during auto-trial activation
   → Dashboard loads with full feature access

4. Orange banner at top: "🟠 Free Trial — 14 days remaining. Activate your license key →"

5. Use the platform freely during trial:
   ✓ Create projects (up to 3)
   ✓ Create users, scripts, suites, locators
   ✓ Run suites, use recorder, debugger, scheduler, API keys
   ✗ SSO and white-label not available in trial

6. When ready to activate: Admin → License → enter key from vendor → Activate
```

---

### 5.1 Get Your Machine ID (Before Activation)

**Who:** Customer platform admin  
**When:** Before requesting any Team/Enterprise license from vendor

```
1. Start the platform server (auto-trial activates if no license exists)
2. Log in as admin
3. Navigate to: Admin tab → License sub-tab
4. Look for the blue box: "Your Machine ID (required to get a license)"
5. Your 32-character Machine ID is displayed in full
6. Click "Copy Machine ID" — copied to clipboard
7. Send the Machine ID to your vendor (email / support ticket)
```

**Machine ID computation (for reference):**
```
SHA-256(
  primaryMAC + hostname + cpuModel + osPlatform + osArch
).hex().slice(0, 32)
```

**Important:** The Machine ID changes if you:
- Replace the network card (MAC changes)
- Rename the hostname
- Move to a different physical/virtual machine

If the Machine ID changes after activation, the server will **refuse to start** until you transfer the license (see §8.3).

---

### 5.2 Activate a Starter HMAC Key

**Who:** Customer platform admin  
**Pre-condition:** Received a `QAP-STR-...` key string from vendor

```
1. Admin tab → License sub-tab
2. Look for the "Starter License Key" field
3. Paste the key: QAP-STR-ACME001-202612-003-001-7B2E
4. Click "Activate Starter Key"
5. Success message: "License activated — STARTER tier for Acme Corp"
```

**What happens server-side:**
1. `parseLicenseKey()` validates HMAC checksum
2. `calcExpiresAt()` computes expiry (end of Dec 2026 + 7 grace days = 2027-01-07)
3. `storeLicense()` encrypts key + machineId + payload → `data/license.json`
4. `refreshLicenseCache()` activates the license in-process immediately
5. `logAudit()` records `LICENSE_ACTIVATED` event

**If key is rejected, possible reasons:**
- Wrong VENDOR_SECRET on server (`QA_VENDOR_SECRET` env var mismatch)
- Key already expired
- Attempting to activate TEAM/ENT key as HMAC (blocked — requires .lic)
- Typo in key

---

### 5.3 Activate a Team / Enterprise .lic File

**Who:** Customer platform admin  
**Pre-condition:** Received a `.lic` file from vendor matching this machine's Machine ID

```
1. Admin tab → License sub-tab
2. Below the key field, find "Team / Enterprise — Upload .lic File"
3. Click "Upload .lic File"
4. Select the acme001-server1.lic file from vendor
5. Success message: "License activated — TEAM tier"
```

**What happens server-side:**
1. `.lic` file saved to `data/license.lic` (permanent storage for startup re-verify)
2. `validateLicFile()` performs:
   - RSA-SHA256 signature verification against bundled public key
   - `expiresAt` check — rejected if already expired
   - `machineId` check — payload's machineId vs `getMachineId()` — **rejected if mismatch**
3. `storeLicense('lic-file', payload, licFilePath)` persists encrypted payload + .lic path
4. `logAudit()` records `LICENSE_ACTIVATED` event

**If .lic is rejected, possible reasons:**
- Wrong machine — vendor issued it for a different Machine ID
- File tampered (RSA signature invalid)
- Already expired
- Public key in app doesn't match the private key used to sign

---

### 5.4 View License Status

**Who:** Customer platform admin

```
Admin tab → License sub-tab → Status block shows:

┌──────────────────────────────────────────────────────┐
│ [TEAM]  Acme Corp                                    │
│ Expires Dec 31, 2026  |  3 of 10 seats               │
│                                                      │
│ Features enabled: Recorder Debugger Scheduler SSO    │
│                                                      │
│ Machine Binding                                      │
│ a3f7b2c1…  [Bound ✓]                                │
│ Max 1 server instance allowed                        │
│                                                      │
│ Active Sessions — 3 of 10 seats          [Refresh]   │
│ ████░░░░░░░░░░░░░░░░  30%                            │
│ Username  Role   Logged in   Last active  IP         │
│ john      admin  09:14:22    09:47:05     10.0.0.4   │
│ mary      tester 09:20:11    09:46:58     10.0.0.5   │
│ bob       tester 09:35:44    09:45:12     10.0.0.8   │
│                                    [Revoke] [Revoke] │
│                                                      │
│ License Audit Log (4 events) ▸ (click to expand)    │
│                                                      │
│ [Export Seat Report]  [Deactivate License]           │
└──────────────────────────────────────────────────────┘
```

---

### 5.5 Deactivate a License

**Who:** Customer platform admin  
**Use case:** Migrating to a new machine, returning the license

```
1. Admin tab → License sub-tab
2. Scroll to bottom of status block
3. Click "Deactivate License"
4. Confirm prompt: "Deactivate license? The platform will continue in dev mode."
5. License removed: data/license.json deleted, data/license.lic remains on disk
6. Platform enters dev mode (no restrictions, for local use only)
```

**After deactivation:**
- The Machine ID block reappears (for requesting a new license)
- All feature gates removed (open access, no seat enforcement)
- `LICENSE_DEACTIVATED` logged to audit

---

### 5.6 Transfer License to New Machine

**Use case:** Hardware replaced, VM migrated, hostname changed  
**See full flow in §8.3**

---

## 6. End-User Flows

### 6.1 Login with Seat Enforcement

**Scenario A — Seat available:**
```
1. User navigates to /login
2. Enters username + password
3. Server: isSeatAvailable(userId) → true (seat free or user already has session)
4. Session created in data/sessions.sqlite
5. recordLogin(userId) increments seat map
6. User lands on main dashboard
```

**Scenario B — Seat limit reached:**
```
1. User navigates to /login
2. Enters username + password
3. Server: isSeatAvailable(userId) → false (all 10 seats occupied by others)
4. HTTP 403 returned:
   {
     "error": "Seat limit reached. All licensed seats are in use.",
     "seatsUsed": 10,
     "seatsTotal": 10
   }
5. Login page shows error: "All seats are currently in use. Please try again later."
6. Admin must revoke an idle session (Admin → License → Active Sessions → Revoke)
```

**Scenario C — User already has a session (multi-tab):**
```
1. User already logged in on Tab A
2. Opens Tab B, logs in again
3. isSeatAvailable(userId) → true (same userId — existing session, not a new seat)
4. Second session created; seat count unchanged (user occupies 1 seat total)
```

---

### 6.2 Using a Locked Feature (Upgrade CTA)

**Scenario: Team user tries to use API Access (Enterprise-only)**
```
1. User or system calls POST /api/some-enterprise-endpoint
2. requireFeature('apiAccess') middleware fires
3. getLicensePayload() → tier = 'team', features.apiAccess = false
4. HTTP 402 returned:
   {
     "error": "Feature not available on your license tier",
     "feature": "apiAccess",
     "tier": "team",
     "upgrade": "enterprise"
   }
5. UI shows modal:
   ┌──────────────────────────────────┐
   │  🔒 ApiAccess not available      │
   │  This feature requires the       │
   │  Enterprise plan.                │
   │  Contact your vendor to upgrade. │
   │         [Got it]                 │
   └──────────────────────────────────┘
```

**Feature → Required Tier mapping:**
| Feature | Blocked for | Requires |
|---------|------------|---------|
| Scheduler | Starter, Trial | Team |
| SSO | Starter, Trial | Team |
| API Access | Starter, Trial, Team | Enterprise |
| White-label | Starter, Trial, Team | Enterprise |

---

### 6.3 Session Timeout

```
1. User logs in at 09:00
2. Settings: sessionTimeoutMinutes = 60
3. User is idle — no requests after 09:00
4. At 10:01, user makes a request
5. Server inactivity check: now - lastActivity > 60min
6. Session destroyed; recordLogout(userId) decrements seat map
7. HTTP 401 returned: { "code": "SESSION_EXPIRED" }
8. app.js fetch interceptor catches 401 → redirects to /login?reason=expired
9. Login page shows: "Your session expired due to inactivity"
10. Seat freed immediately — another user can log in
```

---

## 7. Quota-Based Enforcement

### 7.1 Seat Quota (Concurrent Sessions)

**How seats are counted:**
- 1 seat = 1 unique logged-in user (regardless of how many browser tabs they have open)
- Seats are floating / concurrent — not named / assigned permanently
- A seat is freed when: user logs out OR session expires (inactivity timeout)
- Seat count survives server restarts (rehydrated from `data/sessions.sqlite`)

**Enforcement point:** `POST /api/auth/login`

**Testing seat enforcement:**
```
# Setup: 3-seat Starter license
# Open 3 browser windows and log in as 3 different users: alice, bob, carol
# All 3 login succeed → seatsUsed = 3

# Now open 4th browser window, log in as dave
# → HTTP 403: "Seat limit reached"

# In Admin → License → Active Sessions, click Revoke next to carol
# carol's session is destroyed → seatsUsed = 2

# Log in as dave → succeeds → seatsUsed = 3
```

**80% warning threshold:**
```
# 8 of 10 seats used → amber banner appears at top of page (admin-only view):
# "⚠ 8 of 10 seats in use (80%) — consider upgrading your license."
```

---

### 7.2 Project Quota

**Starter tier:** Max 1 project  
**Trial, Team, Enterprise:** Unlimited projects

**Enforcement:** `POST /api/projects` checks `features.maxProjects`

```
# Starter user: created project "Acme Checkout"
# Tries to create second project "Acme Search"
# → HTTP 402: "Feature not available on your license tier"
#    upgrade: 'team'
# UI: Upgrade CTA modal shown
```

---

### 7.3 Instance Quota

**What it controls:** How many distinct machines can be activated with the same license key/org.

**Current enforcement (P1-EG / P3):**
- The `maxInstances` field is stored in the license payload and surfaced in the License panel UI
- Each machine requires its own `.lic` file (signed with that machine's ID)
- Attempting to use Server A's `.lic` on Server B fails machineId check → activation rejected

**Future (Phase 4+):** A vendor activation registry would track how many machines have activated and reject new activations beyond `maxInstances`. Currently the vendor enforces this manually at issuance time.

---

### 7.4 Audit Trail Retention Quota

**What it controls:** How many days of audit log history is shown in the Audit panel.

| Tier | Retention |
|------|-----------|
| Trial | 7 days |
| Starter | 30 days |
| Team | 90 days |
| Enterprise | ∞ (unlimited) |

**Enforcement point:** `GET /api/admin/audit` filters by `features.auditDays`

```
# Starter customer requesting audit for 60 days ago:
# → GET /api/admin/audit?days=60
# → Server: features.auditDays = 30 → returns only last 30 days of events
# → Records older than 30 days are not returned (not deleted from disk — just not shown)
```

---

## 8. Machine Binding Flows

### 8.1 Normal Startup

```
Server starts → server.listen() callback fires:

Step 1 — RSA .lic re-verify (if .lic was used):
  checkStoredLicFile()
  → reads data/license.json → finds licFilePath = "data/license.lic"
  → reads data/license.lic → verifies RSA-SHA256 signature
  → verifies payload.expiresAt > now
  → verifies payload.machineId === getMachineId()
  → PASS → continues

Step 2 — Machine fingerprint check:
  checkMachineBinding()
  → loads stored.machineId from license.json (decrypted)
  → computes getMachineId() from current hardware
  → compares → MATCH → continues

Step 3 — Seat rehydration:
  sessionStore.all() → lists all active sessions in SQLite
  → builds list of active userIds
  → syncSeatsFromSessions(activeUserIds) → rebuilds in-memory seat map

Step 4 — Server ready
  → logger.info('[server] QA Agent Platform listening on port 3003')
```

---

### 8.2 Machine Mismatch — Server Refuses to Start

**Trigger:** License was activated on Machine A, then `data/` folder was copied to Machine B.

```
Step 2 — Machine fingerprint check:
  stored.machineId = "a3f7b2c1d9e4f2b8..."  (Machine A)
  getMachineId()   = "9b8c7d6e5f4a3b2c..."  (Machine B)
  → MISMATCH

Console output:
═══════════════════════════════════════════════════════
LICENSE ERROR: Machine fingerprint mismatch detected.
  Bound machine:   a3f7b2c1d9e4f2b8...
  Current machine: 9b8c7d6e5f4a3b2c...
This license is registered to a different machine.
Options:
  1. Use Admin → License → Transfer License to re-bind.
  2. Set QA_SKIP_MACHINE_CHECK=1 for Docker/CI environments.
═══════════════════════════════════════════════════════

Process exits with code 1.
```

**Resolution options:**
- Option A: Transfer the license (§8.3) — re-bind to new machine
- Option B: Use `QA_SKIP_MACHINE_CHECK=1` env var (CI/CD only — §8.4)

---

### 8.3 Transfer License

**Use case:** Hardware replaced, VM migrated, hostname or NIC changed

**Pre-condition:** Server CAN start (machine check is the blocker). This is done via:
- Option A: Set `QA_SKIP_MACHINE_CHECK=1` temporarily → start → go to Admin → License → Transfer
- Option B: Use the transfer API directly: `curl -X POST http://localhost:3003/api/admin/license/transfer`

**Admin UI flow:**
```
1. Set QA_SKIP_MACHINE_CHECK=1, restart server
2. Log in as admin
3. Admin tab → License sub-tab
4. Machine Binding block shows: [Mismatch ⚠]
5. Click "Transfer to this machine"
6. Confirm prompt
7. Server:
   - Calls transferLicense()
   - loadStoredLicense() → gets current key/payload
   - storeLicense(key, payload) → recomputes getMachineId() → overwrites encMachineId
   - clearLicenseCache() → forces re-load
   - logAudit() → LICENSE_TRANSFERRED event
8. Machine binding block now shows: [Bound ✓] with new Machine ID
9. Remove QA_SKIP_MACHINE_CHECK=1, restart server normally
```

**Note for Team/Enterprise (.lic users):**
Transfer re-binds the in-memory/json record, but the `.lic` file still has the OLD machineId signed in. On next startup, `checkStoredLicFile()` will fail because the .lic payload's machineId no longer matches.

**Full transfer process for .lic:**
1. Get the new Machine ID (Admin → License before deactivating)
2. Contact vendor with new Machine ID
3. Vendor issues new `.lic` signed with new Machine ID
4. Upload new `.lic` via Admin → License → Upload .lic File
5. This overwrites `data/license.lic` — now correctly signed for new machine

---

### 8.4 CI/CD / Docker Mode

**Use case:** Automated pipeline where MAC address changes per container run

```bash
# Set env var BEFORE starting server:
export QA_SKIP_MACHINE_CHECK=1

# Or in Docker:
ENV QA_SKIP_MACHINE_CHECK=1

# Or in docker-compose:
environment:
  - QA_SKIP_MACHINE_CHECK=1
```

**What changes:**
- Machine fingerprint check is skipped at startup
- Server logs: `[license] Machine check bypassed (QA_SKIP_MACHINE_CHECK=1) — CI/Docker mode`
- All other enforcement (expiry, seats, feature gates, RSA .lic validation) still applies
- Trial (EVAL) and Starter (HMAC) keys recommended for CI — do not use production ENT .lic

---

## 9. Expiry Flows

### 9.1 14-Day Warning Banner

**Trigger:** `daysLeft <= 14` in `GET /api/admin/license` response

**Who sees it:** Admin users only (checked via role in app.js IIFE)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚠️ License expires in 12 days — contact your vendor to renew.       │
└─────────────────────────────────────────────────────────────────────┘
```

**Style:** Amber banner above all content  
**Platform state:** Fully functional — no restrictions

---

### 9.2 7-Day Grace Period Banner

**Trigger:** License month has ended but `expiresAt` hasn't yet (grace period = 7 days after month end)

**Banner still amber/red; platform still fully functional during grace period.**

```
expiresAt = 2026-12-31 + 7 days = 2027-01-07T23:59:59Z
If today = 2027-01-03 → daysLeft = 4 → banner: "expires in 4 days"
```

---

### 9.3 License Expiry — Read-Only Mode

**Trigger:** `new Date(payload.expiresAt) < new Date()`

**Detected by:**
1. Every request: `getLicensePayload()` re-checks expiry against wall clock (not just at startup)
2. Every hour: `checkExpiryTick()` background interval catches expiry if no requests are made

**What changes:**
- `getLicensePayload()` returns `null`
- All `requireFeature()` middleware calls return HTTP 402
- CSS class `body.lic-readonly` applied to page
- Run, Record, Save buttons visually disabled via CSS
- Banner:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🔴 Your QA Agent Platform license has expired. Contact your         │
│    vendor to renew.                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**What users CAN still do:**
- View test scripts, suites, history, reports
- Export reports

**What users CANNOT do:**
- Run suites
- Record
- Save / edit scripts
- Use scheduler

**Server log on expiry detection:**
```
[license] License has expired. Platform entering read-only mode.
[audit] LICENSE_EXPIRED event logged
```

---

### 9.4 License Renewal

**Customer flow:**
```
1. Contact vendor before expiry (or during grace period)
2. Vendor issues new license:
   - HMAC: new key with updated expiry month
   - .lic: new signed file with updated expiresAt field
3. Customer activates:
   - HMAC: Admin → License → paste new key → Activate
   - .lic: Admin → License → Upload .lic File (overwrites data/license.lic)
4. Platform immediately exits read-only mode
5. No server restart required
```

---

## 10. Trial / Evaluation Flow

### 10.1 Auto-Trial (Built-in — No Key Required)

**Trigger:** Server starts and finds no `data/license.json`

**This is the default experience on every fresh install.**

```
Day 0 — Customer installs platform (no key, no vendor contact needed)

Server startup console:
═══════════════════════════════════════════════════════
[license] No license found — auto-trial activated (14 days).
[license] Trial expires: 2026-05-03
[license] Features: recorder, debugger, scheduler, apiAccess (3 seats, 3 projects)
[license] Go to Admin → License to activate your license key.
═══════════════════════════════════════════════════════

Day 0 — Admin logs in normally (seat check skipped — auto-trial active):
  → Orange banner at top of every page:
    "🟠 Free Trial — 14 days remaining. Activate your license key →"
  → Admin → License shows [TRIAL (AUTO)] badge + activate form visible

Days 1–14 — Full evaluation, all features available:
  ✓ Recorder, Debugger, Scheduler, API Access all enabled
  ✓ Up to 3 concurrent users
  ✓ Up to 3 projects
  ✗ SSO, White-label disabled
  → No machine binding — reinstall/re-image freely

Day 11 — 3 days remaining → banner turns red:
    "🔴 Free Trial — 3 days remaining. Activate your license key →"

Day 14 — Trial expires:
  → getLicensePayload() returns null → read-only mode
  → Red banner: "Your QA Agent Platform license has expired."
  → Admin goes to Admin → License → activates real key → instantly exits read-only

Customer contacts vendor at any time → vendor issues key/lic → customer activates
```

**Admin → License panel during auto-trial:**
```
┌──────────────────────────────────────────────────────┐
│ 🟠 14 days left on your free trial.                  │
│    Enter a license key below to activate.            │
│                                                      │
│ [TRIAL (AUTO)]  Trial  |  Expires 2026-05-03         │
│ 3 seats  |  3 projects max                           │
│                                                      │
│ Features: [Recorder] [Debugger] [Scheduler] [API]    │
│                                                      │
│ ── Activate License ──────────────────────────────── │
│ Starter Key:  [________________________] [Activate]  │
│ Enterprise:   [Upload .lic File]                     │
└──────────────────────────────────────────────────────┘
```

**What happens server-side when auto-trial activates:**
1. `getLicensePayload()` returns null → `activateAutoTrial()` called
2. `LicensePayload` built with tier=`trial`, orgId=`AUTO-TRIAL`, 14-day expiry
3. `storeLicense('AUTO-TRIAL', payload)` → writes encrypted `data/license.json`
4. `refreshLicenseCache(payload)` → takes effect immediately in-process
5. `logAudit()` records `LICENSE_TRIAL_STARTED` event
6. On subsequent restarts: `license.json` exists → auto-trial NOT re-triggered

**Important:** Auto-trial activates ONCE. Deleting `data/license.json` manually restarts the trial clock — the system cannot distinguish a genuine fresh install from a manual delete.

---

### 10.2 Vendor-Issued Trial Key (EVAL)

**When to use:** Customer needs > 14 days to evaluate, or needs > 3 seats during evaluation.

**Who:** Vendor sales / support — customer does not need to provide Machine ID.

```bash
# Calculate expiry = today + 30 days
$expiry = (Get-Date).AddDays(30).ToString("yyyyMM")

npx tsx tools/genLicense.ts \
  --tier EVAL \
  --org TRIAL \
  --seats 5 \
  --instances 1 \
  --expiry $expiry

# Output:
# Key: QAP-EVAL-TRIAL-202506-005-001-3F9A
# Tier: trial | Seats: 5 | No machine binding | Expires: end of month
```

**Send to customer:** Key string via email. Customer activates via Admin → License (same as Starter).

**When customer activates EVAL key over an existing auto-trial:**
- `storeLicense('QAP-EVAL-...', payload)` overwrites `data/license.json`
- Auto-trial is replaced by vendor trial immediately
- No restart required

**Complete journey with EVAL key:**
```
Days 1–30 — Full evaluation with 5 seats:
  ✓ Recorder, Debugger, Scheduler all enabled
  ✓ Up to 5 concurrent users
  ✓ Unlimited projects
  ✗ SSO, API Access, White-label disabled

Day 25 — Banner:
  "📋 Trial License — expires in 5 days. Purchase a license →"

Day 30 — Expires → read-only → customer activates real license
```

---

## 11. Active Session Dashboard (Admin)

**Location:** Admin tab → License sub-tab → Active Sessions section

**What it shows:**
```
Active Sessions — 3 of 10 seats                         [Refresh]
█████░░░░░░░░░░░░░░░  30%

User     Role    Logged in  Last active  IP           Action
john     admin   09:14:22   09:47:05     10.0.0.4     (you)
mary     tester  09:20:11   09:46:58     10.0.0.5     [Revoke]
bob      tester  09:35:44   09:45:12     10.0.0.8     [Revoke]
```

**Seat progress bar color:**
- Green: < 80% seats used
- Amber: ≥ 80% seats used
- Red: ≥ 90% seats used

**Revoke (force-logout):**
```
1. Click Revoke next to a user
2. Confirm: "Force-logout mary? Their current work may be lost."
3. Server: DELETE /api/admin/license/sessions/:sessionId
4. Session destroyed in SQLite
5. Dashboard refreshes → seat freed
6. User gets redirected to /login if they make any request
```

**Survival across restarts:**
- Sessions stored in `data/sessions.sqlite` (connect-sqlite3)
- On restart: `syncSeatsFromSessions()` reads active SQLite sessions → rebuilds seat map
- Seat count does NOT reset to 0 on restart

---

## 12. License Audit Log

**Location:** Admin tab → License sub-tab → License Audit Log (collapsible)

**Events logged:**

| Event | Trigger |
|-------|---------|
| `LICENSE_ACTIVATED` | Key or .lic file successfully activated |
| `LICENSE_DEACTIVATED` | Admin clicks Deactivate License |
| `LICENSE_TRANSFERRED` | Admin transfers license to new machine |
| `LICENSE_EXPIRED` | Expiry detected by request check or hourly tick |

**Each event records:**
- Timestamp
- Action
- Username (who performed the action)
- IP address
- Details (tier, orgId, machineId hint)

**Used for:**
- SOC2 / ISO27001 compliance audits
- Troubleshooting: "when was this license activated?"
- Vendor support: customer can share screenshot of audit log

---

## 13. Seat Audit Report Export

**Location:** Admin tab → License sub-tab → [Export Seat Report] button

**Format:** CSV file — `seat-report-2026-04-17.csv`

**Columns:**
```
Username, Email, Role, Active, Last Login, Login Count, Seat Used
john,     john@acme.com, admin,  Yes, 4/17/2026 09:14, 47, Yes
mary,     mary@acme.com, tester, Yes, 4/17/2026 09:20, 23, Yes
carol,    carol@acme.com,tester, Yes, 4/16/2026 17:45, 12, No
dave,     dave@acme.com, tester, No,  Never,            0,  No
```

**Use cases:**
- Vendor compliance check (vendor can request; customer chooses to share)
- Customer internal audit: "who is using what, and how many licenses do we need?"
- Optimization: identify inactive users who consume seats

---

## 14. White-Label Flow (Enterprise)

**Who:** Enterprise customers with white-label feature enabled in their `.lic`

**What changes at page load:**
```
/api/branding returns:
{
  "appName": "TestPilot Pro",
  "logoUrl": "https://cdn.oemco.com/testpilot-logo.png",
  "primaryColor": "#7c3aed"
}

app.js applies:
→ document.title = "TestPilot Pro"
→ <h1 id="nav-app-name"> = "TestPilot Pro"
→ <img> prepended to nav bar with logo
→ CSS variable --primary set to #7c3aed (purple)
   → buttons, badges, highlights all update automatically
```

**Testing:**
1. Generate Enterprise `.lic` with `--wl-appname`, `--wl-logourl`, `--wl-color`
2. Activate on customer machine
3. Hard-refresh browser (Ctrl+Shift+R)
4. Verify: browser tab shows custom name, nav bar shows logo + custom name, accent color changed

---

## 15. System-Level Tamper Protection

The following table explains what happens if a customer attempts each known attack vector:

| Attack | Detection | Result |
|--------|-----------|--------|
| **Edit `data/license.json` to extend expiry** | AES-256-GCM decryption fails — ciphertext invalid | `loadStoredLicense()` returns null → read-only mode |
| **Copy `license.json` from Machine A to Machine B** | `getMachineId()` mismatch vs stored `encMachineId` | Server refuses to start (exit code 1) |
| **Copy `license.lic` from Machine A to Machine B** | RSA-signed `payload.machineId` ≠ Machine B's fingerprint | `.lic` validation returns null → activation rejected |
| **Tamper with `license.lic` payload** | RSA-SHA256 signature verification fails | `.lic` validation returns null |
| **Use same HMAC key on second machine** | Machine fingerprint bound on first activation | Second machine has different machineId stored → mismatch on startup |
| **Stop server clock to avoid expiry** | `new Date()` is called at every `getLicensePayload()` invocation | If system time is manipulated, expiry detection still fires eventually |
| **Replace bundled vendor public key** | Requires rebuilding the application binary | Not feasible without source code access |

---

## 16. Environment Variables Reference

| Variable | Purpose | Default | Override When |
|----------|---------|---------|---------------|
| `QA_VENDOR_SECRET` | HMAC secret for Starter/EVAL key validation | `qa-agent-platform-vendor-secret-v1` | **Always in production** |
| `QA_SECRET_KEY` | AES-256-GCM key for `license.json` encryption | `qa-agent-default-enc-key-32chars!` | **Always in production** |
| `QA_LICENSE_PUBLIC_KEY_B64` | RSA public key override (base64) | Embedded in binary (PLACEHOLDER until set) | Production build |
| `QA_SKIP_MACHINE_CHECK` | `1` = bypass machine fingerprint check | `0` | CI/CD, Docker containers |
| `SESSION_SECRET` | Express session signing secret | `qa-agent-platform-secret-key-2026` | **Always in production** |
| `PORT` | HTTP listen port | `3003` | Multi-instance / custom port |

**Critical rule:** Never use default values in production. If `QA_SECRET_KEY` is left as default, anyone who reads the source code can decrypt `data/license.json`.

---

## 17. Testing Checklist — Vendor

### RSA Key Generation
- [ ] Run `npx tsx tools/genVendorKeys.ts` — two PEM files created
- [ ] `vendor-private.pem` has mode 600 (restricted permissions)
- [ ] Base64 of public key printed to console — can be embedded in app
- [ ] Run again → generates new unique keys (not deterministic)

### HMAC Key Generation (Starter/Trial)
- [ ] Generate Starter key — checksum passes when copied into License panel
- [ ] Generate EVAL key with `--expiry` > 30 days from today → error thrown
- [ ] Generate EVAL key with `--expiry` within 30 days → succeeds
- [ ] Try to generate TEAM key (should succeed — TEAM keys are blocked at activation, not generation)

### .lic File Generation (Team/Enterprise)
- [ ] Generate with `--machineid` → machineId appears in .lic JSON payload
- [ ] Generate without `--machineid` → WARN printed but still succeeds
- [ ] Generate with `--wl-appname` + `--tier ENT` → whiteLabelConfig in payload
- [ ] Generate with `--wl-appname` + `--tier TEAM` → whiteLabelConfig NOT in payload (ENT only)
- [ ] Verify RSA signature manually:
  ```bash
  # Extract body from .lic and verify against public key
  node -e "
  const fs = require('fs'), crypto = require('crypto');
  const lic = JSON.parse(fs.readFileSync('acme001.lic'));
  const body = JSON.stringify({payload: lic.payload, issuedAt: lic.issuedAt});
  const v = crypto.createVerify('RSA-SHA256');
  v.update(body);
  console.log('Valid:', v.verify(fs.readFileSync('vendor-public.pem'), lic.signature, 'hex'));
  "
  ```

---

## 18. Testing Checklist — Customer Admin

### Auto-Trial (Fresh Install)
- [ ] Delete `data/license.json` if exists → restart server → console shows auto-trial message
- [ ] `data/license.json` created automatically with `key = AUTO-TRIAL`
- [ ] Admin logs in successfully (seat check skipped)
- [ ] Orange banner visible on all pages: "Free Trial — 14 days remaining"
- [ ] Admin → License shows `[TRIAL (AUTO)]` badge + activate form visible
- [ ] All features accessible: recorder, debugger, scheduler, API keys
- [ ] SSO and white-label not accessible (blocked by tier)
- [ ] Create 3 projects → all succeed
- [ ] Create 4th project → upgrade CTA (maxProjects = 3)
- [ ] 3 concurrent logins → all succeed; 4th login → seat limit error
- [ ] Activate a real license key over auto-trial → auto-trial replaced immediately
- [ ] Restart server with `license.json` present → auto-trial NOT re-triggered
- [ ] Set system clock to day 15 → trial expired → read-only mode → activate real key → exits read-only
- [ ] Trial expiry logged as `LICENSE_EXPIRED` in audit log
- [ ] `GET /api/admin/license` returns `isAutoTrial: true`, `trialDaysLeft: N`

### Activation
- [ ] Copy Machine ID before any license — full 32-char hex displayed
- [ ] "Copy Machine ID" button copies to clipboard
- [ ] Activate Starter HMAC key → success, tier badge shows `STARTER`
- [ ] Activate TEAM HMAC key → rejected with "requires .lic file" message
- [ ] Activate .lic with matching Machine ID → success, tier badge shows `TEAM`
- [ ] Activate .lic with wrong Machine ID → rejected with "machine-mismatched" error
- [ ] Activate expired .lic → rejected with "expired" error

### Machine Binding
- [ ] Activate license → restart server → starts successfully (machineId matches)
- [ ] Copy `data/license.json` to another machine → server refuses to start (mismatch error)
- [ ] Set `QA_SKIP_MACHINE_CHECK=1` → server starts despite mismatch, log warning shown
- [ ] Transfer license (Admin UI) → machineId in license.json updated → server starts normally

### Expiry
- [ ] Generate key expiring this month → activate → amber banner appears within 14 days
- [ ] Manually set system clock past expiry → next API request returns read-only behavior
- [ ] Restore clock → license valid again (no restart needed)

### Seat Management
- [ ] Log in with N users where N = seat limit → all succeed
- [ ] Log in with N+1th user → HTTP 403 seat limit error on login page
- [ ] Revoke a session in Admin → seat freed → N+1th user can now log in
- [ ] Restart server → seat count matches pre-restart count (SQLite rehydration)

### Admin Panel
- [ ] Active Sessions table shows all logged-in users with correct columns
- [ ] Progress bar is green/amber/red based on seat usage
- [ ] Export Seat Report → CSV downloads with all users listed
- [ ] License Audit Log expands → shows activation event with timestamp

---

## 19. Testing Checklist — End User

### Feature Gate Enforcement
- [ ] Starter user: create 1 project → success
- [ ] Starter user: create 2nd project → upgrade CTA modal shown
- [ ] Starter user: access Scheduler → upgrade CTA modal shown
- [ ] Team user: access Scheduler → works
- [ ] Team user: access API Access feature → upgrade CTA modal for Enterprise
- [ ] Enterprise user: all features work

### Session Behavior
- [ ] Log in → seat occupied → visible in Admin dashboard
- [ ] Log out → seat freed → count decrements in Admin dashboard
- [ ] Idle for sessionTimeoutMinutes → auto-logged out → redirected to /login?reason=expired
- [ ] Open same account in 2 tabs → both work → only 1 seat consumed

### Read-Only Mode (expired license)
- [ ] Run button visually disabled (CSS `body.lic-readonly`)
- [ ] Record button visually disabled
- [ ] Save button visually disabled
- [ ] Viewing scripts, suites, history → still works
- [ ] Red expiry banner shown at top of page

### White-Label (Enterprise)
- [ ] Browser tab title shows custom app name
- [ ] Nav bar heading shows custom app name
- [ ] Logo appears in nav bar (if logoUrl set)
- [ ] Primary accent color changed (buttons, chips, badges)

---

## 20. Feature Override Add-ons (Phase 4)

Feature overrides allow vendors to grant or revoke individual features independent of the customer's
tier — without issuing a different tier key. Overrides are embedded in the RSA-signed `.lic` payload
and therefore tamper-proof.

### 20.1 Concepts

| Term | Meaning |
|------|---------|
| **Granted override** | Feature enabled above what tier provides (e.g., Scheduler on Starter) |
| **Revoked override** | Feature disabled below what tier provides (e.g., SSO removed from Team) |
| **Effective feature** | `featureOverrides[key]` if present, else `features[key]` (tier default) |
| **Add-on** | Commercially sold override — customer pays for a single feature without upgrading tier |
| **Restriction** | Compliance-driven revoke — e.g., remove Recorder in regulated environments |

### 20.2 Vendor Flow — Issue a .lic with Feature Add-on

**Scenario:** Customer on Starter tier wants Scheduler only, without upgrading to Team.

```bash
# Step 1: Get customer machine ID (from Admin → License → Machine ID)
#   Customer sends: a3f7b2c1d9e4f2b8c3d4e5f6a7b8c9d0

# Step 2: Generate .lic with Scheduler add-on
npx tsx tools/genLicense.ts \
  --tier STR \
  --org ACME001 \
  --orgname "Acme Corp" \
  --seats 5 \
  --instances 1 \
  --expiry 202612 \
  --machineid a3f7b2c1d9e4f2b8c3d4e5f6a7b8c9d0 \
  --lic --privkey ./keys/vendor-private.pem \
  --out acme001-starter-plus-scheduler.lic \
  --enable scheduler

# Console output:
# Key:        QAP-STR-ACME001-202612-005-001-7B2E
# Tier:       starter
# Org:        Acme Corp (ACME001)
# Seats:      5
# Expires:    2026-12-31 (end of Dec 2026 + 7 day grace)
# Features:   recorder, debugger          ← tier default
# Machine ID: a3f7b2c1d9e4f2b8c3d4e5f6a7b8c9d0 (bound)
# Overrides:  +[scheduler]  (vendor-signed, tier-independent)
# .lic file written: acme001-starter-plus-scheduler.lic

# Step 3: Email acme001-starter-plus-scheduler.lic to customer
```

### 20.3 Vendor Flow — Issue a .lic with Feature Restriction

**Scenario:** Team customer in regulated environment — SSO must be disabled (compliance requirement).

```bash
npx tsx tools/genLicense.ts \
  --tier TEAM \
  --org CORP001 \
  --orgname "Corp Industries" \
  --seats 10 \
  --instances 1 \
  --expiry 202612 \
  --machineid b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4 \
  --lic --privkey ./keys/vendor-private.pem \
  --out corp001-team-nosso.lic \
  --disable sso

# Console output:
# Overrides:  -[sso]  (vendor-signed, tier-independent)
```

### 20.4 Vendor Flow — Multiple Overrides (Grant + Revoke)

```bash
# Grant API Access to Team customer, revoke White-label from Enterprise customer
npx tsx tools/genLicense.ts \
  --tier TEAM --org PARTNER01 --seats 25 --expiry 202612 \
  --lic --privkey ./keys/vendor-private.pem \
  --enable apiAccess --disable recorder

# --enable and --disable accept comma-separated keys
npx tsx tools/genLicense.ts \
  --tier STR --org STARTUP1 --seats 3 --expiry 202606 \
  --lic --privkey ./keys/vendor-private.pem \
  --enable scheduler,sso
```

### 20.5 Customer Admin Flow — Activate Override .lic

Same as any `.lic` upload — the customer does NOT need to know there are overrides embedded.

```
1. Admin → License → Machine ID → Copy → send to vendor
2. Receive .lic file from vendor (email / secure download)
3. Admin → License → Upload .lic File → select file → Upload
4. Activation validates RSA signature (covers featureOverrides in payload)
5. License panel shows updated feature list:
   - Granted add-ons: chip with "+" superscript in accent colour
   - Revoked features: shown below with strikethrough styling
```

### 20.6 What the Customer Admin Sees

**Starter + Scheduler add-on:**
```
Features enabled:
  [Recorder]  [Debugger]  [Scheduler +]   ← "+" = vendor add-on
```

**Team with SSO revoked:**
```
Features enabled:
  [Recorder]  [Debugger]  [Scheduler]

Revoked by vendor:  [~~SSO~~]             ← strikethrough chip
```

### 20.7 Error Cases

| Scenario | Error |
|----------|-------|
| `--enable scheduler` without `--lic` | `ERROR: --enable/--disable require --lic mode` |
| `--enable unknownfeature` | `ERROR: Unknown feature key "unknownfeature"` |
| Customer uploads tampered .lic (edited featureOverrides) | RSA verification fails → `Invalid .lic file` |
| Starter HMAC key: no overrides possible | Overrides only in RSA-signed .lic; HMAC keys carry no overrides |

### 20.8 Testing Checklist — Feature Overrides

**Vendor (genLicense.ts):**
- [ ] `--enable scheduler` generates .lic with `featureOverrides: { scheduler: true }` in payload
- [ ] `--disable sso` generates .lic with `featureOverrides: { sso: false }` in payload
- [ ] `--enable unknownkey` exits with error
- [ ] `--enable scheduler` without `--lic` exits with error
- [ ] Overrides printed in console output summary

**Customer Admin:**
- [ ] Upload Starter + Scheduler .lic → Scheduler chip shows with "+" superscript
- [ ] Upload Team − SSO .lic → SSO appears in revoked row (strikethrough)
- [ ] `GET /api/admin/license` response contains `featureOverrides: { scheduler: true }`
- [ ] Scheduler feature gate passes for Starter + add-on (`isFeatureEnabled('scheduler') = true`)
- [ ] SSO feature gate blocks for Team − SSO (`isFeatureEnabled('sso') = false`)

**Tamper protection:**
- [ ] Manually edit .lic file (change featureOverrides JSON) → upload → rejected (RSA fail)
- [ ] Copy .lic from override machine to different machine → rejected (machineId mismatch)
