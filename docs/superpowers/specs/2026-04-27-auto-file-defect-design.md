# Auto-File Jira Defect on Test Failure — Design Spec

**Feature:** Auto-File Jira Defect with Human Validation Gate
**Platform:** TestForge (qa-agent-platform)
**Author:** Harmeet Saini
**Version:** v1.0 — 2026-04-27
**Status:** Approved for implementation

---

## Overview

When a test fails in an execution run, surface a `[🐞 File Defect]` action in the Execution Report. Auto-draft a Jira defect with full context (test name, suite, environment, error, stack, screenshot, video, trace, console errors). **Never push to Jira automatically.** A human reviewer (Editor or Admin role) validates the draft, fills the User Story key, and confirms before the ticket is created via Jira REST API.

This is the differentiator versus mabl/Functionize/testRigor: blind auto-filing creates noise from non-AUT issues (script bugs, stale locators, flaky tests, bad data, env failures). TestForge's gate is human-in-the-loop classification.

---

## Constraints

1. **Single Jira template:** field structure and defect workflow are identical across all projects. One global config — not per-project.
2. **Jira-only in v1:** no ADO defect filing (the team uses Jira only).
3. **Defects link to user stories:** the team's practice is to file defects against the parent user story (no test-case entity in Jira).
4. **Credentials in `.env`:** `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` already exist.
5. **Operational config in UI:** project key, issue type, default priority, custom field IDs, auto-close transition, max attachment size — all admin-editable through Notification Settings.
6. **Editor role required** for filing, commenting, dismissing. Admin role for configuration.
7. **No AI pre-classification in v1.** Manual classification only.
8. **No bulk filing in v1.** One defect at a time.
9. **No re-open in v1.** Auto-closed defect that fails again → user files a fresh ticket via dedup flow.

---

## Architecture

Three new components, all additive. No breaking changes.

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/utils/jiraClient.ts                                            │
│  Pure stateless Jira REST wrapper. No DB, no platform state.        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  src/utils/adfBuilder.ts                                            │
│  Pure helper. Assembles Atlassian Document Format from raw inputs.  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  src/ui/server.ts (additive routes + auto-close hook)               │
│  /api/jira/*  — config + connection                                 │
│  /api/defects/* — draft, file, comment, dismiss, history            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  src/ui/public/execution-report.html (additive)                     │
│  - File Defect button on failed rows                                │
│  - Defect modal (draft form, attachments, classify)                 │
│  - Defect badge (Open/Closed) on rows with existing defects         │
└─────────────────────────────────────────────────────────────────────┘

Storage:
  data/jira-config.json         — operational config (admin-edited)
  data/defects.json             — defect registry (testId → defectKey, status, ...)
  data/dismissed-defects.ndjson — append-only "Not a Bug" log

Existing leveraged:
  config.jira.{baseUrl,email,apiToken}  — credentials in .env
  flakinessEngine, locatorHealth        — receive "Not a Bug" feeds
  RunRecord finalization                — hooks the auto-close engine
```

### Data flow — File a defect

```
User clicks [🐞 File Defect] on failed test row
  → POST /api/defects/draft  { runId, testId }
      → server reads RunRecord + TestEvent
      → builds summary + ADF description
      → checks dedup: searchOpenDefectByTestId() in Jira via JQL
      → returns { summary, descriptionADF, attachments[], existingDefect | null }
  → modal opens, fields auto-filled (or "Already filed" banner if dedup hit)
  → user types User Story key (BSM-1826), reviews/edits, clicks [Approve & File]
  → POST /api/defects/file  { ...payload, parentStoryKey }
      → server: jiraClient.createIssue(...) → { key: 'BSM-1842' }
      → server: for each attachment kind: read file → addAttachment()
      → server: append to data/defects.json + update TestEvent.defectKey
      → server: audit log + WS broadcast
  → modal swaps to success view: "✓ Filed as BSM-1842 [Open in Jira ↗]"
  → row badge updates to "🐞 BSM-1842 (Open)"
```

### Data flow — Auto-close on next-run pass

```
Run completes, RunRecord finalized
  → autoCloseHookOnRunComplete(record)
  → for each passed test t:
      → registry.find(d.testId === t.testId
                       AND d.suiteId === record.suiteId
                       AND d.environmentId === record.environmentId
                       AND d.status === 'open')
      → if match: closeDefectAsync(defect, record.runId)
          → jiraClient.transitionIssue(key, config.closeTransitionName)
          → jiraClient.addComment(key, autoCloseADF(runId))
          → defect.status = 'closed', defect.closedAt = now
          → save registry + audit + broadcast
  → on Jira API failure: log warning, leave registry open, retry next run
```

---

## Component 1: `jiraClient.ts` (Pure REST wrapper)

```typescript
interface JiraCredentials {
  baseUrl: string;       // https://pnmx.atlassian.net
  email: string;
  apiToken: string;
}

class JiraClient {
  constructor(creds: JiraCredentials) {}

  // Connection / discovery
  testConnection(): Promise<{ ok: boolean; user?: string; error?: string }>;
  discoverFields(): Promise<JiraField[]>;

  // Issue CRUD
  createIssue(payload: CreateIssuePayload): Promise<{ key: string; id: string; self: string }>;
  getIssue(key: string): Promise<JiraIssue>;
  searchOpenDefectByTestId(testId: string, suiteId: string, projectKey: string): Promise<string | null>;
    // JQL: project={key} AND issuetype={type} AND statusCategory!=Done AND text ~ "TID_xxx"

  // Mutations
  addAttachment(key: string, file: { name: string; buffer: Buffer; mime: string }): Promise<{ id: string }>;
  addComment(key: string, body: ADFNode): Promise<{ id: string }>;
  transitionIssue(key: string, transitionName: string): Promise<void>;
}
```

**Auth:** `Authorization: Basic ${base64(email + ':' + apiToken)}` on every request.

**Error mapping:**
- 401/403 → `JiraAuthError`
- 400 → `JiraValidationError` (includes Jira's per-field errors)
- 404 → `JiraNotFoundError`
- 5xx → `JiraServerError` (retry-eligible)
- Network → `JiraNetworkError`

All errors include `{ code, httpStatus, details, message }` for UI display.

**TestId embedding:** to make `searchOpenDefectByTestId` work, the rendered description always contains the literal `testId` string in the body. JQL `text ~` does indexed full-text search.

---

## Component 2: `adfBuilder.ts` (ADF helper)

Atlassian Document Format is a structured JSON, not markdown. Pure function builds the description payload:

```typescript
function buildDefectDescription(input: {
  testName: string;
  testId: string;          // embedded as searchable text
  suiteName: string;
  projectName: string;
  runTimestamp: string;
  runId: string;
  envName: string;
  envUrl: string;
  browser: string;
  os: string;
  steps: string[];         // executed steps from TestEvent
  errorMessage: string;
  errorDetailFirst5: string;  // first 5 lines of stack
}): ADFNode
```

Returns ADF document with these sections (each as a `heading` h3 + child paragraphs/codeBlocks/orderedLists):

1. **Description** — one paragraph with test name + suite + project + run timestamp + run ID + literal testId line
2. **Precondition** — env name + URL + browser + OS
3. **Steps** — `orderedList` of executed steps
4. **Actual Result** — `codeBlock` of error message + first 5 lines of stack
5. **Expected Result** — empty placeholder paragraph (user fills in modal before submit)

A second pure helper builds the auto-close comment:

```typescript
function buildAutoCloseCommentADF(runId: string, timestamp: string): ADFNode
```

Comment body: "Auto-closed by TestForge — test passed on run {runId} at {timestamp}. Please verify fix is genuine."

---

## Component 3: Server routes

All routes return errors using the standard envelope: `{ error: { code, message, details? } }`.

### Config routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/api/jira/config` | requireAuth | Read mapping config (or null if not set) |
| PUT  | `/api/jira/config` | requireAdmin | Save mapping config + audit log |
| POST | `/api/jira/test`   | requireAdmin | Test connection (returns user email if ok) |
| GET  | `/api/jira/fields` | requireAdmin | Discover Jira fields (for mapping UI) |

### Defect routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/defects/draft`         | requireEditor | Assemble draft (no Jira write) |
| POST | `/api/defects/file`          | requireEditor | Create issue + attachments + persist |
| POST | `/api/defects/comment`       | requireEditor | Add comment to existing defect |
| POST | `/api/defects/dismiss`       | requireEditor | Log "Not a Bug" classification |
| GET  | `/api/defects/by-test/:testId` | requireAuth  | List defect history for a testId |

### `POST /api/defects/file` — detailed flow

```
1. Validate request: runId, testId, parentStoryKey (regex /^[A-Z]+-\d+$/), summary, descriptionADF, priority
2. Load JiraConfig + verify isConfigured (else 400 JIRA_NOT_CONFIGURED)
3. Re-check dedup (server-side, even if UI thinks none) via searchOpenDefectByTestId
   → if open match found, return 409 ALREADY_FILED with { defectKey, jiraUrl }
4. jiraClient.createIssue({ projectKey, issueType, summary, descriptionADF, priority, parentStoryKey })
   → on JiraValidationError: return 400 with details
   → on JiraAuthError: return 502 JIRA_AUTH_FAILED
5. For each requested attachKind in ['screenshot', 'video', 'trace']:
   - resolve file path from RunRecord/TestEvent
   - check size ≤ config.maxAttachmentMB (else log + skip)
   - read file → jiraClient.addAttachment()
   - on individual attachment failure: log warning, mark in result, continue
6. Persist DefectRecord to data/defects.json (atomic write)
7. Update TestEvent.defectKey on RunRecord (for badge rendering)
8. logAudit({ action: 'defect_filed', defectKey, runId, testId, userId, ip })
9. broadcast({ type: 'defect_filed', defectKey, testId, suiteId })
10. Response: { defectKey, jiraUrl, attachments: { screenshot: 'ok', video: 'ok', trace: 'failed' } }
```

### Auto-close hook

```typescript
function autoCloseHookOnRunComplete(record: RunRecord): void {
  const passedTests = record.tests.filter(t => t.status === 'pass');
  if (!passedTests.length) return;
  const registry = loadDefectsRegistry();
  for (const t of passedTests) {
    if (!t.testId) continue;
    const candidate = registry.defects.find(d =>
      d.testId === t.testId &&
      d.suiteId === record.suiteId &&
      d.environmentId === record.environmentId &&
      d.status === 'open'
    );
    if (!candidate) continue;
    closeDefectAsync(candidate, record.runId).catch(err =>
      logger.warn('[autoClose] failed', { defectKey: candidate.defectKey, err: err.message })
    );
  }
}
```

`closeDefectAsync` calls `transitionIssue` + `addComment`, then updates registry. On Jira failure: registry stays open; next run retries. Never blocks run finalization.

---

## Component 4: Data Models

### `data/jira-config.json`

```typescript
interface JiraConfig {
  projectKey: string;            // "BSM"
  issueType: string;             // "Defect"
  defaultPriority: string;       // "Medium"
  parentLinkFieldId: string;     // "customfield_10014" — used when setting parent on createIssue
  referSSFieldId: string;        // "customfield_XXXXX" — captured for future use; v1 uses standard /attachments endpoint instead
  closeTransitionName: string;   // "Closed"
  maxAttachmentMB: number;       // 50
  updatedAt: string;
  updatedBy: string;
}
```

### `data/defects.json`

```typescript
interface DefectRecord {
  defectKey: string;             // "BSM-1842"
  jiraId: string;
  testId: string;                // stable hash
  testName: string;
  suiteId: string;
  suiteName: string;
  environmentId: string;
  environmentName: string;
  projectId: string;
  parentStoryKey: string;        // "BSM-1826"
  status: 'open' | 'closed';
  createdAt: string;
  createdBy: string;             // username
  filedFromRunId: string;
  closedAt?: string;
  closedByRunId?: string;
  jiraUrl: string;
  attachments: {
    screenshot?: 'ok' | 'failed' | 'skipped';
    video?: 'ok' | 'failed' | 'skipped';
    trace?: 'ok' | 'failed' | 'skipped';
  };
  comments: Array<{ runId: string; addedAt: string; addedBy: string }>;
}

interface DefectsRegistry {
  _schemaVersion: 1;
  defects: DefectRecord[];
}
```

In-memory indexes rebuilt on load:
- By `testId + suiteId` (dedup lookup)
- By `(suiteId, environmentId, status='open')` (auto-close scan)
- By `defectKey` (badge display)

### `data/dismissed-defects.ndjson` (append-only)

```typescript
interface DismissEntry {
  timestamp: string;
  runId: string;
  testId: string;
  testName: string;
  suiteId: string;
  category: 'script-issue' | 'locator-issue' | 'flaky' | 'data-issue' | 'env-issue';
  dismissedBy: string;
  errorMessage: string;
}
```

### `RunRecord.TestEvent` extension

```typescript
interface TestEvent {
  // ...existing fields...
  defectKey?: string;            // populated when defect filed
  defectStatus?: 'open' | 'closed';
}
```

Set when filed. On run-load, server cross-references `data/defects.json` against `(testId, suiteId)` and back-fills these fields for the report renderer.

---

## Component 5: UI

### Admin Settings — "Jira Integration" section

Located in **Admin → Notification Settings** (collapsible, matches Slack/Teams panel style).

**Fields:**
- Status banner: "✓ Connected as {email}" or "✗ Not configured"
- Project Key (text input)
- Issue Type (dropdown — "Defect" / "Bug" / etc., populated from `/api/jira/fields`)
- Default Priority (dropdown — "Highest" / "High" / "Medium" / "Low" / "Lowest")
- Field Mapping section (auto-discovered):
  - Parent / User Story Link (dropdown of customfield IDs)
  - Refer SS field (dropdown of customfield IDs)
- Auto-Close Transition Name (dropdown of available status names)
- Max Attachment Size (number, MB)
- Buttons: `[Test Connection]` `[Discover Fields]` `[Save Configuration]`
- Read-only credentials section showing `.env` values (token masked)

**Behaviors:**
- "Test Connection" → `POST /api/jira/test` → green banner or red error message
- "Discover Fields" → `GET /api/jira/fields` → repopulates field-mapping dropdowns
- "Save" → validates required fields → `PUT /api/jira/config` → audit log entry
- Section disabled (greyed) if `.env` credentials missing → red banner directs admin

### Execution Report — defect button

Failed test row gets a `[🐞 File Defect]` button next to existing View/Play buttons.

**States:**

| Condition | Renders |
|---|---|
| No defect filed, Jira configured, user is Editor | `[🐞 File Defect]` (clickable, primary color) |
| No defect filed, Jira NOT configured | `[🐞 File Defect]` disabled, tooltip "Configure Jira in Admin → Notification Settings" |
| No defect filed, user is Tester (not Editor) | `[🐞 File Defect]` disabled, tooltip "Requires Editor role" |
| Defect filed, status open | `[🐞 BSM-1842 (Open)]` (clickable badge — opens existing-defect view) |
| Defect filed, status closed | `[🐞 BSM-1842 (Closed)]` badge + (if test failed again) a fresh `[🐞 File New Defect]` button |
| Test passed | No button rendered |

### Defect Modal

Full-screen overlay modal (~80vw × 90vh, matches trace viewer modal pattern).

**Header:** "🐞 File Defect to Jira" + close button.

**Existing Defect Banner** (shown only on dedup hit):
- "⚠ Already filed as BSM-1841 (Open) — opened {N} days ago"
- Buttons: `[View Ticket]` `[Add as Comment]` `[Cancel]`
- If user clicks Add as Comment, modal switches to comment-only form (one textarea + attachment checkboxes + submit)

**Draft Form (no dedup hit, or user proceeded past banner):**
- Project Key (read-only, from config)
- Issue Type (read-only, from config)
- Priority (dropdown, default from config)
- User Story * (text input, required, regex-validated `^[A-Z]+-\d+$`)
- Summary * (text input, max 255 chars)
- Description (rich-text editor showing all 5 sections; expand/collapse per section)
  - Description
  - Precondition
  - Steps
  - Actual Result
  - Expected Result *(starts empty — user fills)*
- Refer SS attachments (checkboxes):
  - ☑ screenshot.png ({size})
  - ☑ video.webm ({size})
  - ☑ trace.zip ({size}) — disabled with tooltip if > maxAttachmentMB
- Action buttons:
  - `[Approve & File]` (primary green)
  - `[Not a Bug ▼]` (dropdown: script-issue / locator-issue / flaky / data-issue / env-issue)
  - `[Cancel]`

**Submit flow:**
1. Validate User Story key + Summary length client-side
2. Disable buttons + show "Filing..." spinner
3. POST `/api/defects/file`
4. On success: modal swaps to success view: `✓ Filed as BSM-1842 [Open in Jira ↗] [Close]`
5. On error: red banner shows error.message + error.code; buttons re-enabled
6. On dedup hit (409): banner appears with options to View/Add Comment

**"Not a Bug" submit:**
1. Picking a category fires `POST /api/defects/dismiss { runId, testId, category }`
2. Toast: "Logged as: {category}. Feeds {Locator Health|Flakiness Engine|audit}."
3. Modal closes

---

## Error Envelope

All defect/jira API errors use:

```typescript
{ error: { code: string, message: string, details?: unknown } }
```

| Condition | HTTP | Code |
|---|---|---|
| Jira not configured | 400 | `JIRA_NOT_CONFIGURED` |
| Validation failed (client) | 400 | `BAD_REQUEST` |
| Validation failed (Jira-side) | 400 | `JIRA_VALIDATION_ERROR` (details = Jira's per-field errors) |
| Jira auth failed | 502 | `JIRA_AUTH_FAILED` |
| Jira not reachable | 502 | `JIRA_UNREACHABLE` |
| Already filed (dedup) | 409 | `ALREADY_FILED` |
| Run/test not found | 404 | `NOT_FOUND` |
| User lacks role | 403 | `FORBIDDEN` |
| Attachment too large | 413 (per-attachment, soft-skip with warning, not request failure) | `ATTACHMENT_TOO_LARGE` |
| Jira server error | 502 | `JIRA_SERVER_ERROR` |

---

## Edge Cases

| Edge case | Behavior |
|---|---|
| Jira down during file | Modal shows "Jira unreachable. Try again later." Nothing persisted. |
| Network drops mid-attachment | Issue created (key known), attachment marked `failed` in defects.json. UI shows "⚠ Some attachments failed to upload" with retry option (future enhancement; v1 just logs). |
| User Story key invalid | Jira returns 400 → modal banner shows Jira's error message |
| Trace > maxAttachmentMB | Attachment soft-skipped, toast: "Trace too large to attach (X > Y MB limit)" |
| Same test fails twice in same run (retry) | Use FINAL attempt's data when filing |
| Jira API token expired | First call → 401 → admin sees red banner: "⚠ Jira credentials invalid — re-issue token" |
| User logged out mid-modal | API returns 401 → "Session expired, please log in again" |
| Run record deleted while defect open | Defect record self-contained; badge still renders. View Jira link still works. |
| Defect manually closed in Jira | Local registry doesn't know yet. Dedup uses live JQL (`statusCategory != Done`) so next file detects it; offers fresh file. Local status NOT auto-corrected (acceptable drift). |
| Auto-close transition forbidden by workflow | Logged as warning. Local status stays open. Manual cleanup via "Mark as Closed" badge action (future enhancement, not in v1). |
| Two users open modal simultaneously | First to submit wins. Second sees 409 ALREADY_FILED, banner appears with View/Comment options. |
| Test passes in different env than failure | Auto-close scoped to `(testId, suiteId, environmentId)` — pass in different env does NOT close. |

---

## Permissions Matrix

| Action | Tester | Editor | Admin |
|---|---|---|---|
| View defect badge | ✓ | ✓ | ✓ |
| Click File Defect button | ✗ (disabled) | ✓ | ✓ |
| File defect | ✗ | ✓ | ✓ |
| Add comment | ✗ | ✓ | ✓ |
| Dismiss "Not a Bug" | ✗ | ✓ | ✓ |
| Configure Jira mapping | ✗ | ✗ | ✓ |
| Test connection / Discover fields | ✗ | ✗ | ✓ |

---

## Auto-File Trigger Logic Summary

| Event | Trigger | Action |
|---|---|---|
| User clicks File Defect | Manual | Open modal → draft → user submits → Jira create |
| User clicks "Not a Bug" | Manual | Append NDJSON, no Jira interaction |
| Run completes with passing tests | Auto | Scan registry for `(testId, suiteId, envId, status=open)` matches; transition + comment in Jira |
| Same test fails again, defect open | Auto-detect on draft | Show "Already filed" banner with View/Comment/Cancel options |
| Same test fails after auto-close | Auto-detect on draft | Show "Previously filed and closed" — offer fresh file |

---

## Testing

| Layer | Type | Coverage |
|---|---|---|
| `jiraClient.ts` | Unit (mocked HTTP) | All API methods, auth header, error mapping |
| `adfBuilder.ts` | Unit | Each section's ADF shape, edge cases (empty steps, no errorDetail) |
| Defect routes | Integration | Auth gates, dedup logic, attachment soft-skip, audit logging |
| Auto-close hook | Integration | Triggers on `(testId, suiteId, envId)` match only; failure tolerance |
| Modal UI | Manual | Open + draft + file + success; dedup banner; Not a Bug; dismiss |
| End-to-end | Manual against real Jira sandbox | Create → verify in Jira → trigger pass → verify auto-close + comment |

### Manual Test Checklist

| # | Scenario | Expected |
|---|---|---|
| 1 | Click File Defect on a failed test | Modal opens with auto-filled summary/description/steps |
| 2 | Submit with empty User Story key | Inline validation: "User Story is required" |
| 3 | Submit valid draft | Jira ticket created, attachments uploaded, success modal shows BSM-XXXX link |
| 4 | Open Jira ticket in browser | All sections render correctly in ADF (Description / Precondition / Steps / Actual / Expected) |
| 5 | File defect; same test fails again next run | Modal shows "Already filed as BSM-XXXX (Open)" banner |
| 6 | Click "Add as Comment" on dedup banner | Comment posted with new run's error + screenshot |
| 7 | Trigger same test pass next run | Defect auto-closes within seconds; Jira shows "Closed" + auto-close comment |
| 8 | Dismiss as "locator-issue" | NDJSON entry written, no Jira call |
| 9 | Tester user logs in and views report | Defect button is disabled with tooltip |
| 10 | Test attachment > 50 MB (trace) | Skipped with toast notification, ticket still created |
| 11 | Disconnect network mid-file | Error shown, no partial state saved |
| 12 | Admin disables Jira config | All defect buttons grey out platform-wide; tooltip explains |
| 13 | Same test failure across two simultaneous browser tabs | First wins; second sees 409 ALREADY_FILED |
| 14 | Test passes in DIFFERENT environment after failing | Defect stays open (env-scoped match required) |
| 15 | Manually close defect in Jira UI; same test fails again | Dedup detects as not open; allows fresh file |

---

## Out of Scope (v1)

Explicitly NOT in v1 — implementation must NOT include:

- ❌ AI/LLM pre-classification of failures
- ❌ Bulk multi-test filing
- ❌ Multiple Jira instance support
- ❌ Per-project defect templates
- ❌ Re-open auto-closed defects (file new ticket via dedup logic instead)
- ❌ Jira webhooks (incoming events from Jira)
- ❌ Defect filing from Execution History list, Flaky Tests tab, or Analytics dashboard
- ❌ Custom field UI for fields beyond Parent (User Story) + Refer SS
- ❌ Per-Tester role gates (Editor is the only line)
- ❌ Retry attachment upload UI
- ❌ Manual "Mark as Closed" badge action
- ❌ Defect ID search/filter on Execution History page

---

## Future Enhancements (roadmap, not v1)

- AI pre-classification using LLM (errorDetail + console errors → suggested category)
- Bulk validation mode: select N failures, batch-review
- Defect inbox tab — cross-run aggregation
- Auto-link to ADO test cases (when ADO test management is available)
- Webhook listener: Jira closes ticket → reflect locally
- Per-project defect template overrides
- Manual close/re-open badge actions
- Defect retry on attachment failure
