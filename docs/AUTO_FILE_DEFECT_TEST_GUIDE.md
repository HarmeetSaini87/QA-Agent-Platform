# Auto-File Jira Defect — End-to-End Test Guide

**Audience:** SDETs validating the feature against a real Jira sandbox  
**Total tests:** 60 (functional + business + edge + E2E journeys)  
**Prerequisites:**
- Jira sandbox with at least one project (e.g. `BSM`)
- Atlassian API token for an account with Create + Edit + Comment permission on that project
- A user story (e.g. `BSM-1826`) that defects can be linked to
- A working TestForge install on `localhost:3003` (or `qa-launchpad.test`)
- A test suite with at least one failing test (so you have a failure to file against)

---

## Section 1 — Admin Configuration (10 tests)

### TC-001: Generate Jira API token
**Steps:** Open https://id.atlassian.com/manage-profile/security/api-tokens → Create API token → label `TestForge-E2E` → copy.  
**Expected:** Token shown once, copy succeeds.

### TC-002: Open Jira Integration panel as Admin
**Steps:** Login as Admin → Admin → Notifications → expand Jira Integration card.  
**Expected:** Panel renders with empty fields, status badge shows "Not configured".

### TC-003: Open Jira Integration panel as Tester
**Steps:** Login as Tester → navigate to Admin tab.  
**Expected:** Either tab is hidden or save buttons are inaccessible. (Per platform RBAC.)

### TC-004: Test Connection with no credentials saved
**Steps:** Click **Test Connection** before saving anything.  
**Expected:** `✗ 400 JIRA_NOT_CONFIGURED` (or similar — depends on whether `.env` had values).

### TC-005: Test Connection with wrong email
**Steps:** Fill base URL, wrong email, valid token → Save → Test Connection.  
**Expected:** `✗ 401 JIRA_AUTH_FAILED`.

### TC-006: Test Connection with wrong/expired token
**Steps:** Save valid email + obviously bad token (`xxxx`) → Test Connection.  
**Expected:** `✗ 401 JIRA_AUTH_FAILED`.

### TC-007: Test Connection with valid credentials
**Steps:** Fill all fields correctly → Save → Test Connection.  
**Expected:** `✓ Connected as <your email>` in green.

### TC-008: Save Configuration with token, then re-load page
**Steps:** Save → reload browser → reopen Jira panel.  
**Expected:** Token field is empty with placeholder `(token set — leave blank to keep)`. Other fields populated.

### TC-009: Save Configuration WITHOUT changing token
**Steps:** Open panel after TC-008 → change Project Key only → Save (leave token field blank).  
**Expected:** `✓ Saved`. Test Connection still works (existing token retained).

### TC-010: Save Configuration with empty required fields
**Steps:** Clear Project Key → Save.  
**Expected:** `✗ Missing field: projectKey` (red error message).

---

## Section 2 — Token Encryption (5 tests)

### TC-011: Token is not in plaintext on disk
**Steps:** Save a config with token → open `data/jira-config.json`.  
**Expected:** No plaintext token. Field `apiTokenEnc` contains a base64.base64.base64 envelope (3 parts separated by dots).

### TC-012: Token is not returned to browser via GET /api/jira/config
**Steps:** With Admin session cookie, run `curl http://localhost:3003/api/jira/config`.  
**Expected:** Response has `hasTokenSet: true` but no `apiTokenEnc` or token value.

### TC-013: Token survives server restart
**Steps:** Save token → restart server (`npm run ui`) → click Test Connection.  
**Expected:** Connection succeeds (decrypts on use).

### TC-014: Garbled `apiTokenEnc` falls back to .env gracefully
**Steps:** Manually edit `data/jira-config.json`, set `apiTokenEnc` to `"abc.def.ghi"` → restart → Test Connection.  
**Expected:** Server log shows `[jira] token decrypt failed, falling back to .env`. Connection still works if `.env` has a valid token; fails otherwise.

### TC-015: Empty token field on save preserves existing token
**Steps:** Save with token → save again with empty token field → Test Connection.  
**Expected:** Connection still succeeds.

---

## Section 3 — Permissions (5 tests)

### TC-016: Defect button visible to Tester (disabled)
**Steps:** Login as Tester → open execution report with a failed test.  
**Expected:** **🐞 File Defect** button visible but appears disabled (or hover shows tooltip). Clicking does nothing client-side.

### TC-017: POST /api/defects/file rejects Tester
**Steps:** As Tester, manually POST `/api/defects/file` with valid body via DevTools.  
**Expected:** HTTP 403 from `requireEditor` middleware.

### TC-018: Defect button enabled for Editor
**Steps:** Login as Editor → execution report with failed test.  
**Expected:** Button clickable, modal opens.

### TC-019: PUT /api/jira/config rejects Editor
**Steps:** As Editor, manually PUT `/api/jira/config`.  
**Expected:** HTTP 403 from `requireAdmin`.

### TC-020: GET /api/jira/config works for any logged-in user
**Steps:** As Tester, run `curl http://localhost:3003/api/jira/config` with session cookie.  
**Expected:** HTTP 200 with redacted config (no token).

---

## Section 4 — File Defect Flow (Happy Path) (10 tests)

**Setup:** Run a suite that has at least one failing test. Note the runId and the failed test's testId.

### TC-021: 🐞 File Defect column visible in Execution Report
**Expected:** Defect column header appears between Trace and end of row. Failed rows show button; passed rows show empty cell.

### TC-022: Click 🐞 File Defect opens modal
**Expected:** Modal appears centered, ~80vw × 90vh, with header "🐞 File Defect to Jira" and Close button.

### TC-023: Draft is auto-filled correctly
**Steps:** Inspect modal contents.  
**Expected:**
- Project Key matches admin config
- Issue Type matches admin config
- Priority dropdown defaults to admin's Default Priority
- User Story field is blank (you must type)
- Summary = `<test name> failed in <suite name>`
- Description preview shows 5 sections: Description, Precondition, Steps, Actual Result, Expected Result (empty)
- Attachments listed: screenshot.png, video.webm, trace.zip with sizes
- testId appears literally in description preview text

### TC-024: Submit with empty User Story → validation
**Steps:** Leave User Story blank → click Approve & File.  
**Expected:** Inline error `User Story key must look like ABC-123`. No request sent.

### TC-025: Submit with malformed User Story → validation
**Steps:** Type `not a key` → Approve & File.  
**Expected:** Same validation error.

### TC-026: Submit with valid User Story key
**Steps:** Type `BSM-1826` → keep summary → Approve & File.  
**Expected:** Modal shows `⏳ Filing…` then `✓ Filed as BSM-XXXX [Open in Jira ↗]`.

### TC-027: Verify ticket exists in Jira
**Steps:** Open the link in TC-026 in a new tab.  
**Expected:** Jira ticket exists with:
- Summary matches what was submitted
- Description has the 5 sections, all readable
- Parent link / Issue link points to BSM-1826
- Attachments include screenshot, video, trace
- testId line is visible in the description body

### TC-028: Defect badge appears on the test row
**Steps:** Close modal → reload Execution Report.  
**Expected:** The same row's Defect column now shows `🐞 BSM-XXXX (Open)` (red badge) instead of File Defect button.

### TC-029: Click the badge opens existing-defect view
**Steps:** Click the badge.  
**Expected:** Modal shows "Defect BSM-XXXX is filed for this test" with **Open in Jira ↗** button.

### TC-030: "Open in Jira ↗" redirects correctly
**Steps:** Click the link.  
**Expected:** New tab opens to the Jira ticket URL (via `/api/defects/open/<key>` redirect).

---

## Section 5 — Duplicate / Comment Flow (5 tests)

**Setup:** TC-026 already filed BSM-XXXX. The test still fails on a subsequent run.

### TC-031: Re-run suite, same test fails again
**Expected:** New run record. Same testId on the failed test.

### TC-032: Click 🐞 File Defect on the new run's failure
**Expected:** Modal shows banner: `⚠ Already filed as BSM-XXXX (open) — Open in Jira ↗`. Buttons: Cancel | Add as Comment.

### TC-033: Click "Add as Comment"
**Expected:** Modal shows `⏳ Posting comment…` then `✓ Comment posted on BSM-XXXX`.

### TC-034: Verify comment in Jira
**Steps:** Open the Jira ticket.  
**Expected:** New comment appears with run ID, timestamp, error message, error stack code block.

### TC-035: Cancel from dedup banner
**Steps:** Re-fail the test, open modal, click Cancel.  
**Expected:** Modal closes. No comment posted, no new ticket created.

---

## Section 6 — "Not a Bug" Dismiss Flow (6 tests)

### TC-036: Open modal on a failed test (no existing defect)
**Expected:** Draft form renders.

### TC-037: Pick category from "Not a Bug ▾" dropdown
**Steps:** Select `script-issue` → click Dismiss.  
**Expected:** Modal body shows `✓ Logged as: script-issue`.

### TC-038: Verify no Jira ticket was created
**Steps:** Search Jira for any ticket containing this run's testId.  
**Expected:** Zero results.

### TC-039: Verify NDJSON entry written
**Steps:** Open `data/dismissed-defects.ndjson`.  
**Expected:** Last line contains JSON with `category: "script-issue"`, the runId, testId, dismissedBy.

### TC-040: Dismiss with empty category
**Steps:** Open modal → click Dismiss without picking category.  
**Expected:** Inline error `Pick a category`. No request sent.

### TC-041: All 5 categories work
**Steps:** Repeat TC-037 once per category: `script-issue`, `locator-issue`, `flaky`, `data-issue`, `env-issue`.  
**Expected:** Each appends a fresh line to NDJSON. All 5 succeed.

---

## Section 7 — Auto-Close on Next-Run Pass (8 tests)

**Setup:** TC-026 filed BSM-XXXX (Open). Now make the test pass.

### TC-042: Re-run suite, same test now passes
**Steps:** Fix the test or the AUT → run the same suite on the same environment.  
**Expected:** Run completes with the test in pass status.

### TC-043: Auto-close transitions ticket
**Steps:** Wait ~5 sec after run finalization → open the Jira ticket.  
**Expected:** Status is now `Closed` (or whatever transition name was configured).

### TC-044: Auto-close adds a comment
**Expected:** New comment on the ticket: `Auto-closed by TestForge — test passed on run <runId> at <timestamp>. Please verify the fix is genuine.`

### TC-045: Defect badge updates to Closed
**Steps:** Open Execution Report for the new run.  
**Expected:** Badge now shows `🐞 BSM-XXXX (Closed)` (green).

### TC-046: Audit log entry created
**Steps:** Open `data/audit.json` (or audit table in admin).  
**Expected:** Entry with `action: 'DEFECT_AUTO_CLOSED'`, `userId: 'system'`, defectKey, runId.

### TC-047: Auto-close scoped to same environment
**Steps:** File a defect in env A → run the suite in env B and pass the test.  
**Expected:** Defect in env A stays Open. No transition, no comment.

### TC-048: Auto-close scoped to same suite
**Steps:** File defect for test in suite A → run a different suite (B) that also has the same testId passing.  
**Expected:** Defect in suite A stays Open.

### TC-049: Auto-close handles forbidden transition gracefully
**Steps:** Configure Auto-Close Transition Name = `Nonexistent` → trigger auto-close.  
**Expected:** Server log warning: `[autoClose] failed`. Defect stays Open in registry. Run finalization NOT blocked.

---

## Section 8 — Attachment Handling (5 tests)

### TC-050: Attachment soft-skip when too large
**Steps:** Configure Max Attachment Size = `1` MB. Filed defect for a test with a larger trace zip.  
**Expected:** Ticket created. Trace marked as `tooLarge` in modal. Jira ticket has only screenshot + video. No error.

### TC-051: Uncheck attachments before submit
**Steps:** In modal, uncheck `screenshot` checkbox → Approve & File.  
**Expected:** Ticket created with only video + trace attachments. Screenshot skipped (status: `skipped`).

### TC-052: One attachment fails, others succeed
**Steps:** Manually delete the screenshot file from disk between the run and clicking File Defect.  
**Expected:** Ticket created. Screenshot marked `failed` in defects.json. Video + trace upload OK. Server log warning.

### TC-053: All attachments missing (very old run with no artifacts)
**Steps:** Pick a run from before screenshots were captured → File Defect.  
**Expected:** Modal shows "(no artifacts available)" in attachments section. Ticket still creates with description only.

### TC-054: Attachment URLs in Jira are valid
**Steps:** Click on each attachment in the Jira ticket UI.  
**Expected:** Image previews; video plays; trace.zip downloads.

---

## Section 9 — Error Handling (6 tests)

### TC-055: Jira down during File Defect
**Steps:** Block network to atlassian.net (e.g. firewall rule) → click File Defect.  
**Expected:** Modal shows `✗ Jira unreachable: ...`. No partial state in defects.json.

### TC-056: Jira validation error (e.g., non-existent User Story key)
**Steps:** Type `BSM-99999` (assume it doesn't exist) → Approve & File.  
**Expected:** Modal shows `✗ Jira rejected the request` with details from Jira's API response.

### TC-057: Two users file in parallel for the same testId
**Steps:** Open two browser tabs (different sessions if possible) → both click File Defect for the same failed test → both submit at the same time.  
**Expected:** First wins (creates ticket). Second sees HTTP 409 `ALREADY_FILED` with details pointing to the first ticket.

### TC-058: Run record deleted while defect is open
**Steps:** File defect → delete `results/run-<runId>.json` from disk → click the badge.  
**Expected:** Defect record stays valid in `data/defects.json`. Badge still renders. "Open in Jira" link still works.

### TC-059: Modal opened with stale runId (run no longer in memory)
**Steps:** Restart server (drops in-memory `runs` Map) → click File Defect for a recent run not yet in `results/`.  
**Expected:** HTTP 404 NOT_FOUND. Modal shows error.

### TC-060: Server crash during attachment upload
**Steps:** Start filing → kill server process mid-upload.  
**Expected:** Restart server. Defect may exist in Jira but not in `data/defects.json` (orphaned). Manual reconciliation needed (acceptable v1 behavior — not a feature failure).

---

## Section 10 — End-to-End Business Journeys (5 scenarios)

### E2E-1: Full happy path — file → close → confirmation
1. Admin configures Jira credentials + mapping (TC-002 → TC-009)
2. SDET runs a suite — test fails
3. SDET opens execution report, clicks 🐞 File Defect
4. Modal pre-fills correctly; SDET adds User Story key, clicks Approve & File
5. Jira ticket created with all sections + attachments — verify in Jira UI
6. Developer fixes the AUT → SDET re-runs the suite — test passes
7. Within seconds, ticket auto-transitions to Closed in Jira with a comment
8. Execution Report badge updates to green Closed badge
9. ✅ Pass

### E2E-2: Recurring failure → comment trail
1. SDET files defect for failing test (BSM-1842)
2. Suite runs daily for a week — test keeps failing
3. SDET clicks 🐞 BSM-1842 (Open) → "Add as Comment" each day
4. Open BSM-1842 in Jira → comment timeline shows 7 entries with run IDs and errors
5. Developer fixes — test passes — auto-close fires once
6. ✅ Pass

### E2E-3: False positive triage
1. Test fails due to flaky timing (NOT an AUT bug)
2. SDET clicks 🐞 File Defect → notices error suggests timing → does NOT click Approve
3. SDET picks `flaky` from "Not a Bug ▾" → Dismiss
4. NDJSON gets entry; no Jira ticket created
5. Flakiness Engine score for this test increases
6. After threshold, test gets auto-quarantined
7. ✅ Pass — bad signal kept out of Jira

### E2E-4: Admin token rotation
1. Admin generates new Jira API token (old one will be revoked)
2. Admin → Notifications → Jira Integration → paste new token in Token field → Save
3. Old token revoked at Atlassian
4. Run a suite — file a defect — succeeds with new token
5. Audit log shows config update by admin
6. ✅ Pass

### E2E-5: Multi-environment auto-close protection
1. Suite runs in DEV env → test fails → defect filed (BSM-2000)
2. Suite runs in QA env → same test happens to pass
3. Verify BSM-2000 stays Open (cross-environment guard works)
4. Suite runs in DEV again → test passes
5. NOW BSM-2000 auto-closes
6. ✅ Pass

---

## Test Execution Tracking

| Section | TCs | Pass | Fail | Notes |
|---|---|---|---|---|
| 1. Admin Configuration | 10 | | | |
| 2. Token Encryption | 5 | | | |
| 3. Permissions | 5 | | | |
| 4. File Defect Happy Path | 10 | | | |
| 5. Duplicate / Comment | 5 | | | |
| 6. Not a Bug Dismiss | 6 | | | |
| 7. Auto-Close | 8 | | | |
| 8. Attachments | 5 | | | |
| 9. Error Handling | 6 | | | |
| 10. E2E Journeys | 5 | | | |
| **Total** | **65** | | | |

**Sign-off criteria:**
- All 5 E2E journeys pass end-to-end against real Jira sandbox
- All TCs in Section 7 (Auto-Close) pass — this is the trickiest cross-cutting feature
- Token encryption verified (TC-011, TC-012)
- Permissions block correct roles (Section 3)

---

## Test Data Requirements

| Item | Used in |
|---|---|
| Jira project with `Defect` issue type | All sections |
| Existing user story (e.g. `BSM-1826`) | TC-026 onwards |
| Test that always fails (for repeat scenarios) | E2E-2, TC-031 |
| Test that can be toggled pass/fail | E2E-1, TC-042 |
| 2 different environments (DEV + QA) | E2E-5, TC-047 |
| 2 different suites with overlapping testIds | TC-048 |

---

## Cleanup After Testing

After running this guide, you may have produced 10–20 sandbox tickets in Jira. To clean up:

1. In Jira: bulk-search by `created >= -1d AND text ~ "TID_"`
2. Bulk-close or bulk-delete (depending on your sandbox policy)
3. Delete `data/jira-config.json` if you want to reset config
4. Delete `data/defects.json` to reset the local registry
5. Truncate `data/dismissed-defects.ndjson` to reset dismissal history
