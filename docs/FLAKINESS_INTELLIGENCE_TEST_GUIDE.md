# Flakiness Intelligence — Manual Test Guide

**Feature:** Flakiness Intelligence + Auto-Quarantine  
**Version:** v1.0  
**Platform:** qa-agent-platform-dev (http://localhost:3003)  
**Date:** 2026-04-26  
**Purpose:** Complete test coverage for manual QA verification

---

## Prerequisites

Before starting any test section:

1. Log in to http://localhost:3003
2. Have at least one Project and one Suite configured with test scripts
3. Have run that suite at least once (so run history exists in `results/`)
4. Know your Project ID and Suite ID (visible in the URL when you open a suite)

---

## Section 1 — Flaky Tests Tab: Basic Rendering

### TC-01: Tab renders when no project selected

**Steps:**
1. Open the platform, do NOT select any project
2. Click the **Flaky Tests** tab

**Expected:**
- Tab content shows: "Select a project to analyse flaky tests."
- No table, no summary bar, no filter tabs visible

---

### TC-02: Tab renders when project selected but no run history

**Steps:**
1. Select a project that has never been run
2. Click the **Flaky Tests** tab

**Expected:**
- Loading spinner/message appears briefly
- Empty state shows: "No flaky tests detected" with ✅ icon
- "All tests are consistent." subtitle

---

### TC-03: Tab renders with run history — insufficient data per test

**Steps:**
1. Select a project with a suite that has been run fewer than 5 times
2. Click the **Flaky Tests** tab

**Expected:**
- Tests appear in the table with **Status = "Insufficient"**
- Rows are slightly dimmed (opacity 0.5)
- Score column shows "—"
- Confidence column shows "—"
- Category column shows "—"
- Action button is absent for insufficient-data rows
- Filter tab "Insufficient Data" shows these tests when clicked

---

### TC-04: Tab renders with enough run history — evaluated tests

**Steps:**
1. Select a project with a suite run 5+ times
2. Click the **Flaky Tests** tab

**Expected:**
- Tests show **numeric flake score** (e.g., 0.12)
- Confidence shows "High", "Med", or "Low"
- Trend sparkline shows P/F letters in green/red
- Category column shows a classification (timing/network/locator/assertion/environment/unknown)
- "Quarantine" action button appears

---

### TC-05: Suite filter dropdown

**Steps:**
1. Select a project with multiple suites
2. Navigate to Flaky Tests tab
3. Open the **Suite** dropdown — verify all suites for the project are listed
4. Select one suite
5. Observe the results

**Expected:**
- Dropdown lists all suites for the project plus "All Suites" option
- Selecting a specific suite filters the table to only that suite's tests
- Re-selecting "All Suites" shows all tests

---

### TC-06: Sort dropdown

**Steps:**
1. Navigate to Flaky Tests tab with at least 3 evaluated tests
2. Change sort to **Score ▼**
3. Change sort to **Confidence**
4. Change sort to **Recent Failures**
5. Change sort to **Name**

**Expected:**
- Score ▼: highest score at top
- Confidence: highest confidence score at top
- Recent Failures: most recent failures at top
- Name: alphabetical A→Z

---

### TC-07: Top 10 toggle

**Steps:**
1. Load Flaky Tests tab with more than 10 tests
2. Click **Top 10** button

**Expected:**
- Button becomes highlighted/active
- Table truncates to 10 rows
- Summary bar still shows total count across all tests

3. Click **Top 10** again

**Expected:**
- All tests shown again
- Button returns to inactive state

---

### TC-08: Filter tabs

**Steps:**
1. Load Flaky Tests tab with a mix of evaluated, quarantined, insufficient tests
2. Click **Flagged** tab

**Expected:** Only tests with `shouldQuarantine=true` AND not yet quarantined

3. Click **Quarantined** tab

**Expected:** Only tests with active quarantine status

4. Click **Insufficient Data** tab

**Expected:** Only tests with insufficient run history

5. Click **All** tab

**Expected:** All tests shown

---

### TC-09: Summary bar content

**Steps:**
1. Load Flaky Tests tab

**Expected summary bar shows:**
- Total test count
- "X quarantined" (in red/orange)
- "X flagged" (in yellow)

---

### TC-10: Refresh button

**Steps:**
1. Load Flaky Tests tab
2. Run the suite once more (from another tab)
3. Come back to Flaky Tests tab and click **↻ Refresh**

**Expected:**
- Data reloads
- Any newly flagged tests appear
- No full page reload

---

## Section 2 — Expanded Row Detail

### TC-11: Expand row by clicking test name row

**Steps:**
1. Click on any test row (not on the Action button, click the row itself)

**Expected:**
- Expanded detail section slides open below the row
- Shows sections: Decision, Signals (if any), History (last 10), Classification
- Click again → detail collapses

---

### TC-12: Decision section content

**Steps:**
1. Expand a row for an evaluated test

**Expected Decision section:**
- Shows: "Flake Score: 0.XX  Threshold: 0.3  [eligible/below threshold label]"
- Shows: "Confidence: High/Med/Low · Last run: Xh ago · Last failure: Xh ago"
- If score ≥ 0.30: shows "✔ Eligible for auto-quarantine"
- If score < 0.30: shows "Below threshold (0.3)"

---

### TC-13: History sparkline in expanded row

**Steps:**
1. Expand any evaluated test row

**Expected:**
- "History (last 10)" section shows P/F letters
- P = green, F = red
- Letters are spaced out clearly
- If all passes: all green P's
- If all failures: all red F's
- Mix of P/F for genuinely flaky test

---

### TC-14: Signals section — timing signals

**Steps:**
1. Find a test that has timed out in recent failures (error message contains "timeout" or "timed out")
2. Expand its row

**Expected Signals section:**
- Shows "· Timeout detected"
- If the failing duration was > 1.5x baseline: shows "· Avg failure duration: Xs (baseline p95: Ys)"
- Classification shows "Primary: timing"

---

### TC-15: Signals section — network signals

**Steps:**
1. Find a test with network errors (ECONNRESET, fetch failed, 5xx in error)
2. Expand its row

**Expected:**
- Shows "· Network error detected (ECONNRESET / fetch failed)"
- Classification primary: network

---

### TC-16: Signals section — locator signals

**Steps:**
1. Find a test with "element not found" or "selector" in error message
2. Expand its row

**Expected:**
- Shows "· Locator instability detected"
- Classification primary: locator
- Action hint: "Locator may be unstable — review selector or add self-healing"

---

### TC-17: Classification + action hint

**Steps:**
1. Expand any evaluated test row with a classification

**Expected Classification section:**
- Shows: "Primary: [category] (XX%)"
- If secondary exists: "· Secondary: [category]"
- If dominant category computed: "Dominant cause: [category] (N/M recent failures)"
- Action hint in yellow: "💡 [relevant hint text]"

**Action hint mapping to verify:**
| Category | Expected Hint |
|---|---|
| timing | "Consider increasing waitForResponse or page load timeout" |
| network | "Check API stability — test may need retry logic or mock" |
| locator | "Locator may be unstable — review selector or add self-healing" |
| assertion | "Data dependency likely — check test isolation or seed data" |
| environment | "Browser crash signal — check agent memory/resource limits" |
| unknown | "Investigate error patterns — insufficient signal for auto-classification" |

---

### TC-18: Expanded row for insufficient-data test

**Steps:**
1. Click on a row showing "Insufficient" status

**Expected:**
- Expands to show: "Insufficient data — need ≥5 runs to compute flake score."
- No score, no signals, no classification shown

---

## Section 3 — Score Colour Coding

### TC-19: Score colour thresholds

**Steps:**
1. Find tests with different score ranges
2. Observe the Score column

**Expected:**
| Score | Colour |
|---|---|
| ≥ 0.30 (above threshold) | Red + ↑ arrow |
| 0.25–0.29 (within 0.05 of threshold) | Yellow |
| < 0.25 (well below threshold) | Green |

---

### TC-20: Status column colour coding

**Expected:**
| Status | Label | Colour |
|---|---|---|
| Quarantined | "Quarantined" | Red |
| Flagged (score ≥ threshold, not quarantined) | "Flagged" | Yellow |
| Active (healthy) | "Active" | Green |
| Insufficient | "Insufficient" | Grey |

---

### TC-21: NEW badge for recently quarantined tests

**Steps:**
1. Manually quarantine a test (see Section 4)
2. Reload the Flaky Tests tab within 24 hours

**Expected:**
- Small green "NEW" badge appears next to the test name
- Badge disappears after 24 hours have passed since quarantine

---

### TC-22: Auto vs Manual quarantine badge

**Steps:**
1. Have at least one auto-quarantined test and one manually quarantined test

**Expected:**
- Auto-quarantined: shows "⛔ Auto" badge next to test name
- Manually quarantined: shows "⛔ Manual" badge

---

## Section 4 — Manual Quarantine and Restore

### TC-23: Manually quarantine a test

**Steps:**
1. Find an evaluated test that is NOT quarantined (Status = Active or Flagged)
2. Click the **Quarantine** button in the Action column
3. Confirm the dialog: "This will exclude the test from suite pass/fail. Continue?"

**Expected:**
- Test status changes to "Quarantined" (red)
- "⛔ Manual" badge appears
- Toast notification: "Test quarantined."
- Table refreshes automatically
- Action button changes from "Quarantine" to "Restore"

---

### TC-24: Cancel quarantine confirmation dialog

**Steps:**
1. Click **Quarantine** button for a test
2. Click **Cancel** in the confirmation dialog

**Expected:**
- Test status unchanged
- No toast appears
- No data change

---

### TC-25: Manually restore a quarantined test

**Steps:**
1. Find a quarantined test (Status = Quarantined)
2. Click the **Restore** button
3. Confirm the dialog

**Expected:**
- Toast: "Test restored from quarantine."
- Test status changes from "Quarantined" to its natural state
- Badge removed
- Action button changes back to "Quarantine"

---

### TC-26: Restore via expanded row button

**Steps:**
1. Click on a quarantined test row to expand it
2. Scroll to the Quarantine Status block at bottom of expanded section
3. Click **Restore Manually** button inside the expanded section

**Expected:**
- Same behaviour as TC-25

---

### TC-27: Quarantine status block in expanded row

**Steps:**
1. Expand a quarantined test row

**Expected quarantine block:**
- "⛔ Quarantine Status: Active" header in red
- "Quarantined: [date/time] (auto)" or "(manual)"
- "Reason: fail_rate=0.XX >= threshold=0.XX" for auto-quarantined
- "Reason: manual" for manually quarantined
- "✔ Eligible for auto-promote" OR "Not yet eligible for auto-promote"
- "Restore Manually" button

---

## Section 5 — Auto-Quarantine (Post-Run)

### TC-28: Auto-quarantine triggers after a suite run

**Pre-condition:** A test has failed in ≥ 30% of its last 5+ runs within 14 days.

**Steps:**
1. Run the suite that contains the flaky test
2. Wait for the run to complete
3. Navigate to Flaky Tests tab and click Refresh (or reload the page)

**Expected:**
- The test now shows Status = "Quarantined"
- "⛔ Auto" badge visible
- In `data/quarantine.json` (if you have file access): entry exists with `autoQuarantined: true`
- In the execution report for that run: Quarantined Tests section shows the test

---

### TC-29: Auto-quarantine does NOT trigger below threshold

**Pre-condition:** A test that has failed in only 1 of 5 runs (20% fail rate, below 30% threshold).

**Steps:**
1. Run the suite
2. Check Flaky Tests tab

**Expected:**
- Test shows Status = "Active" (not quarantined)
- Score < 0.30 shown in green
- No quarantine badge

---

### TC-30: Auto-quarantine hysteresis — already quarantined test with borderline score

**Pre-condition:** A test is already quarantined with threshold = 0.30. After some passes, its fail rate drops to 0.27 (below 0.30 but above 0.25).

**Steps:**
1. Run the suite
2. Check Flaky Tests tab

**Expected:**
- Test STAYS quarantined (hysteresis threshold = 0.30 - 0.05 = 0.25 applies)
- No auto-promote yet (0.27 > 0.25)

**Purpose:** Prevents thrashing where a test oscillates in/out of quarantine.

---

### TC-31: Auto-quarantine cooldown prevents rapid re-quarantine

**Pre-condition:** A test was just quarantined this run.

**Expected behaviour (observable via quarantine.json or multiple runs):**
- The same test is NOT immediately re-evaluated for quarantine in the next 3 runs
- After 3+ runs have passed, it can be re-evaluated

---

## Section 6 — Auto-Promote (Recovery)

### TC-32: Auto-promote triggers after consistent passes

**Pre-condition:** An auto-quarantined test (not manually quarantined). It has passed in the last 10 runs with pass rate ≥ 95%, and the last 3 runs all passed.

**Steps:**
1. Run the suite repeatedly until the test accumulates 10 clean runs
2. After the qualifying run, navigate to Flaky Tests tab

**Expected:**
- Test is no longer quarantined
- Status returns to "Active" or "Flagged" depending on current score
- Toast in the run log: "Test restored from quarantine after clean runs." (visible in server log)

---

### TC-33: Auto-promote does NOT trigger for manually quarantined tests

**Pre-condition:** A test was manually quarantined (autoQuarantined = false).

**Steps:**
1. Run the suite 10+ times with the test passing every time

**Expected:**
- Test remains quarantined
- Auto-promote does NOT fire for manually quarantined tests
- Only manual restore can release it

---

### TC-34: Auto-promote does NOT trigger with insufficient recent runs

**Pre-condition:** Auto-quarantined test. Only 2 recent runs in the recentWindowDays (< minRecentRuns=3).

**Expected:**
- Even if the last 10 runs all passed, auto-promote is blocked
- The "Not yet eligible for auto-promote" label shows in the expanded quarantine block

---

## Section 7 — Quarantine Budget

### TC-35: Budget tracking in summary bar

**Steps:**
1. Manually quarantine 3 tests for a suite
2. Run the suite — make sure the quarantined tests fail during this run
3. Navigate to Flaky Tests tab

**Expected summary bar:**
- "3 quarantined" count shown
- Budget indicator visible

---

### TC-36: Budget does NOT fail pipeline below limit

**Pre-condition:** Budget = 5 (default). 3 quarantined tests fail in a run.

**Expected:**
- Run completes normally
- Suite result = pass (assuming non-quarantined tests all pass)
- 3 quarantined failures are logged but don't affect suite result

---

### TC-37: Budget DOES fail pipeline when exceeded

**Pre-condition:** Budget = 5 (default). 6 quarantined tests fail in a single run.

**Expected:**
- Run completes but suite is marked as failed
- Server log shows: `[budget] Quarantined failures this run: 6`
- This protects against "everything quarantined so pipeline always green"

**Note:** This is difficult to test manually without engineering a scenario with 6+ failing quarantined tests. Confirm via server log at minimum.

---

## Section 8 — Execution Report: Quarantined Tests Section

### TC-38: Quarantined section hidden when no quarantined tests in run

**Steps:**
1. Open an execution report for a run with no quarantined tests
2. Click **View Report** from execution history

**Expected:**
- No "Quarantined Tests" section visible in the report
- Report shows normal pass/fail counts only

---

### TC-39: Quarantined section visible when quarantined tests exist

**Steps:**
1. Quarantine at least one test (Section 4)
2. Run the suite
3. Open the execution report for that run

**Expected:**
- "⛔ Quarantined Tests (N) — excluded from pass/fail" collapsible section appears
- Click it to expand
- Shows table: Test Name | Result | Duration
- Each quarantined test shows:
  - If it passed: "PASSED (quarantined)" in green + "(quarantined)" label
  - If it failed: "FAILED (quarantined)" in red + "(quarantined)" label
- Footer shows budget message:
  - "X quarantined failure(s) this run — these were NOT counted toward suite failure."
  - OR "All quarantined tests passed this run."

---

### TC-40: Quarantined test result does NOT affect suite summary in report

**Steps:**
1. Quarantine 2 tests
2. Run suite — those 2 tests fail, all others pass
3. Open execution report

**Expected:**
- Suite result header: PASSED (assuming non-quarantined tests all passed)
- Passed/Failed counts do NOT include quarantined test results
- Quarantined section shows the 2 failed tests separately

---

## Section 9 — Suite Settings: Flakiness Config Panel

### TC-41: Config panel visible in suite edit modal

**Steps:**
1. Navigate to Suites page
2. Click Edit (pencil icon) on any suite
3. Scroll down in the modal

**Expected:**
- "Flakiness Intelligence" section visible below other suite settings
- Inputs: threshold, min runs, budget, pass rate
- Project default hint shown next to threshold (e.g., "(Project default: 30%)")
- "Save Flakiness Config" button and "Reset to Default" button
- Preset dropdown: Custom / Smoke (20%) / Regression (30%) / E2E (40%)

---

### TC-42: Load current config values when modal opens

**Steps:**
1. Open suite edit modal for a suite

**Expected:**
- Inputs pre-filled with current effective values
- If no suite-level overrides: shows project defaults
- Threshold shown as percentage (e.g., 30 for 0.30)

---

### TC-43: Apply a preset

**Steps:**
1. Open suite edit modal
2. Select **Smoke (20%)** from the preset dropdown

**Expected:**
- Threshold input immediately changes to "20"
- Other inputs unchanged
- You still need to click "Save Flakiness Config" to persist

3. Select **E2E (40%)**

**Expected:**
- Threshold changes to "40"

---

### TC-44: Save flakiness config — valid values

**Steps:**
1. Open suite edit modal
2. Set threshold to "25"
3. Set min runs to "3"
4. Set quarantine budget to "3"
5. Set auto-promote pass rate to "90"
6. Click **Save Flakiness Config**

**Expected:**
- Toast: "Flakiness config saved."
- Reopen the modal — values persist at 25, 3, 3, 90
- GET /api/flaky/config?projectId=X&suiteId=Y now returns threshold=0.25

---

### TC-45: Save flakiness config — invalid threshold

**Steps:**
1. Open suite edit modal
2. Set threshold to "0" (invalid — must be > 0)
3. Click **Save Flakiness Config**

**Expected:**
- Toast: "Save failed: threshold must be in (0, 1]"
- No data saved

---

### TC-46: Save flakiness config — invalid pass rate

**Steps:**
1. Set auto-promote pass rate to "101" (> 100)
2. Click **Save Flakiness Config**

**Expected:**
- Error toast about autoPromoteMinPassRate

---

### TC-47: Reset to default

**Steps:**
1. Save a custom threshold of "20" for a suite (TC-44)
2. Reopen the modal
3. Click **Reset to Default**
4. Confirm the dialog

**Expected:**
- Toast: "Reset to project defaults."
- Threshold input reloads to project default value (30%)
- Suite-level override is removed

---

### TC-48: Config inheritance — suite overrides project

**Setup:** Project default threshold = 30%. Suite override = 20%.

**Steps:**
1. GET http://localhost:3003/api/flaky/config?projectId=X&suiteId=Y (with auth cookie)

**Expected JSON:**
```json
{
  "effective": { "threshold": 0.20, ... },
  "projectDefaults": { "threshold": 0.30 },
  "suiteOverrides": { "threshold": 0.20 }
}
```

---

### TC-49: Config inheritance — suite with no overrides uses project default

**Setup:** Suite has no flakinessOverrides set.

**Steps:**
1. GET /api/flaky/config?projectId=X&suiteId=Y

**Expected JSON:**
```json
{
  "effective": { "threshold": 0.30, ... },
  "projectDefaults": { "threshold": 0.30 },
  "suiteOverrides": null
}
```

---

## Section 10 — API Endpoint Tests (Browser DevTools or curl)

Open browser DevTools → Network tab, or use curl with session cookie.

### TC-50: GET /api/flaky — requires auth

**Steps:**
```
GET http://localhost:3003/api/flaky?projectId=abc
```
Without session cookie.

**Expected:** HTTP 401

---

### TC-51: GET /api/flaky — missing projectId

**Steps:**
```
GET http://localhost:3003/api/flaky
```
With valid session.

**Expected:** HTTP 400 `{ "error": "projectId required" }`

---

### TC-52: GET /api/flaky — valid response shape

**Steps:**
```
GET http://localhost:3003/api/flaky?projectId=<valid-id>&limit=10&sort=flakeScore
```

**Expected response shape:**
```json
{
  "tests": [
    {
      "testId": "TID_...",
      "testName": "...",
      "suiteId": "...",
      "evaluationState": "evaluated" | "insufficient_data",
      "flakeScore": 0.12,
      "failRate": 0.10,
      "confidence": 0.85,
      "isQuarantined": false,
      "classification": { "primary": "timing", "primaryConfidence": 0.6 },
      "signals": { "timeout": false, ... },
      "recentRunsPreview": [...],
      "lastRunAt": "2026-04-26T...",
      "scoreVersion": "v1.0"
    }
  ],
  "total": 5,
  "offset": 0,
  "limit": 10
}
```

---

### TC-53: GET /api/flaky/summary

**Expected:**
```json
{ "quarantined": 2, "budgetLimit": 5 }
```

---

### TC-54: POST /api/flaky/quarantine — missing fields

```
POST /api/flaky/quarantine
Body: { "suiteId": "abc" }
```

**Expected:** HTTP 400 `{ "error": "suiteId and testId required" }`

---

### TC-55: POST /api/flaky/quarantine — already quarantined

**Steps:**
1. Quarantine a test via the UI
2. POST /api/flaky/quarantine with the same suiteId + testId

**Expected:** HTTP 200 `{ "ok": true, "alreadyQuarantined": true }`

---

### TC-56: POST /api/flaky/restore — not currently quarantined

**Steps:**
```
POST /api/flaky/restore
Body: { "suiteId": "abc", "testId": "TID_xyz" }
```
For a test that is not active in quarantine.

**Expected:** HTTP 200 `{ "ok": true }` (idempotent — no error, just a no-op)

---

## Section 11 — Edge Cases

### TC-57: Test with zero failures — all passes

**Pre-condition:** A test that has passed 10/10 runs.

**Expected:**
- flakeScore = 0.00 (green)
- Classification = "unknown" (no error signals)
- shouldQuarantine = false
- No action hint shown (or unknown hint)

---

### TC-58: Test with 100% failures

**Pre-condition:** A test that has failed 5/5 runs (consistently failing, not flaky).

**Expected:**
- failRate ≈ 1.0 (high due to decay weights)
- flakeScore ≈ 0.70+ (high)
- But alternationIndex ≈ 0 (no transitions — always failing = consistent failure, not flaky)
- Score may be high but classification could be "assertion" or similar
- Test would be quarantine-eligible (fail rate above threshold)

**Note:** This is a "consistently failing" test, not a "flaky" test. The platform still quarantines it since it's blocking the pipeline. This is expected behaviour.

---

### TC-59: Test renamed between runs

**Pre-condition:** Run a test named "Login test", then rename it to "Login flow test", run again.

**Expected:**
- The renamed test appears as a NEW entry in the flaky table (new testId)
- The old entry may still appear with the old name and old history
- Score is not mixed between old and new name

**Note:** testId is a hash of suiteId + testName. Rename = new testId = fresh history. This is expected.

---

### TC-60: Empty results directory

**Steps:**
1. Select a project that exists in projects.json but has no run files in results/

**Expected:**
- Flaky Tests tab shows empty state (✅ "No flaky tests detected")
- API returns `{ "tests": [], "total": 0 }`
- No errors in server log

---

### TC-61: Single run (below minRuns=5)

**Pre-condition:** Suite has been run exactly once.

**Expected:**
- All tests show evaluationState = "insufficient_data"
- Score = "—"
- Status = "Insufficient"

---

### TC-62: Exactly 5 runs — boundary condition

**Pre-condition:** Suite has been run exactly 5 times (minRuns = 5).

**Expected:**
- Tests ARE evaluated (5 = minRuns, so it qualifies)
- If 2/5 failed = 40% fail rate → above 30% threshold → Flagged

---

### TC-63: All runs outside time window (windowDays=14)

**Pre-condition:** A test has 10 runs, all older than 14 days.

**Expected:**
- evaluationState = "insufficient_data" (no runs in window)
- Test appears but can't be scored

---

### TC-64: Flaky Tests tab when switching projects

**Steps:**
1. Select Project A, view Flaky Tests tab, data loads
2. Without navigating away, switch to Project B in the project dropdown

**Expected:**
- Tab reloads data for Project B
- Project A's tests no longer shown
- Suite filter dropdown updates to Project B's suites

---

### TC-65: Score version mismatch (needsReevaluation)

**Context:** If `data/quarantine.json` has an entry with `scoreVersion: "v0.9"` but the engine is now `v1.0`.

**Expected:**
- `needsReevaluation: true` in the API response for that test
- UI may show this test differently (no UI indicator in v1, but API is correct)

---

### TC-66: Concurrent quarantine + restore of same test

**Steps:**
1. Quarantine a test (TC-23)
2. Immediately click Restore (TC-25) before the page refreshes

**Expected:**
- First action completes
- Second action completes
- Final state = restored
- No data corruption in quarantine.json

---

### TC-67: Large number of tests (pagination)

**Pre-condition:** Suite with 60+ tests and 5+ runs each.

**Steps:**
1. GET /api/flaky?projectId=X&limit=50&offset=0
2. GET /api/flaky?projectId=X&limit=50&offset=50

**Expected:**
- First call: 50 results, total = 60+ (not truncated)
- Second call: remaining results
- Sorting is consistent across pages (server sorts before paginate)

---

### TC-68: Config validation — windowDays ≤ recentWindowDays

**Steps:**
1. PUT /api/flaky/config with:
```json
{ "projectId": "X", "overrides": { "windowDays": 7, "recentWindowDays": 7 } }
```

**Expected:** HTTP 400 `{ "errors": ["windowDays must be > recentWindowDays"] }`

---

### TC-69: Config validation — minRunsSinceQuarantine = 0

**Steps:**
1. PUT /api/flaky/config with `"minRunsSinceQuarantine": 0`

**Expected:** HTTP 400 `{ "errors": ["minRunsSinceQuarantine must be >= 1"] }`

---

### TC-70: GET /api/flaky/config — suite with no project

**Steps:**
1. GET /api/flaky/config (no projectId param)

**Expected:** HTTP 400 `{ "error": "projectId required" }`

---

## Section 12 — Negative / Security Tests

### TC-71: Quarantine requires Editor role

**Steps:**
1. Log in as a **Viewer** user (read-only role)
2. Try to click "Quarantine" button

**Expected:** Button may be hidden OR clicking results in HTTP 403 response

---

### TC-72: Restore requires Editor role

Same as TC-71 but for Restore action.

---

### TC-73: Config save requires Editor role

**Steps:**
1. Log in as a Viewer
2. Try to PUT /api/flaky/config

**Expected:** HTTP 403

---

### TC-74: XSS in test name

**Pre-condition:** Test script named `<script>alert(1)</script>`.

**Steps:**
1. Run a suite containing that test
2. View Flaky Tests tab

**Expected:**
- Test name is displayed as literal text `<script>alert(1)</script>`
- No alert box fires
- `escHtml()` function in the UI correctly encodes the name

---

### TC-75: Very long test name (200+ characters)

**Pre-condition:** Test with a very long name.

**Expected:**
- Name column truncates with `word-break: break-word`
- No table layout breakage
- Full name visible in expanded row

---

## Section 13 — Integration Smoke Tests

### TC-76: Full auto-quarantine end-to-end flow

**Steps:**
1. Create a test script that reliably fails (e.g., assert false)
2. Run the suite 5 times — test fails every time
3. Check Flaky Tests tab

**Expected:**
- Test is auto-quarantined (fail_rate = 1.0 >> 0.30 threshold)
- Status = "Quarantined", "⛔ Auto" badge
- Execution report for the 5th run shows Quarantined Tests section

4. Fix the test to always pass
5. Run the suite 10 more times

**Expected:**
- After 10 clean runs: test auto-promotes
- Status returns to "Active"
- Score drops toward 0

---

### TC-77: Full manual quarantine + restore cycle

**Steps:**
1. Quarantine any test manually (TC-23)
2. Verify it shows in Flaky Tests tab as "⛔ Manual"
3. Verify it shows in the next run's execution report under Quarantined Tests
4. Restore it (TC-25)
5. Run the suite again
6. Verify the test is no longer in the Quarantined Tests section of the new run

---

### TC-78: Suite config affects quarantine threshold

**Steps:**
1. Set a suite's threshold to 20% (TC-44, set to 20)
2. Find a test with fail rate around 25% (below default 30%, above new 20%)
3. Run the suite

**Expected:**
- Test gets auto-quarantined (25% > 20% threshold)
- Would NOT be quarantined with default 30% threshold
- Confirms per-suite config is working end-to-end

---

---

## Section 14 — Business Scenarios

These test cases simulate real situations a QA team or SDET Lead would face in production. Each scenario starts from a business problem, not a feature checkbox.

---

### BS-01: Nightly build keeps failing — team can't tell if it's a real bug or a flaky test

**Business problem:** The CI pipeline has been failing every other night for two weeks. Engineers are ignoring the failure because "it always comes back green in the morning." Leadership wants confidence the pipeline signal is trustworthy.

**Personas involved:** SDET Lead, Dev Team, CI/CD Pipeline

**Journey:**

1. Log in as SDET Lead
2. Navigate to **Flaky Tests** tab → select the project used by the nightly pipeline
3. Sort by **Score ▼**

**Expected:**
- The suspect test appears near the top with a high flake score (e.g., 0.65)
- Status shows **"Flagged"** or **"Quarantined"** (if auto-quarantine already fired)
- Trend sparkline shows alternating P/F/P/F/F pattern — confirms intermittent failure
- Classification shows the likely cause (e.g., "timing" or "network")
- Action hint gives a concrete remediation step

4. Click the test row to expand detail
5. Check the Signals section — confirm "Timeout detected" or "Network error detected"
6. Share the action hint with the dev team: "Consider increasing waitForResponse or page load timeout"

**Business outcome to verify:**
- Team now has **evidence** the test is flaky (not a real bug)
- They can quarantine it while the fix is investigated — pipeline green again
- Score and classification give the developer a starting point for the fix

---

### BS-02: Pre-release freeze — team needs a clean pipeline before go-live

**Business problem:** Release is tomorrow. The QA lead needs to ensure the pipeline only fails for real defects, not noise from known-flaky tests. There is no time to fix the flaky tests before the release.

**Personas involved:** QA Lead, Release Manager

**Journey:**

1. Navigate to **Flaky Tests** tab → select the release project
2. Click **Flagged** filter tab — see all tests with score ≥ threshold but not yet quarantined
3. For each flagged test, expand the row and review the classification and action hint
4. For tests with **known intermittent issues** (timing, network, environment): click **Quarantine** → confirm

**Expected after quarantining all flagged tests:**
- Summary bar shows "0 flagged"
- All previously flagged tests now show "⛔ Manual" or "⛔ Auto" status
- Run the suite — if those tests fail, they appear in the Quarantined Tests section of the execution report but do NOT fail the pipeline

5. Open the execution report after the pre-release run
6. Verify the **Quarantined Tests** section shows the excluded tests
7. Verify the suite result header shows **PASSED** (assuming real tests pass)

**Business outcome to verify:**
- Release pipeline is protected from flaky noise
- Quarantined tests are still **visible and auditable** — not silently hidden
- Release Manager can see exactly what was excluded and why

---

### BS-03: New SDET joins the team — investigates a test that "always seems to fail on Fridays"

**Business problem:** A new team member noticed a specific checkout test fails more often in end-of-week runs. They don't know if it's load-related, an environment issue, or something else. They need to investigate without touching the code.

**Personas involved:** New SDET

**Journey:**

1. Log in and navigate to **Flaky Tests** tab
2. Select the e-commerce project and the checkout suite
3. Find the checkout test in question (use Name sort or suite filter)
4. Click the row to expand detail

**Expected investigation flow:**
- **Decision section:** Shows current flake score, whether it's above/below threshold, and confidence level
- **History (last 10):** Sparkline shows P/F/F/P/P/F pattern — confirms intermittent pattern
- **Signals section:**
  - If timing-related: "Timeout detected", "Avg failure duration: 12.3s (baseline p95: 4.2s)"
  - If environment: "Browser crash signal — check agent memory/resource limits"
- **Classification:** Primary cause shown (e.g., "timing" with 80% confidence)
- **Action hint:** "Consider increasing waitForResponse or page load timeout"
- **Dominant cause:** "Dominant cause: timing (4/6 recent failures)"

5. SDET makes a note to review page load timeout on the checkout page
6. SDET decides to manually quarantine while investigating: clicks **Quarantine** → confirms

**Business outcome to verify:**
- New SDET got a full diagnosis **without reading logs or asking colleagues**
- Action hint points to the right place in the code
- Quarantining the test protects the pipeline while the fix is being worked on

---

### BS-04: SDET Lead configures different thresholds for Smoke vs E2E suites

**Business problem:** The team runs three suite types. The smoke suite runs on every commit and must be very strict (any flakiness = problem). The E2E suite runs nightly and some tests are inherently more environment-sensitive — a 40% threshold is acceptable before quarantining.

**Personas involved:** SDET Lead

**Journey:**

1. Navigate to **Suites** page
2. Edit the **Smoke** suite → scroll to Flakiness Intelligence section
3. Select preset **"Smoke (20%)"** → threshold auto-fills as 20
4. Click **Save Flakiness Config**
5. Edit the **Regression** suite → select **"Regression (30%)"** → Save
6. Edit the **E2E** suite → select **"E2E (40%)"** → Save

**Verification:**

7. Open the suite edit modal for the **Smoke** suite again
   - **Expected:** Threshold shows 20, "(Project default: 30%)" hint visible
8. Open E2E suite modal
   - **Expected:** Threshold shows 40

9. GET /api/flaky/config?projectId=X&suiteId=<smoke-id>
   - **Expected:** `effective.threshold = 0.20`, `suiteOverrides.threshold = 0.20`
10. GET /api/flaky/config?projectId=X&suiteId=<e2e-id>
    - **Expected:** `effective.threshold = 0.40`

11. Run a test that has a 25% fail rate in the smoke suite

**Expected:**
- In the smoke suite: test is **Flagged** (25% > 20% threshold)
- In the E2E suite: same test is **Active** (25% < 40% threshold)

**Business outcome to verify:**
- Different suites operate with appropriate sensitivity levels
- Smoke suite is stricter — catches borderline flakiness earlier
- E2E suite tolerates more noise — fewer false-positive quarantines

---

### BS-05: Test was quarantined but the underlying bug is now fixed — team wants to reactivate it

**Business problem:** A login test was auto-quarantined three weeks ago due to a timing issue on the auth service. The auth team has deployed a fix. The QA lead wants to restore the test and verify it stays stable.

**Personas involved:** QA Lead, Dev Team

**Journey:**

1. Navigate to **Flaky Tests** tab → click **Quarantined** filter tab
2. Find the login test
3. Expand the row — confirm "Quarantine Status: Active (auto)" and review the original reason
4. QA Lead is satisfied the fix is deployed → clicks **Restore Manually** in the expanded section
5. Confirms the dialog

**Expected immediately after restore:**
- Toast: "Test restored from quarantine."
- Test disappears from the Quarantined filter
- Test reappears under "All" with its current score (still potentially high from history)

6. Run the suite 3 times — test passes every time
7. Navigate back to Flaky Tests tab — check the test's trend sparkline

**Expected after 3 clean runs:**
- Sparkline shows: ...F/F/F/P/P/P (old failures then new passes)
- Score is decreasing (exponential decay weights recent passes more heavily)
- If after 10 runs the pass rate ≥ 95% and last 3 all pass: auto-promote would also have triggered (manual restore was faster in this case)

8. QA Lead monitors for 2 more weeks to confirm the test stays stable

**Business outcome to verify:**
- Team can confidently reactivate a fixed test
- The score decreases naturally as clean runs accumulate — no manual score reset needed
- If the test becomes flaky again, auto-quarantine will catch it automatically in the next cycle

---

### BS-06: Manager review — how many tests are quarantined and is the pipeline trustworthy?

**Business problem:** An engineering manager wants a quick health check: how many tests are currently excluded from pipeline results, and is the quarantine budget being abused?

**Personas involved:** Engineering Manager (read-only or editor role)

**Journey:**

1. Log in → navigate to **Flaky Tests** tab
2. Read the **summary bar** at the top

**Expected summary bar gives immediate answers:**
- "12 tests · 3 quarantined · 1 flagged · Budget: 3/5"
- Manager can immediately see: 3 tests excluded, 1 more about to be excluded, budget is 60% used

3. Click **Quarantined** filter tab
4. Review each quarantined test — note the "auto" vs "manual" badge and the quarantine reason

5. Click on one test to expand — read the Classification and dominant cause

**Expected:**
- Manager can understand WHY each test is quarantined without any technical knowledge of the test code
- "Dominant cause: network (4/5 recent failures)" is business-readable

6. Check if any test is a "budget risk" — if budget used is 4/5, next flaky test will exceed the budget and fail the pipeline

**Business outcome to verify:**
- Manager has full **visibility and auditability** without needing to read logs
- Summary bar is a one-glance health indicator
- No hidden failures — everything excluded is documented with a reason

---

## Section 15 — End-to-End Journeys

These are multi-step flows that cross multiple pages and features of the platform in sequence, simulating a complete working session.

---

### E2E-01: From zero to first auto-quarantine — full new-project setup journey

**Scenario:** A team has just set up a new project on the platform. They configure flakiness settings, run their suite, and observe the first auto-quarantine fire.

**Duration estimate:** 20–30 minutes

**Steps:**

**Phase 1 — Project and Suite Setup**
1. Log in → create a new Project (or use existing)
2. Create a Suite with at least 3 test scripts
3. Configure one test script to intermittently fail (simulate by setting a condition that fails ~40% of runs — e.g., an assertion against a value that changes)
4. Navigate to Suites → Edit the suite → scroll to **Flakiness Intelligence** section
5. Set threshold to **25%** (below default) to make it easier to trigger
6. Set min runs to **5**
7. Click **Save Flakiness Config**
8. Verify toast: "Flakiness config saved."

**Phase 2 — Accumulate Run History**
9. Run the suite **5 times** using the Run button
10. After each run, open the execution report → confirm the quarantine section is NOT visible yet (not enough history or threshold not breached yet)
11. After 5 runs, navigate to **Flaky Tests** tab

**Expected after 5 runs:**
- The intermittent test appears with an evaluated score
- If 2/5 runs failed (40%) → score ≈ 0.30+ → Status = **Flagged** (score ≥ 25% threshold)
- Or if auto-quarantine already fired on the 5th run: Status = **Quarantined**

**Phase 3 — Observe Auto-Quarantine**
12. Run the suite a **6th time** — ensure the flaky test fails in this run
13. After the run completes, navigate to **Flaky Tests** tab → Refresh

**Expected:**
- Test now shows Status = **"Quarantined"** with "⛔ Auto" badge
- Check the execution report for run #6 → Quarantined Tests section visible
- Suite result = **PASSED** (the quarantined failure didn't count)

**Phase 4 — Investigate**
14. Click the quarantined test row to expand
15. Read the Decision, Signals, History, and Classification sections
16. Confirm action hint is relevant to the type of failure you engineered

**Phase 5 — Verify Audit Trail**
17. Open `data/quarantine.json` (if you have file system access)
18. Confirm entry exists: `autoQuarantined: true`, `quarantineReason: "fail_rate=0.XX >= threshold=0.25"`, `scoreVersion: "v1.0"`

**Pass criteria:**
- [ ] Config saved correctly (TC-44 covered)
- [ ] Score computed after 5 runs (TC-62 edge case covered)
- [ ] Auto-quarantine fired on the qualifying run (BS-01 business case covered)
- [ ] Execution report showed Quarantined Tests section (TC-39 covered)
- [ ] Suite passed despite quarantined failure (TC-40 covered)
- [ ] Expanded row shows correct classification and action hint (TC-17 covered)

---

### E2E-02: Full quarantine → fix → restore → stability monitoring journey

**Scenario:** A test is auto-quarantined. The team fixes the underlying issue. They restore the test, monitor it through multiple runs, and confirm it stabilises. This is the complete "detect → quarantine → fix → recover" lifecycle.

**Duration estimate:** 30–45 minutes (includes multiple suite runs)

**Steps:**

**Phase 1 — Starting state: test is auto-quarantined**
1. Start with a test that is already auto-quarantined (or complete E2E-01 first)
2. Navigate to **Flaky Tests** tab → **Quarantined** filter
3. Expand the quarantined test row
4. Note: the quarantine reason, fail rate, and action hint

**Phase 2 — Fix the test (simulate)**
5. Edit the test script to remove the intermittent failure condition (make it always pass)
6. Do NOT restore the quarantine yet — run the suite once to confirm the fix

**Expected after running with the fix:**
- The test passes in the new run
- The test is still quarantined (auto-restore hasn't triggered yet — needs 10 clean runs)
- The execution report shows the test in the Quarantined Tests section: "PASSED (quarantined)"
- Suite result = PASSED

**Phase 3 — Manual restore after confirming the fix**
7. Navigate to **Flaky Tests** tab → find the quarantined test
8. Expand its row → read "Not yet eligible for auto-promote" (only 1 clean run so far)
9. Since you've verified the fix manually, click **Restore Manually** → confirm

**Expected:**
- Toast: "Test restored from quarantine."
- Test removed from Quarantined filter
- Test reappears in All with its current score (still elevated from history)

**Phase 4 — Stability monitoring**
10. Run the suite **5 more times** — test should pass every time
11. After each run, revisit **Flaky Tests** tab and observe the test's score trend

**Expected score progression:**
- After 1 clean run post-restore: score still elevated (old failures weigh heavily)
- After 5 clean runs: score visibly decreasing (exponential decay — recent passes get more weight)
- Trend sparkline shows: F/F/F/P/P/P/P/P/P/P (old failures then long green streak)

12. After 10 total clean runs, navigate to Flaky Tests tab

**Expected:**
- Score approaching 0
- Status = **Active** (green)
- "Eligible for auto-promote" would have shown in the quarantine block IF it were still quarantined

**Phase 5 — Confirm no re-quarantine**
13. Confirm the test does not re-appear as Quarantined or Flagged after the 10 clean runs
14. Check that the minRunsSinceQuarantine cooldown (3 runs) is respected — even after manual restore, if the test had briefly re-failed within 3 runs, it would not have been immediately re-quarantined

**Pass criteria:**
- [ ] Test passed while quarantined — shown in report as "PASSED (quarantined)" (TC-39)
- [ ] Manual restore worked (TC-25)
- [ ] Score decreased over clean runs — decay is working (engine formula)
- [ ] Test did not re-quarantine after manual restore (BS-05 business case)
- [ ] Stability confirmed visually via sparkline

---

### E2E-03: SDET Lead configures per-suite thresholds then validates flakiness decisions differ per suite

**Scenario:** The lead configures three suites with different thresholds (Smoke=20%, Regression=30%, E2E=40%) and verifies that the same test history leads to different quarantine outcomes depending on which suite it runs in.

**Duration estimate:** 15–20 minutes

**Steps:**

**Phase 1 — Configure suite thresholds**
1. Navigate to Suites → Edit **Smoke suite** → Flakiness Intelligence → Preset: Smoke (20%) → Save
2. Edit **Regression suite** → Preset: Regression (30%) → Save
3. Edit **E2E suite** → Preset: E2E (40%) → Save
4. Verify each: re-open each modal and confirm the threshold value persisted

**Phase 2 — Check API confirms inheritance**
5. Open browser DevTools → Network tab
6. Navigate to Flaky Tests tab → select Smoke suite → observe the network call to `/api/flaky?suiteId=<smoke-id>`
7. Repeat for E2E suite
8. In DevTools, find `/api/flaky/config?projectId=X&suiteId=<smoke-id>` (triggered when modal opens)
   - Confirm `effective.threshold = 0.20`
9. Same for E2E: `effective.threshold = 0.40`

**Phase 3 — Validate different quarantine outcomes**
10. Identify (or create) a test with approximately **25% fail rate** (2 failures in 8 runs)
11. Make this test run in all three suites (same script, three suite memberships — or simulate by looking at the Flaky Tests tab per suite)
12. Navigate to Flaky Tests tab:
    - Select **Smoke suite**: test should be **Flagged** (25% > 20% threshold)
    - Select **Regression suite**: test should be **Active** (25% < 30% threshold)
    - Select **E2E suite**: test should be **Active** (25% < 40% threshold)

**Phase 4 — Reset one suite to project default**
13. Edit the **Smoke suite** → Flakiness Intelligence → click **Reset to Default** → confirm
14. Verify toast: "Reset to project defaults."
15. Re-open the modal → threshold should now show 30% (project default)
16. Verify the Flagged test on Smoke suite is no longer flagged (25% < 30%)

**Pass criteria:**
- [ ] Three different thresholds persist correctly (TC-44, TC-47)
- [ ] API confirms config inheritance per suite (TC-48, TC-49)
- [ ] Same test classified differently per suite (BS-04 business case)
- [ ] Reset to default works (TC-47)
- [ ] Flaky Tests tab correctly reflects the threshold change after reset

---

### E2E-04: Manager audit — full visibility check from summary to quarantine.json

**Scenario:** An engineering manager does a monthly audit of flakiness health. They have read-only access and want to verify the system is giving them complete and honest information.

**Duration estimate:** 10 minutes

**Steps:**

**Phase 1 — High-level health check**
1. Log in (as any role with read access)
2. Navigate to **Flaky Tests** tab → select the main project
3. Read the **summary bar** — note: total tests, quarantined count, flagged count

**Expected:**
- Summary bar gives one-line health status without clicking anything

**Phase 2 — Quarantine audit**
4. Click **Quarantined** filter tab
5. For each quarantined test, verify:
   - "Auto" or "Manual" badge is visible (so you know who/what caused the quarantine)
   - Expand the row → Quarantine Status block shows the quarantine date and reason
   - Score + classification confirms the quarantine was justified (high fail rate + clear cause)

6. Look for any test showing **"⛔ Manual"** — this means an engineer manually quarantined it
   - Expand to read the reason — should say "manual" in the reason field
   - Ensure this isn't being abused to hide legitimate failures

**Phase 3 — Flagged tests review**
7. Click **Flagged** filter tab
8. These are tests that SHOULD be quarantined but haven't been yet

**Expected:**
- Score is above the threshold
- If several tests are flagged but not auto-quarantined: check if they haven't accumulated enough runs yet (minRuns=5 check)
- If many tests are flagged: may indicate a systemic environment problem (e.g., infra degradation), not individual test issues

**Phase 4 — Execution report spot-check**
9. Navigate to Execution History → open the most recent run report
10. Scroll to the **Quarantined Tests** section

**Expected:**
- Each quarantined test listed shows its result (PASSED/FAILED) with "(quarantined)" label
- Footer shows how many quarantined failures occurred and that they were NOT counted
- If the run result is PASSED but there are quarantined failures in the section: the manager understands the pipeline is protected but the failures are acknowledged

**Phase 5 — Validate no silent hiding**
11. Count: total quarantined failures visible in the last 5 run reports
12. If more than 5 quarantined failures per run (budget = 5): the suite SHOULD have been marked failed — verify this is the case

**Pass criteria:**
- [ ] Summary bar gives instant health overview (BS-06 business case)
- [ ] Audit trail is complete — every quarantined test has a reason and date (TC-27)
- [ ] Execution reports are honest — quarantined tests visible but excluded (TC-39, TC-40)
- [ ] Budget enforcement is working as a safety net (TC-37)
- [ ] Manager can distinguish auto vs manual quarantines (TC-22)

---

## Test Completion Checklist

| Section | Tests | Status |
|---|---|---|
| 1 — Basic Rendering | TC-01 to TC-10 | ☐ |
| 2 — Expanded Row | TC-11 to TC-18 | ☐ |
| 3 — Score Colours | TC-19 to TC-22 | ☐ |
| 4 — Manual Quarantine/Restore | TC-23 to TC-27 | ☐ |
| 5 — Auto-Quarantine | TC-28 to TC-31 | ☐ |
| 6 — Auto-Promote | TC-32 to TC-34 | ☐ |
| 7 — Budget | TC-35 to TC-37 | ☐ |
| 8 — Execution Report | TC-38 to TC-40 | ☐ |
| 9 — Suite Config Panel | TC-41 to TC-49 | ☐ |
| 10 — API Endpoints | TC-50 to TC-56 | ☐ |
| 11 — Edge Cases | TC-57 to TC-70 | ☐ |
| 12 — Security/Negative | TC-71 to TC-75 | ☐ |
| 13 — Integration | TC-76 to TC-78 | ☐ |
| 14 — Business Scenarios | BS-01 to BS-06 | ☐ |
| 15 — End-to-End Journeys | E2E-01 to E2E-04 | ☐ |

**Total: 78 functional TCs + 6 business scenarios + 4 E2E journeys = 88 test items**

---

## Known Limitations / Not in v1 Scope

- No email/webhook notifications (notification queue exists in server memory, not dispatched in v1)
- No LLM-powered root cause explanation (signals are deterministic, LLM-ready output exists but not wired to nlProvider yet)
- `needsReevaluation` flag computed correctly in API but no UI indicator in v1
- Budget enforcement (TC-37) requires engineering a scenario with 6+ quarantined failing tests simultaneously
