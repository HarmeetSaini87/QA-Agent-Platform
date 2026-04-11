# QA Agent Platform — Commercial Licensing Plan
# Status: PENDING IMPLEMENTATION
# Created: 2026-04-11
# Last Updated: 2026-04-11

---

## Overview

Before the platform goes commercial, a licensing layer must be added to control:
- **Who** can use the product (org identity, seat count)
- **What** they can access (feature gating per tier)
- **How long** their access is valid (expiry enforcement)
- **Where** the product runs (on-premise vs SaaS/cloud)

Three tiers are planned: **Starter**, **Team**, **Enterprise**.
Enforcement model: **per-seat + annual/monthly period** — consistent with Katalon, Tricentis, mabl.

---

## License Key Format

```
QAP-{TIER}-{ORG_ID}-{EXPIRY_YYYYMM}-{SEATS}-{CHECKSUM}

Example:
QAP-TEAM-ACME001-202612-010-A3F7

Fields:
  TIER      STR | TEAM | ENT
  ORG_ID    6-char alphanumeric org identifier (assigned at purchase)
  EXPIRY    YYYYMM — grace period: 7 days after this month ends
  SEATS     Zero-padded count (001–998); 999 = unlimited (Enterprise)
  CHECKSUM  First 4 chars of HMAC-SHA256(key_body, VENDOR_SECRET)
```

---

## Feature Gate Map (per tier)

| Feature                  | Starter | Team | Enterprise |
|--------------------------|---------|------|------------|
| Max Projects             | 1       | ∞    | ∞          |
| Max Named Users (seats)  | 3       | Paid | ∞          |
| Test Script Builder      | ✓       | ✓    | ✓          |
| Recorder                 | ✓       | ✓    | ✓          |
| Debugger                 | ✓       | ✓    | ✓          |
| Common Functions         | ✓       | ✓    | ✓          |
| Common Data (sensitive)  | ✓       | ✓    | ✓          |
| Scheduler                | ✗       | ✓    | ✓          |
| SSO (SAML/LDAP)          | ✗       | ✓    | ✓          |
| API Access               | ✗       | ✗    | ✓          |
| White-label              | ✗       | ✗    | ✓          |
| Audit Trail Retention    | 30 days | 90 days | Unlimited |
| Offline / Air-gapped     | ✗       | ✗    | ✓          |
| Support SLA              | Community | 48h email | 4h dedicated |

---

## Validation Modes

### Online (Starter + Team)
```
Server startup → POST https://license.qa-agent.io/v1/validate
Body: { key, machineId, version, tier }
Response: { valid, features, expiresAt, orgName, seats }
Cache response for 24h → graceful offline tolerance
Re-validate silently every 24h
After 72h offline → warning banner (still functional)
After 7 days offline → read-only mode
```

### Offline / Air-gapped (Enterprise only)
```
License file: qa-agent-platform/license.lic
Format: JSON payload + RSA-2048 signature (vendor private key)
Server reads + verifies signature on startup (no internet required)
Expiry enforced via signed timestamp in the .lic file
Customer receives .lic file from vendor after purchase
```

---

## Graceful Degradation Rules

| State                     | Behaviour                                                              |
|---------------------------|------------------------------------------------------------------------|
| License valid             | Full access per tier                                                   |
| Within 7-day grace period | Full access + banner: "License expires in N days — renew now"         |
| License expired           | Read-only mode: view scripts/history/reports, no run/record/save      |
| License server unreachable| Use 24h cache; after 72h: warning banner; after 7 days: read-only    |
| Seat limit reached        | Existing sessions unaffected; new logins blocked with clear message   |
| Invalid key               | Access denied at login; admin sees activation error panel             |

---

## Pending Task List

---

### PHASE 1 — License Infrastructure (START HERE)
> **Goal:** Minimum viable licensing — enough to go commercial.
> Issue keys manually, validate locally or against a stub endpoint.

- [ ] **P1-01** Create `src/utils/licenseManager.ts`
  - `parseLicenseKey(key)` — splits key into components, validates HMAC checksum
  - `validateOnline(key)` — POST to license server, cache result to `data/license-cache.json`
  - `validateOffline(licFile)` — verify RSA-2048 signature on `license.lic`
  - `getLicensePayload()` — returns current active `LicensePayload` (throws if invalid/expired)
  - `isFeatureEnabled(feature)` — true/false per `LicensePayload.features`
  - `getSeatsUsed()` — count of active sessions vs seat limit

- [ ] **P1-02** Create `LicensePayload` interface in `src/data/types.ts`
  ```typescript
  interface LicensePayload {
    tier:        'starter' | 'team' | 'enterprise';
    orgId:       string;
    orgName:     string;
    seats:       number;        // -1 = unlimited
    expiresAt:   string;        // ISO date
    features: {
      recorder:    boolean;
      debugger:    boolean;
      scheduler:   boolean;
      sso:         boolean;
      apiAccess:   boolean;
      whiteLabel:  boolean;
      auditDays:   number;      // -1 = unlimited
      maxProjects: number;      // -1 = unlimited
    };
  }
  ```

- [ ] **P1-03** Create `tools/genLicense.ts` — vendor CLI to issue license keys
  - Inputs: tier, orgId, orgName, seats, expiryYYYYMM
  - Outputs: license key string (for online mode) + signed `license.lic` file (for Enterprise)
  - Run with: `npx ts-node tools/genLicense.ts --tier TEAM --org ACME001 --seats 10 --expiry 202612`

- [ ] **P1-04** Add feature-gate middleware to `src/ui/server.ts`
  - Express middleware: `requireFeature(feature: keyof LicensePayload['features'])`
  - Apply to relevant route groups:
    - `/api/recorder/*` → requireFeature('recorder')
    - `/api/debug/*` → requireFeature('debugger')
    - `/api/schedules/*` → requireFeature('scheduler')
    - `/api/admin/sso/*` (future) → requireFeature('sso')
  - Returns `403 { error: 'Feature not available on your license tier', feature, tier }`

- [ ] **P1-05** Add seat enforcement to `POST /api/auth/login`
  - On login: check `getSeatsUsed() >= licensePayload.seats` (skip if seats = -1)
  - If over limit: return `403 { error: 'Seat limit reached', seatsUsed, seatsTotal }`
  - Track active seats: use existing session store (count sessions with `userId` set)

- [ ] **P1-06** Add license storage — `data/license.json` (encrypted at rest)
  - Stores: key, cached payload, lastValidated timestamp
  - Never store raw key in plaintext — encrypt with `QA_SECRET_KEY` (same as CommonData)

- [ ] **P1-07** Admin UI — License panel (`modules.js` + `index.html`)
  - New section in Admin tab: **License**
  - Fields: License Key input (or .lic file upload for Enterprise)
  - Displays after activation:
    - Org name, Tier badge, Expiry date (with days-remaining)
    - Seats: used / total (e.g. "3 / 10")
    - Features enabled (checklist)
  - Activate button → calls `POST /api/admin/license/activate`
  - Status indicator: Active (green) / Expiring Soon (amber) / Expired (red)

- [ ] **P1-08** Add `GET /api/admin/license` and `POST /api/admin/license/activate` endpoints
  - GET: returns sanitised payload (no raw key) for UI display
  - POST: accepts `{ key }` or multipart `.lic` file, validates, stores, returns payload

- [ ] **P1-09** Expiry banner in main UI (`index.html` / `app.js`)
  - On app load: fetch `/api/admin/license` → check `expiresAt`
  - If within 14 days: amber banner at top: "License expires in N days — contact your vendor to renew"
  - If expired: red banner + read-only mode enforced (disable Run, Record, Save buttons)

- [ ] **P1-10** Read-only mode enforcement (client-side, backed by server 403)
  - When license expired: disable Run Suite, Start Recording, Save Script, Save Suite buttons
  - Tooltip on disabled buttons: "License expired — renew to continue"

---

### PHASE 2 — Seat Enforcement & Session Tracking (AFTER PHASE 1)
> **Goal:** Accurate real-time seat counting and revocation.

- [ ] **P2-01** Persistent session store (replace in-memory MemoryStore)
  - Use `session-file-store` or `better-sqlite3` session store
  - Required for accurate seat counting across server restarts
  - Config: `src/ui/server.ts` session middleware

- [ ] **P2-02** Active seat dashboard in Admin → License panel
  - Table: Username | Login Time | Last Activity | IP | Revoke button
  - `GET /api/admin/license/sessions` — returns active session list
  - `DELETE /api/admin/license/sessions/:sessionId` — force-logout a user (frees a seat)

- [ ] **P2-03** Seat release on logout / timeout
  - Already handled by session destroy on logout and inactivity timeout
  - Verify seat count updates correctly after session expiry
  - Add seat count to `/api/admin/license` response

- [ ] **P2-04** Admin notification when seat usage exceeds 80%
  - In-app banner to admin only: "8 of 10 seats in use — consider upgrading"

---

### PHASE 3 — License Portal (SEPARATE SERVICE — AFTER PHASE 2)
> **Goal:** Self-service purchase, key issuance, renewal. Separate Node.js app.

- [ ] **P3-01** License server API (`license-server/`)
  - `POST /v1/validate` — validates key, returns `LicensePayload`
  - `POST /v1/issue` — admin-only, issues new key (protected by vendor API secret)
  - `POST /v1/revoke` — marks key as revoked
  - `GET  /v1/status/:orgId` — usage stats for an org

- [ ] **P3-02** Customer portal UI
  - Registration + payment (Stripe or LemonSqueezy integration)
  - Tier selection → payment → license key emailed + shown on screen
  - Renewal flow: extend expiry, update seat count

- [ ] **P3-03** Renewal notification emails
  - Trigger at 30 days, 15 days, 7 days, 1 day before expiry
  - Email: "Your QA Agent Platform license expires on {date} — renew now"
  - Optionally: in-app notification via existing session for admin users

- [ ] **P3-04** Usage telemetry (opt-in only)
  - Anonymous metrics: seat count used, test runs per month, recorder sessions per month
  - Displayed in vendor dashboard to understand adoption
  - Opt-in toggle in Admin → Settings; default OFF
  - Data sent to telemetry endpoint, never contains test data or credentials

- [ ] **P3-05** White-label configuration (Enterprise only)
  - `appName`, logo URL, primary brand colour configurable in license payload
  - Applied at server startup: overrides `appName` in AppSettings
  - Logo rendered in nav bar and login page

---

## Implementation Order

```
P1-02  types.ts LicensePayload interface          ← no dependencies
P1-03  genLicense CLI (vendor tool)               ← no dependencies, run once
P1-01  licenseManager.ts                          ← depends on P1-02
P1-06  data/license.json storage                  ← depends on P1-01
P1-08  API endpoints activate + GET               ← depends on P1-01, P1-06
P1-04  requireFeature() middleware                ← depends on P1-01
P1-05  Seat check on login                        ← depends on P1-01
P1-07  Admin UI license panel                     ← depends on P1-08
P1-09  Expiry banner                              ← depends on P1-08
P1-10  Read-only mode client enforcement          ← depends on P1-09
─────────────────────────────────────────────────────────────────
Phase 2 (session store + seat dashboard)
Phase 3 (portal + telemetry + white-label)
```

---

## Files to Create / Modify

| File | Action | Phase |
|------|--------|-------|
| `src/data/types.ts` | Add `LicensePayload` interface | P1 |
| `src/utils/licenseManager.ts` | **Create new** | P1 |
| `tools/genLicense.ts` | **Create new** (vendor CLI) | P1 |
| `src/ui/server.ts` | Add `requireFeature` middleware + license endpoints | P1 |
| `src/ui/public/modules.js` | Add License panel to Admin tab | P1 |
| `src/ui/public/index.html` | Add License section markup + expiry banner | P1 |
| `src/ui/public/app.js` | License check on app load → read-only mode | P1 |
| `data/license.json` | Runtime: created on activation | P1 |
| `data/license-cache.json` | Runtime: online validation cache | P1 |
| `src/ui/server.ts` | Replace MemoryStore with file-based session store | P2 |
| `license-server/` | **New separate service** | P3 |

---

## Notes

- Recorder licensing is enforced **server-side only** at `POST /api/recorder/start` — no changes needed in `recorder.js`
- Phase 1 is sufficient to go commercial — keys can be issued manually via the `genLicense` CLI
- The license portal (Phase 3) can be built and launched post-commercial without blocking Phase 1 or 2
- For air-gapped Enterprise customers, only the `.lic` file + RSA public key (bundled in the app) are needed — no internet dependency
