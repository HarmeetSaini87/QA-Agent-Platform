# QA Agent Platform — API Reference

**Base URL:** `http://localhost:3003` (dev) · `http://localhost:3000` (prod)  
**Auth:** Session cookie (browser) or `Authorization: Bearer <apiKey>` (CI/API clients)

---

## Auth Middleware

| Middleware | Requirement |
|---|---|
| *(none)* | Public — no auth |
| `requireAuth` | Valid session cookie |
| `requireAuthOrApiKey` | Session cookie OR API key in `Authorization: Bearer` header |
| `requireEditor` | Session + role ≥ `editor` |
| `requireAdmin` | Session + role == `admin` |
| `requireFeature(name)` | License feature gate (returns 402 if tier too low) |
| token-auth | Token issued by `/api/recorder/start` or `/api/debug/start` — no session required |
| `loginRateLimiter` | 10 attempts per 15 min window (DoS protection) |

---

## Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | loginRateLimiter | Authenticate with username + password. Sets session cookie. |
| POST | `/api/auth/logout` | — | Destroy session. |
| GET | `/api/auth/me` | — | Return current user info (null if not logged in). |
| POST | `/api/auth/change-password` | — | Change password by userId. |
| POST | `/api/user/change-password` | — | Change password for currently logged-in user. |
| GET | `/api/env` | — | Return environment label (`DEV`/`PROD`) — used by login page badge. |

---

## Projects

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/projects` | — | List all active projects. |
| GET | `/api/projects/all` | requireAdmin | List all projects including inactive. |
| POST | `/api/projects` | requireAdmin | Create project. |
| PUT | `/api/projects/:id` | requireAdmin | Update project metadata. |
| DELETE | `/api/projects/:id` | requireAdmin | Delete project. |
| POST | `/api/projects/:id/next-tc-id` | requireAuth | Generate next test case ID for project. |

---

## Scripts

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/scripts` | — | List test scripts for a project (`?projectId=`). |
| GET | `/api/scripts/:id` | — | Get single test script. |
| POST | `/api/scripts` | requireEditor | Create test script. |
| PUT | `/api/scripts/:id` | requireEditor | Update test script. |
| DELETE | `/api/scripts/:id` | requireEditor | Delete test script. |
| DELETE | `/api/scripts/bulk` | requireAuth, requireEditor | Delete multiple scripts. |
| PATCH | `/api/scripts/bulk` | requireAuth, requireEditor | Bulk patch (priority, tags, component). |
| POST | `/api/scripts/bulk-suite` | requireAuth, requireEditor | Assign multiple scripts to a suite. |

---

## Suites

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/suites` | — | List suites for a project. |
| GET | `/api/suites/all` | requireAdmin | List all suites across all projects. |
| GET | `/api/suites/:id` | — | Get suite with enriched script objects. |
| POST | `/api/suites` | requireEditor | Create suite. |
| PUT | `/api/suites/:id` | requireEditor | Update suite. |
| DELETE | `/api/suites/:id` | requireEditor | Delete suite. |
| POST | `/api/suites/:id/run` | requireAuthOrApiKey, requireEditor | Execute suite. Body: `{ environmentId? }`. |

### Suite run response
```json
{ "runId": "run-abc123" }
```
Poll `GET /api/run/:runId` until `status` is `completed`, `failed`, or `error`.

---

## Locators

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/locators` | — | List locators for a project. |
| POST | `/api/locators` | requireEditor | Create locator. |
| PUT | `/api/locators/:id` | requireEditor | Update locator (selector, alternatives). |
| DELETE | `/api/locators/:id` | requireEditor | Delete locator. |
| POST | `/api/locators/bulk-delete` | requireEditor | Delete multiple locators. |

---

## Functions (Common Reusable Steps)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/functions` | — | List common functions for a project. |
| POST | `/api/functions` | requireEditor | Create function. |
| PUT | `/api/functions/:id` | requireEditor | Update function. |
| DELETE | `/api/functions/:id` | requireEditor | Delete function. |

---

## Common Data (Test Data Vault)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/common-data` | requireAuth | List entries for project/environment. |
| POST | `/api/common-data` | requireAuth, requireEditor | Create entry. |
| PUT | `/api/common-data/:id` | requireAuth, requireEditor | Update entry. |
| DELETE | `/api/common-data/:id` | requireAuth, requireEditor | Delete entry. |
| GET | `/api/common-data/:id/reveal` | requireAuth | Decrypt and return sensitive value for editing. |
| POST | `/api/common-data/resolve` | requireAuth | Resolve `${variable}` tokens for project/environment. |

---

## Components / Subcomponents

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/projects/:projectId/components` | — | List components for project. |
| POST | `/api/projects/:projectId/components` | requireEditor | Create component. |
| PUT | `/api/projects/:projectId/components/:compId` | requireEditor | Update component + subcomponents. |
| DELETE | `/api/projects/:projectId/components/:compId` | requireEditor | Delete component. |

---

## Runs (Execution History)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/runs` | — | List all runs (paginated, `?projectId=&page=&size=`). |
| GET | `/api/run/:runId` | requireAuthOrApiKey | Get single run record with last 100 output lines. |

### Run record shape
```json
{
  "id": "run-abc123",
  "status": "completed | failed | error | running",
  "passCount": 5,
  "failCount": 1,
  "durationMs": 14700,
  "output": ["line1", "line2", "..."]
}
```

---

## Self-Healing Locators

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/heal-log` | requireAuth | Raw heal-log events (`?projectId=&limit=`). Returns most recent first. Max 500. |
| GET | `/api/locator-health` | requireAuth | Locator health summary (`?projectId=`). Heal counts, last healed date, avg confidence, old→new selector. Sorted by healCount desc. |
| POST | `/api/heal` | requireAuth | Score DOM candidates against healing profile. Returns ranked candidates. |
| GET | `/api/proposals` | requireAuth | List healing proposals (`?projectId=&status=pending\|accepted\|rejected`). |
| POST | `/api/proposals/:id/review` | requireAuth | Review proposal. Body: `{ action: 'approve' | 'approve-temporary' | 'reject' }`. |

### Locator health response shape
```json
[
  {
    "id": "loc-123",
    "name": "Login Button",
    "selector": "#login-btn",
    "healCount": 4,
    "lastHealedAt": "2026-04-24T20:32:00Z",
    "lastHealedFrom": ".old-login-btn",
    "lastHealedBy": "auto",
    "avgConfidence": 82,
    "recentEvents": [
      {
        "healedAt": "2026-04-24T20:32:00Z",
        "oldSelector": ".old-login-btn",
        "newSelector": "#login-btn",
        "confidence": 82,
        "method": "auto"
      }
    ]
  }
]
```

### Healing thresholds
| Score | Outcome |
|---|---|
| ≥ 75 | Auto-heal applied |
| 50–74 | Proposal created for manual review |
| < 50 | Hard fail — no heal |

---

## Pre-Scan (Locator Validation)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/prescan` | requireAuth | Receive live DOM candidates, score all locators, persist health report. Called by generated spec `beforeAll`. |
| GET | `/api/prescan` | requireAuth | Poll prescan results by `?runId=`. |
| GET | `/api/page-models` | requireAuth | List PageModels for a project. |
| POST | `/api/prescan-trigger` | requireAuth | Spawn minimal Playwright prescan spec to validate URL. |

---

## Visual Regression

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/visual-baselines` | requireAuth | List baselines for project (`?projectId=`). |
| GET | `/api/visual-baselines/:id/image` | requireAuth | Serve image (`?type=baseline\|actual\|diff`). |
| POST | `/api/visual-baselines/:id/approve` | requireAuth, requireEditor | Approve baseline (actual becomes new baseline). |
| DELETE | `/api/visual-baselines/:id` | requireAuth, requireEditor | Delete baseline. |
| POST | `/api/visual-baselines/compare` | requireAuthOrApiKey | Compare screenshot vs baseline. Called by generated spec. |

---

## Recorder (UI Recording)

> License: `recorder` feature required (all tiers).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/recorder/start` | requireAuth, requireFeature('recorder') | Create recording session. Returns `{ token, recorderUrl }`. |
| POST | `/api/recorder/step` | token-auth | Receive step event from recorder.js in AUT tab. |
| GET | `/api/recorder/stream/:token` | requireAuth | SSE push — live step delivery to editor. |
| GET | `/api/recorder/active` | requireAuth | Get active session token for project. |
| GET | `/api/recorder/status/:token` | requireAuth | Step count + active flag. |
| POST | `/api/recorder/stop` | requireAuth | Stop recording session. |
| POST | `/api/recorder/heartbeat` | token-auth | Keep session alive. |
| POST | `/api/recorder/analyse` | requireAuth | Analyse recorded steps — suggest CommonFunction extractions. |

---

## Debug (Step-by-Step Execution)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/debug/start` | requireAuth | Start debug session for a script. Returns `{ sessionId }`. |
| GET | `/api/debug/stream/:sessionId` | requireAuth | SSE push — step data + inline screenshots. |
| POST | `/api/debug/continue` | requireAuth | Send UI action (`continue\|skip\|stop\|retry`). |
| POST | `/api/debug/patch-step` | requireAuth | Persist corrected locator/value back to script + locator repo. |
| GET | `/api/debug/session/:id` | requireAuth | Poll session status. |
| POST | `/api/debug/heartbeat/:id` | requireAuth | Keep session alive (30s timeout). |
| GET | `/api/debug/sessions` | requireAuth | List active debug sessions for project. |
| GET | `/api/debug/heal-pending` | requireAuth | Get pending T4 heal proposal for running suite. |
| POST | `/api/debug/heal-respond` | requireAuth | Respond to heal proposal (`Approve\|Reject`). |

---

## Scheduler

> License: `scheduler` feature required (trial+).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/schedules` | requireAuth, requireFeature('scheduler') | List schedules for suite/project. |
| POST | `/api/schedules` | requireAuth, requireEditor, requireFeature('scheduler') | Create cron-based schedule. |
| PUT | `/api/schedules/:id` | requireAuth, requireEditor | Update schedule (label, cron, enabled, environmentId). |
| DELETE | `/api/schedules/:id` | requireAuth, requireEditor | Delete schedule and unregister cron job. |

---

## Analytics & Flaky Tests

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/analytics` | requireAuth | Execution analytics for project (`?projectId=&days=`). |
| GET | `/api/flaky` | requireAuth | Flaky test detection by pass rate + failure patterns (`?projectId=&suiteId=&limit=`). |

---

## Natural Language (AI Step Generation)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/nl-suggest` | requireAuth | Generate a test step from a natural language description. |
| GET | `/api/nl-providers` | requireAdmin | Provider metadata for Admin UI (no secrets). |

---

## Test Files (Upload / Data Files)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/test-files/upload` | — | Upload CSV/JSON/Excel test data file. |
| GET | `/api/test-files` | — | List uploaded files for project. |
| DELETE | `/api/test-files/:projectId/:filename` | — | Delete uploaded file. |

---

## Keyword Registry

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/keywords` | — | All keyword definitions (key, label, category, needsLocator, needsValue). |
| GET | `/api/keywords/playwright` | — | Playwright keyword definitions + dynamic token list. |

---

## Admin — Users

> Requires `admin` role.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/users` | requireAdmin | List all users (hashes redacted). |
| POST | `/api/admin/users` | requireAdmin | Create user. |
| PUT | `/api/admin/users/:id` | requireAdmin | Update user (email, role, active, forcePasswordChange, password). |
| DELETE | `/api/admin/users/:id` | requireAdmin | Delete user (cannot delete self). |

---

## Admin — API Keys

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/apikeys` | requireAdmin | List API keys (key hashes redacted). |
| POST | `/api/admin/apikeys` | requireAdmin | Create API key (name, optional expiry). |
| DELETE | `/api/admin/apikeys/:id` | requireAdmin | Revoke API key. |

---

## Admin — Audit Log

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/audit` | requireAdmin | Paginated audit log (`?page=&size=`). |

---

## Admin — Settings

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/settings` | requireAdmin | Get global app settings. |
| PUT | `/api/admin/settings` | requireAdmin | Update settings (notifications, NL provider). |
| POST | `/api/admin/settings/test-notification` | requireAdmin | Send test notification to verify config. |

---

## License (Commercial)

> License endpoints require both `requireAuth` and `requireAdmin`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/license` | Sanitized license info for UI display. |
| POST | `/api/admin/license/activate` | Validate and store license key or `.lic` file. |
| DELETE | `/api/admin/license` | Deactivate license. |
| POST | `/api/admin/license/transfer` | Re-bind license to current machine. |
| GET | `/api/admin/license/machine` | Current machine ID + binding status. |
| GET | `/api/admin/license/audit` | License-specific audit log (last 100 events). |
| GET | `/api/admin/license/sessions` | Active sessions + seat usage. |
| DELETE | `/api/admin/license/sessions/:sessionId` | Force-logout user, free seat. |
| GET | `/api/admin/license/seat-report` | Seat usage CSV report. |

### License tiers + features
| Feature | starter | trial | team | enterprise |
|---|---|---|---|---|
| `recorder` | ✅ | ✅ | ✅ | ✅ |
| `debugger` | ✅ | ✅ | ✅ | ✅ |
| `scheduler` | ❌ | ✅ | ✅ | ✅ |
| `sso` | ❌ | ❌ | ✅ | ✅ |
| `apiAccess` | ❌ | ❌ | ❌ | ✅ |
| `whiteLabel` | ❌ | ❌ | ❌ | ✅ |

### Feature-gated 402 response
```json
{
  "error": "Feature not available on your license tier",
  "feature": "scheduler",
  "tier": "starter",
  "upgrade": "team"
}
```

---

## Branding (White-Label)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/branding` | — | White-label config from Enterprise license. |

---

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | `{ status: 'ok', appBaseURL, port }` |

---

## File Serving

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/screenshots/*` | requireAuth | Test result screenshots (`test-results/**/*.png\|jpg`). |
| GET | `/test-artifacts/*` | requireAuth | Videos (`.webm`) and traces (`.zip`) from test runs. |
| GET | `/debug-screenshot/:path(*)` | requireAuth | Step screenshots from debug runs. |

---

## Pages

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | requireAuth | Main SPA (index.html). |
| GET | `/login` | — | Login page. |
| GET | `/execution-report` | requireAuth | Standalone execution report (opens in new tab). |
| GET | `/recorder-loader` | requireAuth | Recorder loader bookmarklet/console helper. |
| GET | `/*` | requireAuth | SPA fallback — all unmatched routes serve index.html. |
