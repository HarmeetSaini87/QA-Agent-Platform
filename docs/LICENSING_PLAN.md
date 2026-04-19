# QA Agent Platform — Commercial Licensing Plan
# Status: PHASE 1 ✅ | PHASE 1-EG ✅ | PHASE 2 ✅ | PHASE 3 ✅ | PHASE 4 ✅ — ALL COMPLETE
# Created: 2026-04-11
# Last Updated: 2026-04-18

---

## Market Benchmark — How Similar Products Manage Licensing

This plan is modelled after enterprise QA platforms. Key patterns observed:

| Product | Model | Machine Binding | Offline? | Trial |
|---------|-------|-----------------|----------|-------|
| **Katalon Studio** | Named-user + Floating server | Node-locked OR network pool | Grace 3 days | 30-day |
| **TestComplete (SmartBear)** | Named + Floating | Named = machine-tied; Floating = LAN server | License server can be air-gapped | 30-day |
| **Ranorex** | Named + Floating | Machine certificate (.lic) | Yes — .lic file | 30-day |
| **Micro Focus UFT** | Named + Concurrent | SafeNet HASP (hardware or software) | Yes — software dongle | 60-day |
| **Tricentis Tosca** | Named + Concurrent | License Service | On-premise server | 14-day |
| **mabl** | SaaS per-seat | Cloud only — no binding | No | Free tier |

### What this means for our plan

**Gap 1 — Trial/Evaluation Tier:** Every competitor offers a 30-day trial. Without one, enterprise evaluators
can't assess the product before purchasing. Add `EVAL` tier: full features, 30-day auto-expiry, no machine binding.

**Gap 2 — Floating vs Named-User clarity:** Our `seats` = max concurrent sessions (= floating model).
This is actually better for customers (Katalon charges extra for floating). Document this clearly in UI.

**Gap 3 — Upgrade CTA in UI:** When a feature is locked, show "Upgrade to Team/Enterprise →" tooltip.
Katalon, Ranorex all do this. Currently our locked features silently return 403.

**Gap 4 — CI/CD / Headless Deployment policy:** Enterprise CI pipelines (Jenkins, Azure DevOps, GitHub Actions)
need a documented way to run without machine binding. `QA_SKIP_MACHINE_CHECK=1` is undocumented.
Add `CI/CD Mode` section to deployment guide. TestComplete and Katalon both have explicit CI tier docs.

**Gap 5 — License Audit Log:** SOC2/ISO27001 audits require a log of: who activated, when, which machine,
who transferred, who deactivated. Katalon and UFT provide this. Currently we log nothing about license events.

**Gap 6 — Volume SKUs / Pre-packaged tiers:** Standard bundles (5/10/25/50/unlimited seats).
Customers expect to buy a "10-seat Team license" not negotiate seat counts. Define our SKU packages.

**Gap 7 — Perpetual + SMA option:** Many enterprise buyers (gov, regulated industries) need perpetual licenses
(pay once, no subscription). Ranorex, UFT, TestComplete all offer perpetual + annual SMA for updates.
Our key format already supports non-expiring via HMAC (e.g., expiry=209912), but we need a policy.

### What we do better than most competitors

- **Fully air-gapped** — zero network required (Katalon needs internet for activation; we don't in P3)
- **Concurrent/floating built-in** — no extra license server product to install
- **RSA offline .lic** — more tamper-proof than HMAC keys (Phase 3 target)
- **AES-256-GCM storage** — license.json tamper detection (most competitors store plaintext)

---

## Overview

Before the platform goes commercial, a licensing layer must be added to control:
- **Who** can use the product (org identity, seat count)
- **What** they can access (feature gating per tier)
- **How long** their access is valid (expiry enforcement)
- **Where** the product runs (on-premise vs SaaS/cloud)
- **How many machines** can run a single license (instance binding)

Three tiers are planned: **Starter**, **Team**, **Enterprise**.
Enforcement model: **per-seat + per-instance + annual/monthly period** — consistent with Katalon, Tricentis, mabl.

---

## Enterprise Machine Binding — Problem Statement

Without machine binding, a single license key can be exploited in multiple ways:

| Attack | Description | Risk |
|--------|-------------|------|
| **Copy-paste** | Customer copies `data/license.json` from Machine A to Machine B | Critical |
| **Re-activation** | Customer activates the same key on N machines independently | Critical |
| **Shared key** | Customer shares the key string with other teams/orgs | High |
| **Clone farm** | Docker/VM clone of full installation including `data/` folder | High |

**Solution: 3-layer machine protection**

```
Layer 1 — Machine Fingerprint Binding (P1-EG, implemented on-premise)
  → machineId = SHA-256(MAC + hostname + CPU + OS platform)
  → stored in license.json on activation
  → verified on every server startup — mismatch = refuse to start

Layer 2 — Activation Registry (Phase 3 license server)
  → server tracks machineId per key (activation slots)
  → maxInstances field in key controls how many machines can activate
  → new machine must call /v1/activate — rejected if slots full
  → vendor can revoke individual machineIds remotely

Layer 3 — Periodic Phone-Home Heartbeat (Phase 3 license server)
  → every 24h: POST /v1/heartbeat { key, machineId }
  → server confirms: key valid, not revoked, machineId still registered
  → 72h no heartbeat → warning banner
  → 7 days no heartbeat → read-only mode
  → vendor can remotely invalidate by not responding to heartbeat
```

---

## License Key Format (Updated)

```
QAP-{TIER}-{ORG_ID}-{EXPIRY_YYYYMM}-{SEATS}-{INSTANCES}-{CHECKSUM}

Example:
QAP-TEAM-ACME001-202612-010-001-A3F7

Fields:
  TIER       STR | TEAM | ENT | EVAL
  ORG_ID     3–8 char alphanumeric org identifier (assigned at purchase; TRIAL for eval)
  EXPIRY     YYYYMM — grace period: 7 days after this month ends; 999912 = perpetual
  SEATS      Zero-padded count (001–998); 999 = unlimited (Enterprise)
  INSTANCES  Zero-padded machine count (001–099); 999 = unlimited (Enterprise)
  CHECKSUM   First 4 chars of HMAC-SHA256(key_body, VENDOR_SECRET)

Typical values:
  EVAL → tier=EVAL, org=TRIAL, seats=005, instances=001  — 30-day trial, no machine binding
  STR  → seats=003, instances=001  (1 server, 3 users)
  TEAM → seats=010, instances=001  (1 server, 10 users) — standard on-premise
  TEAM → seats=010, instances=003  (3 servers, 10 users each) — HA cluster
  ENT  → seats=999, instances=999  (unlimited)
  ENT  → expiry=999912 (perpetual + SMA)
```

### Trial Key Generation

```bash
# Generate 30-day trial key (auto-expires, no machine binding)
npx tsx tools/genLicense.ts --tier EVAL --org TRIAL --seats 5 --instances 1 \
  --expiry $(date +%Y%m -d "+30 days")

# Output: QAP-EVAL-TRIAL-202507-005-001-XXXX
# EVAL tier: skips machine binding check on activation
```

---

## Machine ID Computation

```
machineId = SHA-256(
  primaryMAC      // first non-loopback MAC address
  + hostname      // os.hostname()
  + cpuModel      // os.cpus()[0].model
  + osPlatform    // os.platform()
  + osArch        // os.arch()
).hex().slice(0, 32)

Stored in: data/license.json → encMachineId field (encrypted)
Computed:  on activation + on every server startup
```

**Tolerance:** If a VM migrates (MAC changes) or NIC is replaced:
- Admin must re-activate the license (consumes 1 activation slot on license server)
- Vendor can grant a free re-activation via the license portal

---

## Feature Gate Map (per tier)

| Feature                  | Trial (EVAL) | Starter | Team    | Enterprise |
|--------------------------|--------------|---------|---------|------------|
| **Duration**             | 30-day auto  | Annual  | Annual  | Annual / Perpetual+SMA |
| **Machine binding**      | None         | ✓       | ✓       | ✓ (RSA .lic) |
| Max Projects             | ∞            | 1       | ∞       | ∞          |
| Max Concurrent Sessions  | 5            | 3       | Paid    | ∞          |
| Max Server Instances     | 1            | 1       | 1       | ∞          |
| Test Script Builder      | ✓            | ✓       | ✓       | ✓          |
| Recorder                 | ✓            | ✓       | ✓       | ✓          |
| Debugger                 | ✓            | ✓       | ✓       | ✓          |
| Common Functions         | ✓            | ✓       | ✓       | ✓          |
| Common Data              | ✓            | ✓       | ✓       | ✓          |
| Scheduler                | ✓            | ✗       | ✓       | ✓          |
| SSO (SAML/LDAP)          | ✗            | ✗       | ✓       | ✓          |
| API Access               | ✗            | ✗       | ✗       | ✓          |
| White-label              | ✗            | ✗       | ✗       | ✓          |
| Audit Trail Retention    | 7 days       | 30 days | 90 days | Unlimited  |
| License Audit Log        | ✗            | ✗       | ✓       | ✓          |
| Offline / Air-gapped     | ✗            | ✗       | ✗       | ✓ (RSA .lic) |
| Seat Audit Report (CSV)  | ✗            | ✗       | ✓       | ✓          |
| Upgrade CTA shown        | ✓            | ✓       | ✓       | ✗          |
| Support SLA              | None         | Community | 48h email | 4h dedicated |

### Volume SKUs (pre-packaged)

| SKU | Tier | Seats | Instances | Typical Use |
|-----|------|-------|-----------|-------------|
| STR-1 | Starter | 3 | 1 | Solo SDET / small team |
| TEAM-5 | Team | 5 | 1 | Small QA team |
| TEAM-10 | Team | 10 | 1 | Mid-size QA team |
| TEAM-25 | Team | 25 | 1 | Large team |
| TEAM-HA | Team | 10 | 3 | 3-server HA cluster |
| ENT-50 | Enterprise | 50 | 5 | Enterprise department |
| ENT-UNL | Enterprise | ∞ | ∞ | Enterprise site license |

### Licensing Model — Floating (Concurrent) Seats

Our seat model is **floating (concurrent)**, not named-user:
- A "10-seat license" = max 10 simultaneous logged-in users
- Any user can log in if a seat is free; seat auto-released on logout/session expiry
- This is the same model Katalon charges extra for — we include it at all paid tiers
- Show in UI: "N of M seats in use" — not a list of named users who "own" a seat

### Perpetual + SMA Option

For enterprise/government buyers requiring perpetual licenses:
- Expiry field `999912` = Dec 9999 (functionally perpetual)
- SMA (Software Maintenance Agreement): separate annual fee for updates + support
- Vendor policy: perpetual keys always use RSA `.lic` format (Phase 3)
- HMAC keys never issued as perpetual (VENDOR_SECRET rotation risk)

---

## Validation Modes

### Online (Starter + Team)
```
Server startup:
  1. Load license.json → decrypt → get stored machineId
  2. Recompute current machineId → compare → refuse if mismatch (Layer 1)
  3. POST https://license.qa-agent.io/v1/heartbeat { key, machineId, version }
     Response: { valid, features, expiresAt, orgName, seats }
  4. Cache response for 24h → graceful offline tolerance

Every 24h (background timer):
  → repeat heartbeat silently
  → update cache

After 72h offline  → warning banner (still functional)
After 7 days offline → read-only mode
```

### Offline / Air-gapped (Enterprise only)
```
License file: qa-agent-platform/license.lic
Format: JSON payload + RSA-2048 signature (vendor private key)
Server startup:
  1. Read + verify RSA signature → refuse if invalid
  2. Check expiresAt → refuse if expired
  3. Recompute machineId → compare vs payload.machineId → refuse if mismatch
No internet required — expiry and machine binding enforced locally
Customer receives .lic file from vendor after purchase (re-issued on machine transfer)
```

---

## Graceful Degradation Rules

| State                       | Behaviour                                                              |
|-----------------------------|------------------------------------------------------------------------|
| License valid               | Full access per tier                                                   |
| Within 14-day window        | Full access + amber banner: "License expires in N days — renew now"   |
| Within 7-day grace period   | Full access + red banner: "License expires in N days — renew now"     |
| License expired             | Read-only mode: view scripts/history/reports, no run/record/save      |
| Machine mismatch on startup | Server refuses to start; error logged; admin must re-activate         |
| License server unreachable  | Use 24h cache; after 72h: warning banner; after 7 days: read-only    |
| Seat limit reached          | Existing sessions unaffected; new logins blocked with clear message   |
| Instance limit reached      | Activation rejected at `POST /api/admin/license/activate`             |
| Invalid key / bad checksum  | Activation rejected; admin sees error in License panel                |
| Key revoked remotely        | Heartbeat returns `{ valid: false }` → read-only within 24h          |

---

## Pending Task List

---

### PHASE 1 — License Infrastructure ✅ COMPLETE
> **Goal:** Minimum viable licensing — enough to go commercial.
> Issue keys manually, validate locally or against a stub endpoint.

- [x] **P1-01** Create `src/utils/licenseManager.ts`
  - `parseLicenseKey(key)` — splits key into components, validates HMAC checksum
  - `validateLicenseKey(key)` — builds LicensePayload from parsed key (Phase 3: calls license server)
  - `validateLicFile(path, pubKey)` — verify RSA-2048 signature on `license.lic`
  - `getLicensePayload()` — returns current active `LicensePayload` (null if invalid/expired)
  - `isFeatureEnabled(feature)` — true/false per `LicensePayload.features`
  - `getSeatsUsed()` / `isSeatAvailable(userId)` — seat tracking

- [x] **P1-02** Create `LicensePayload` interface in `src/data/types.ts`

- [x] **P1-03** Create `tools/genLicense.ts` — vendor CLI to issue license keys
  - Inputs: tier, orgId, orgName, seats, expiryYYYYMM
  - Outputs: license key string + signed `license.lic` file (for Enterprise)

- [x] **P1-04** Add `requireFeature()` middleware to `src/ui/server.ts`
  - Applied to: `/api/recorder/*`, `/api/debug/*`, `/api/schedules/*`

- [x] **P1-05** Seat enforcement on `POST /api/auth/login`
  - Blocks new logins when `seatsUsed >= seats`

- [x] **P1-06** Encrypted license storage — `data/license.json` (AES-256-GCM)

- [x] **P1-07** Admin UI — License panel (Admin tab → License sub-tab)

- [x] **P1-08** `GET /api/admin/license` + `POST /api/admin/license/activate` + `DELETE /api/admin/license`

- [x] **P1-09** Expiry banner (amber ≤14 days / red = expired)

- [x] **P1-10** Read-only mode client enforcement (expired license disables Run/Record/Save)

---

### PHASE 1-EG — Enterprise Machine Protection (IMPLEMENT NEXT)
> **Goal:** Prevent a single license from running on multiple machines simultaneously.
> Implements Layer 1 of machine protection — no license server required.

- [x] **P1-EG-01** `getMachineId()` in `licenseManager.ts`
  - Compute: `SHA-256(primaryMAC + hostname + cpuModel + osPlatform + osArch).slice(0,32)`
  - Use Node.js `os` module — no external dependencies
  - Cache result for process lifetime (value is stable per machine)

- [x] **P1-EG-02** Updated key format — add `INSTANCES` field
  - New format: `QAP-{TIER}-{ORG_ID}-{EXPIRY}-{SEATS}-{INSTANCES}-{CHECKSUM}`
  - Update `parseLicenseKey()` — parse 7 parts instead of 6
  - Update `LicensePayload` — add `maxInstances: number` field
  - Update `tools/genLicense.ts` — add `--instances` flag (default 001)
  - **Backward compat:** accept old 6-part keys as `maxInstances = 1`

- [x] **P1-EG-03** Store machineId on activation
  - `storeLicense()` — compute + encrypt machineId → store in `license.json` as `encMachineId`
  - `loadStoredLicense()` — return `machineId` alongside key + payload

- [x] **P1-EG-04** Startup machine fingerprint check
  - On server start: load `license.json` → decrypt `encMachineId` → compare vs `getMachineId()`
  - If **mismatch**: log error + emit clear message + **refuse to start** (process.exit(1))
  - If **no license**: pass (dev mode)
  - Add admin override env var: `QA_SKIP_MACHINE_CHECK=1` (for Docker CI — documented, not secret)

- [x] **P1-EG-05** Transfer License — Admin UI
  - "Transfer to this machine" button in License panel (shown when machine mismatch detected)
  - `POST /api/admin/license/transfer` — re-activates with new machineId (calls license server in P3 to consume a transfer slot)
  - In P1-EG (pre-server): simply re-stores with new machineId (no slot tracking yet)

- [x] **P1-EG-06** Show machineId in Admin → License panel
  - Display: `Machine ID: a3f7b2c1...` (first 8 chars, rest masked)
  - Tooltip: "This is the hardware fingerprint bound to your license"
  - Status badge: `Bound ✓` (green) or `Mismatch ⚠` (red)

- [x] **P1-EG-07** Update `tools/genLicense.ts`
  - Add `--instances` flag (zero-padded, 001–999)
  - Default: `001` (single machine)
  - Display instances in output summary

---

### PHASE 2 — Seat Enforcement & Session Tracking (AFTER PHASE 1-EG)
> **Goal:** Accurate real-time seat counting and revocation.

- [x] **P2-01** Persistent session store (replace in-memory MemoryStore)
  - Use `connect-sqlite3` (already a dependency) for SQLite-backed sessions
  - Required for accurate seat counting across server restarts
  - Config: `src/ui/server.ts` session middleware

- [x] **P2-02** Active seat dashboard in Admin → License panel
  - Table: Username | Login Time | Last Activity | IP | Revoke button
  - `GET /api/admin/license/sessions` — returns active session list
  - `DELETE /api/admin/license/sessions/:sessionId` — force-logout a user (frees a seat)

- [x] **P2-03** Seat release on logout / timeout
  - Verify seat count updates correctly after session expiry with persistent store
  - Add seat count to `/api/admin/license` response

- [x] **P2-04** Admin notification when seat usage exceeds 80%
  - In-app banner to admin only: "8 of 10 seats in use — consider upgrading"

---

### PHASE 3 — RSA Offline License System (Pure On-Premise, Zero Internet)
> **Architectural constraint:** This product is installed on customer premises.
> The vendor has NO access to the customer's machine — ever.
> No heartbeat. No phone-home. No activation server calls.
> ALL validation happens locally using the vendor's RSA public key bundled in the app.
> Customer ↔ Vendor communication is manual and out-of-band (email / web form).

---

#### Why RSA (not HMAC keys)?

| | HMAC Keys (P1 current) | RSA .lic Files (P3 target) |
|---|---|---|
| Customer needs vendor secret? | **Yes** — VENDOR_SECRET must be on customer server | **No** — only public key needed |
| Can customer forge a license? | Yes, if they find VENDOR_SECRET | **Never** — private key never leaves vendor |
| Works fully offline? | Yes | **Yes** |
| Machine binding in signature? | No (stored separately) | **Yes — machineId signed into .lic** |
| Renewal process | New HMAC key issued | New .lic file issued |

**Phase 3 makes .lic the primary and only production license format.**
HMAC keys (P1) remain supported for dev/starter/evaluation only.

---

#### Customer Onboarding Flow (fully offline)

```
1. Customer installs platform
   Admin → License panel → "Copy Machine ID" button
   → copies: a3f7b2c1d9e4f2b8 (hardware fingerprint)

2. Customer contacts vendor (email / web form):
   "Please issue a license for:
    Machine ID: a3f7b2c1d9e4f2b8
    Tier: Team | Seats: 10 | Instances: 1
    Org: Acme Corp | Expiry: Dec 2026"

3. Vendor runs genLicense CLI on vendor machine:
   npx tsx tools/genLicense.ts \
     --tier TEAM --org ACME001 --orgname "Acme Corp" \
     --seats 10 --instances 1 --expiry 202612 \
     --machineid a3f7b2c1d9e4f2b8 \
     --lic --privkey ./vendor-private.pem --out acme001.lic

4. Vendor emails acme001.lic to customer

5. Customer: Admin → License → Upload .lic file
   App verifies locally:
     ✓ RSA-2048 signature valid (vendor's public key bundled in app)
     ✓ machineId in .lic matches current machine
     ✓ expiresAt not in the past
   → Activated. No internet call. No vendor visibility.

6. Renewal (before expiry):
   Customer requests renewal → vendor issues new .lic with extended expiry
   Customer uploads new .lic → no deactivation needed

7. Machine transfer (hardware upgrade):
   Customer sends vendor new machineId
   Vendor issues new .lic with new machineId signed in
   Customer uploads on new machine
```

---

#### Tasks

- [x] **P3-01** Generate RSA-2048 vendor key pair
  - `tools/genVendorKeys.ts` — one-time script: generates `vendor-private.pem` + `vendor-public.pem`
  - Vendor stores `vendor-private.pem` in secrets vault — **never committed to git**
  - `vendor-public.pem` is hardcoded (base64) into `licenseManager.ts` at build time
  - Run once: `npx tsx tools/genVendorKeys.ts`

- [x] **P3-02** Embed machineId in `.lic` file payload + genLicense CLI
  - Add `--machineid` flag to `tools/genLicense.ts`
  - `.lic` payload includes `machineId` field alongside tier, seats, expiry
  - RSA signature covers entire payload including machineId — tamper-proof
  - Multi-instance: vendor issues one `.lic` per machine (each with its machineId)

- [x] **P3-03** Update `validateLicFile()` in `licenseManager.ts`
  - After RSA signature check: verify `payload.machineId === getMachineId()`
  - If machineId absent in `.lic` (old format): skip machineId check (backward compat)
  - Replace VENDOR_SECRET dependency: use bundled RSA public key instead

- [x] **P3-04** Update `storeLicense()` for `.lic` path
  - Store `.lic` file path (or full parsed payload) in `data/license.json`
  - Startup check: re-verify RSA signature on every boot (detect tampered `.lic`)
  - `checkMachineBinding()` reads machineId from `.lic` payload (not separately stored)

- [x] **P3-05** "Copy Machine ID" workflow in Admin → License panel
  - Show full machineId with "Copy" button **before** any license is uploaded
  - Include instructions: "Send this ID to your vendor to receive your .lic file"
  - Show whether current license's machineId matches current machine

- [x] **P3-06** Deprecate HMAC key activation for production tiers
  - `STR` (Starter) keys: HMAC keys remain supported — low risk, single machine
  - `TEAM` + `ENT` keys: require `.lic` file — HMAC key activation blocked
  - Show clear message: "Team/Enterprise licenses require a .lic file from your vendor"

- [x] **P3-07** Seat audit report — exportable by customer admin
  - Admin → License panel → "Export Seat Report" button
  - Generates CSV: username | role | login count | last active | seat #
  - Vendor can request this report from customer for compliance (no automated telemetry)
  - Customer controls when/if they share this

- [x] **P3-08** White-label configuration (Enterprise only)
  - `appName`, logo URL, primary brand colour in `.lic` payload
  - Applied at server startup: overrides `appName` in AppSettings
  - Logo rendered in nav bar + login page

- [x] **P3-09** Trial/Evaluation tier (market gap — Gap 1)
  - Add `EVAL` to tier codes in `parseLicenseKey()` and `featuresForTier()`
  - EVAL tier: `isSeatAvailable()` and `checkMachineBinding()` always pass (no binding)
  - `genLicense.ts`: add `--tier EVAL` support; `--org` defaults to `TRIAL`
  - Max 30-day expiry enforced: if `calcExpiresAt()` > 30 days from today, reject EVAL key
  - UI: show "Trial expires in N days — purchase a license to continue" banner (amber)
  - On expiry: standard read-only mode

- [x] **P3-10** Upgrade CTA on locked features (market gap — Gap 3)
  - `requireFeature()` middleware: return HTTP 402 (not 403) with body `{ upgrade: 'team' }`
  - UI: when API returns 402, show modal: "This feature requires the {tier} plan — Contact vendor"
  - Feature chip in License panel: locked features show lock icon + hover tooltip "Upgrade to Team"
  - Admin panel shows current tier badge with "Upgrade" button linking to vendor contact

- [x] **P3-11** License Audit Log (market gap — Gap 5)
  - Append to `data/audit.json` (already exists) for license events:
    `{ ts, action: 'LICENSE_ACTIVATED'|'LICENSE_DEACTIVATED'|'LICENSE_TRANSFERRED'|'LICENSE_EXPIRED', key (masked), machineId, ip, userId }`
  - `GET /api/admin/license/audit` — returns last 100 license events (admin only)
  - Display in Admin → License panel → "Audit" sub-section (collapsible)
  - Required for SOC2 / ISO27001 customer audits

- [x] **P3-12** CI/CD deployment documentation (market gap — Gap 4)
  - Document `QA_SKIP_MACHINE_CHECK=1` env var in `docs/DEPLOYMENT_CICD.md`
  - Explain: for Docker/Jenkins/GitHub Actions where MAC address changes per container
  - Recommend: use a dedicated STR/TEAM key for CI (not the production ENT key)
  - Add warning in server startup log: "Machine check bypassed (QA_SKIP_MACHINE_CHECK=1)"

---

## Implementation Order

```
Phase 1 ✅ DONE
  P1-01 → P1-02 → P1-03 → P1-04 → P1-05 → P1-06 → P1-07 → P1-08 → P1-09 → P1-10

Phase 1-EG ✅ DONE
  P1-EG-01 → P1-EG-02 → P1-EG-03 → P1-EG-04 → P1-EG-05 → P1-EG-06 → P1-EG-07

Phase 2 (persistent sessions + seat dashboard)
  P2-01 → P2-02 → P2-03 → P2-04

Phase 3 (RSA offline license + market parity)
  P3-01  genVendorKeys.ts (one-time, vendor only)   ← no dependencies
  P3-02  embed machineId in .lic + genLicense CLI   ← depends on P3-01
  P3-03  validateLicFile() — RSA + machineId check  ← depends on P3-01, P3-02
  P3-04  storeLicense() for .lic path               ← depends on P3-03
  P3-05  "Copy Machine ID" UI workflow              ← depends on P1-EG-01
  P3-06  Deprecate HMAC for TEAM/ENT tiers          ← depends on P3-03
  P3-07  Seat audit report export                   ← depends on P2-01
  P3-08  White-label config from .lic payload        ← depends on P3-04
  P3-09  Trial/Eval tier (EVAL key + UI banner)     ← depends on P1 parseLicenseKey
  P3-10  Upgrade CTA on locked features (402 + UI)  ← depends on P1 requireFeature
  P3-11  License Audit Log + API endpoint           ← no dependencies
  P3-12  CI/CD deployment guide                     ← no dependencies (docs only)
```

---

## Files to Create / Modify

| File | Action | Phase |
|------|--------|-------|
| `src/data/types.ts` | Add `LicensePayload` + `maxInstances` field | P1 / P1-EG |
| `src/utils/licenseManager.ts` | Create + extend (machineId, RSA validation, startup check) | P1 / P1-EG / P3 |
| `tools/genLicense.ts` | Create + add `--instances` + `--machineid` flags | P1 / P1-EG / P3 |
| `tools/genVendorKeys.ts` | **Create new** — one-time RSA key pair generator (vendor only) | P3 |
| `src/ui/server.ts` | requireFeature, seat check, license endpoints, transfer endpoint | P1 / P1-EG |
| `src/ui/public/modules.js` | License panel UI + machineId display + transfer + seat report | P1 / P1-EG / P3 |
| `src/ui/public/index.html` | License section + expiry banner + Copy MachineId UI | P1 / P3 |
| `src/ui/public/app.js` | License banner check on load | P1 |
| `src/ui/public/styles_addon.css` | License badge/chip/banner/readonly styles | P1 |
| `data/license.json` | Runtime: created on activation (encrypted payload + machineId) | P1 |
| `src/ui/server.ts` | Replace MemoryStore with SQLite session store | P2 |

---

## Security Principles

1. **Expiry enforced on every request** — `getLicensePayload()` compares `expiresAt` against wall clock on every call; expired license detected without server restart
2. **Hourly expiry tick** — background interval catches expiry edge case when no requests arrive at midnight
3. **Entire payload encrypted** — `license.json` contains no plaintext; `expiresAt` is inside AES-256-GCM ciphertext; editing the file → decryption failure → null payload → read-only mode
4. **No perpetual license possible** — `expiresAt` is derived from the HMAC-signed key (P1) or RSA-signed `.lic` (P3); cannot be extended without vendor re-issuing
5. **No internet connection required** — all validation is local, fully air-gapped
6. **No vendor access to customer machine** — ever; no heartbeat; no phone-home
7. **RSA-2048 asymmetric signing** — private key never leaves vendor; public key bundled in app
8. **machineId signed into .lic** — cannot be transplanted to another machine
9. **Startup check is blocking** — server will not start with mismatched machine
10. **Admin override documented** — `QA_SKIP_MACHINE_CHECK=1` for Docker/CI; not a secret backdoor
11. **No automated telemetry** — vendor requests seat report from customer manually if needed

---

## Notes

- Recorder licensing enforced **server-side only** at `POST /api/recorder/start` — no changes to `recorder.js`
- Phase 1 + Phase 1-EG are sufficient to go commercial immediately (HMAC key approach)
- Phase 3 removes the VENDOR_SECRET dependency from customer servers — making forgery impossible
- Customer ↔ vendor communication for licensing is always manual (email / web form) — by design
- Docker/container: `QA_SKIP_MACHINE_CHECK=1` — documented in deployment guide
- Multi-server clusters: vendor issues one `.lic` per machine (each with its own signed machineId)
- Renewal: vendor issues new `.lic` with extended expiry; customer uploads — no deactivation needed

---

## PHASE 4 — Feature-Level Override Add-ons (Vendor-Signed) ✅

> **Goal:** Allow vendors to grant or revoke individual features independent of tier.
> Enables bespoke licensing deals (e.g., "Starter + Scheduler add-on for $X/yr") without
> adding new tier codes. Overrides are signed into the RSA `.lic` file — tamper-proof.

### Design Principles

| Principle | Detail |
|-----------|--------|
| **Vendor-controlled** | Only vendor CLI (`genLicense.ts`) can set overrides |
| **Tamper-proof** | Overrides live inside RSA-SHA256 signed `.lic` payload |
| **HMAC keys excluded** | HMAC (STR HMAC) keys cannot carry overrides — no signature protection |
| **Additive and subtractive** | Can grant features above tier default OR revoke features from tier |
| **Precedence** | `featureOverrides` always wins over tier default in `isFeatureEnabled()` |
| **Visible in UI** | Admin panel shows granted overrides with `+` badge, revoked with strikethrough |

### Feature Keys Available for Override

```
recorder    — Playwright recorder (step capture from browser)
debugger    — Step-by-step visual debugger
scheduler   — Cron-based suite scheduler
sso         — SAML/LDAP single sign-on
apiAccess   — REST API access (external integrations)
whiteLabel  — Custom branding (appName, logo, colour)
```

### Vendor CLI Usage

```bash
# Starter + Scheduler add-on (below-tier grant)
npx tsx tools/genLicense.ts --tier STR --org ACME001 --seats 5 --expiry 202612 \
  --lic --privkey ./vendor-private.pem \
  --enable scheduler

# Team WITHOUT SSO (above-tier revoke — compliance restriction)
npx tsx tools/genLicense.ts --tier TEAM --org CORP001 --seats 10 --expiry 202612 \
  --lic --privkey ./vendor-private.pem \
  --disable sso

# Multiple: grant apiAccess + revoke whiteLabel
npx tsx tools/genLicense.ts --tier ENT --org BIGCO --seats 50 --expiry 202612 \
  --lic --privkey ./vendor-private.pem \
  --enable apiAccess --disable whiteLabel

# --enable and --disable accept comma-separated lists
npx tsx tools/genLicense.ts --tier STR --org ACME001 --seats 3 --expiry 202612 \
  --lic --privkey ./vendor-private.pem \
  --enable scheduler,sso --disable recorder
```

### How It Works

```
genLicense.ts CLI
  → parse --enable / --disable args
  → validate each key against VALID_FEATURE_KEYS
  → ERROR if no --lic flag (HMAC keys can't carry overrides)
  → build featureOverrides: { scheduler: true, sso: false }
  → inject into payload: { tier, seats, ..., featureOverrides }
  → RSA-SHA256 sign entire payload including overrides
  → write signed .lic file

Customer uploads .lic
  → validateLicFile() verifies RSA signature covers featureOverrides
  → storeLicense() encrypts full payload (including overrides) in license.json

Runtime feature check
  → isFeatureEnabled('scheduler')
       if 'scheduler' in featureOverrides → return featureOverrides.scheduler
       else → return features.scheduler (tier default)

Admin UI
  → GET /api/admin/license returns featureOverrides in response
  → Active features: show normal chips + "+" superscript for add-ons
  → Revoked features: show strikethrough chip below feature list
```

### Tasks

- [x] **P4-01** Add `FeatureKey` type + `featureOverrides` field to `LicensePayload` in `types.ts`
  - `type FeatureKey = 'recorder' | 'debugger' | 'scheduler' | 'sso' | 'apiAccess' | 'whiteLabel'`
  - `featureOverrides?: Partial<Record<FeatureKey, boolean>>` — optional in payload

- [x] **P4-02** Update `isFeatureEnabled()` in `licenseManager.ts`
  - Check `featureOverrides[feature]` first — if present, return it (overrides tier)
  - Fall through to tier `features[feature]` if no override for this key

- [x] **P4-03** Add `--enable` / `--disable` flags to `tools/genLicense.ts`
  - Comma-separated `FeatureKey` values (`--enable scheduler,sso`)
  - Validates each key against `VALID_FEATURE_KEYS`; errors on unknown keys
  - Gate: requires `--lic` flag (cannot be used with HMAC mode)
  - Outputs `Overrides: +[scheduler, sso]  -[whiteLabel]` in generation summary

- [x] **P4-04** Expose `featureOverrides` in `GET /api/admin/license`
  - Returns `featureOverrides: {}` (empty if no overrides) — always present in response

- [x] **P4-05** Admin UI — display overrides in license panel (`modules.js` + `index.html`)
  - Granted add-ons (tier=false, override=true): chip with `+` superscript in accent colour
  - Revoked features (tier=true, override=false): strikethrough chip in secondary row
  - Normal tier features: unchanged chip style

### Add-on Pricing Model (Suggested)

| Add-on | Base Tier | Price | Example Use Case |
|--------|-----------|-------|-----------------|
| Scheduler | Starter | +$X/yr | Small team wants cron runs without upgrading |
| SSO | Starter | +$X/yr | Team has SAML IdP but not enough seats for Team tier |
| API Access | Team | +$X/yr | Team integration use case without full Enterprise |
| Recorder | Custom | Negotiated | Feature restriction for compliance environments |

### Security Consideration

Overrides are **only as secure as the RSA key pair**. If `vendor-private.pem` is compromised:
- Attacker could issue `.lic` files with any features enabled
- Mitigation: rotate RSA keys → issue new `.lic` files to all customers → old public key still
  validates old files (backward compat window) → app updated with new public key after transition

This matches Katalon's approach: certificate-based features, certificate revocation on key rotation.

### Files Modified

| File | Change |
|------|--------|
| `src/data/types.ts` | Added `FeatureKey` type + `featureOverrides` field to `LicensePayload` |
| `src/utils/licenseManager.ts` | Updated `isFeatureEnabled()` — override check before tier default |
| `tools/genLicense.ts` | Added `--enable` / `--disable` flags + override summary output |
| `src/ui/server.ts` | Added `featureOverrides` to `GET /api/admin/license` response |
| `src/ui/public/modules.js` | Override badge rendering in `_renderLicensePanel()` |
| `src/ui/public/index.html` | Added `#lic-revoked-features` container div |
