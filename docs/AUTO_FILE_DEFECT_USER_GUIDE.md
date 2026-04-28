# Auto-File Jira Defect — User Guide

**Audience:** QA Engineers, Test Leads, Admins  
**Feature:** Push test failures to Jira as defects, with human review before submission  
**Shipped:** 2026-04-28

---

## Why this feature exists

Test failures aren't always application bugs. They can be:
- Stale element / changed locator
- Flaky timing
- Wrong test data
- Environment outage
- Mistake in the test script itself

Blindly auto-filing every failure as a Jira defect creates noise and erodes developer trust. **TestForge keeps a human in the loop:** the platform drafts the defect with full context, but a reviewer (Editor or Admin role) confirms it's a genuine bug before it's pushed to Jira.

---

## Roles and permissions

| Action | Tester | Editor | Admin |
|---|---|---|---|
| View defect badge on test row | ✅ | ✅ | ✅ |
| Click "File Defect" button | ❌ (disabled) | ✅ | ✅ |
| Approve & file to Jira | ❌ | ✅ | ✅ |
| Add comment to existing defect | ❌ | ✅ | ✅ |
| Mark "Not a Bug" / classify | ❌ | ✅ | ✅ |
| Configure Jira credentials & mapping | ❌ | ❌ | ✅ |
| Test connection / save config | ❌ | ❌ | ✅ |

---

## One-time setup (Admin)

You need an Atlassian API token to authenticate.

### Step 1 — Generate a Jira API token
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Label: `TestForge Defect Filing`
4. Copy the token (shown once)

### Step 2 — Configure in TestForge
1. Log in as Admin
2. Go to **Admin → Notifications → Jira Integration**
3. Fill the fields:

   | Field | Example value | Notes |
   |---|---|---|
   | Jira Base URL * | `https://yourcompany.atlassian.net` | No trailing slash |
   | Jira Email * | `you@yourcompany.com` | The Atlassian account email |
   | Jira API Token * | (paste token) | Stored encrypted on disk |
   | Project Key * | `BSM` | Short Jira project key |
   | Issue Type * | `Defect` | Or `Bug` — match your project |
   | Default Priority * | `Medium` | Per-defect override available |
   | Auto-Close Transition Name * | `Closed` | Status name when test passes again |
   | Max Attachment Size (MB) | `50` | Larger attachments are skipped silently |

4. Click **Test Connection** — should show `✓ Connected as <your email>`
5. Click **Save Configuration**

The Jira Integration is now active for the entire platform. All Editors can file defects.

### Updating the token later
- Click **Save Configuration** without typing in the token field → keeps existing token
- Type a new token → replaces the encrypted one in `data/jira-config.json`

---

## Filing a defect (Editor / Admin)

### Step 1 — Open the Execution Report
- Navigate to **Execution History** → click any run → opens the standalone report
- OR after a fresh suite run, click **View Last Report**

### Step 2 — Find the failed test
- Failed rows show a red **✗ Failed** status
- The **Defect** column on each failed row shows either:
  - 🐞 **File Defect** (yellow) — no defect filed yet
  - 🐞 **BSM-1234 (Open)** (red) — defect already exists, click to view
  - 🐞 **BSM-1234 (Closed)** (green) — previously filed and auto-closed

### Step 3 — Click 🐞 File Defect

A modal opens with the draft auto-filled:

| Field | What it contains |
|---|---|
| **Project Key** | Read-only (from your config) |
| **Issue Type** | Read-only |
| **Priority** | Editable dropdown (default = your config) |
| **User Story** * | YOU type this. Format: `BSM-1826`. Required. |
| **Summary** * | Pre-filled `[Test Name] failed in [Suite Name]` — editable |
| **Description** | Auto-built rich-text body with 5 sections (preview shown) |
| **Attachments** | Checkboxes for screenshot, video, trace zip — uncheck to skip |

**Description sections (rendered in Jira):**
1. **Description** — test name, suite, project, run timestamp, run ID, internal testId
2. **Precondition** — environment + URL + browser + OS
3. **Steps** — actual executed steps from the test
4. **Actual Result** — error message + first 5 lines of stack trace
5. **Expected Result** — *empty placeholder for you to fill in Jira*

### Step 4 — Choose your action

Three buttons at the bottom:

- **Approve & File** (primary green) — pushes the defect to Jira. Modal shows `✓ Filed as BSM-1842` with a link.
- **Not a Bug ▾ + Dismiss** — pick a category and dismiss without filing:
  - `script-issue` — test step / keyword usage error
  - `locator-issue` — stale element or selector change → feeds Locator Health
  - `flaky` — timing / race condition → feeds Flakiness Engine
  - `data-issue` — bad test data
  - `env-issue` — environment outage / unrelated to AUT
- **Cancel** — close without action

### Step 5 — After filing
- The badge on the test row changes to `🐞 BSM-1842 (Open)`
- The badge persists across runs of the same test
- Future failures of the same test will be detected as duplicates

---

## Duplicate handling

If the same test fails again while the defect is still open in Jira:

- Click 🐞 **File Defect** as usual
- The modal shows: `⚠ Already filed as BSM-1842 (Open)` with three options:
  - **Open in Jira ↗** — view the existing ticket
  - **Add as Comment** — post the new run's failure as a comment on the existing ticket (with screenshot)
  - **Cancel** — do nothing

This keeps Jira clean — no duplicate tickets for recurring failures.

---

## Auto-close on next-run pass

When a test passes again on the same suite + same environment after a defect was filed:

1. The platform detects the pass during run finalization
2. Calls Jira API to transition the ticket to **Closed** (using your configured transition name)
3. Posts a comment on the ticket: *"Auto-closed by TestForge — test passed on run {runId} at {timestamp}. Please verify the fix is genuine."*
4. The badge on the test row updates to `🐞 BSM-1842 (Closed)` (green)
5. An audit log entry is created

**Important:** Auto-close is scoped to the **same suite + same environment**. A pass on a different env will NOT auto-close.

---

## "Not a Bug" categories — what they do

When you dismiss a failure with a category, the entry is logged to `data/dismissed-defects.ndjson` and feeds existing intelligence engines:

| Category | Feeds | Purpose |
|---|---|---|
| `script-issue` | Audit log only | Track quality of test authoring |
| `locator-issue` | Locator Health | Trigger healing review for the locator |
| `flaky` | Flakiness Engine | Boost flakiness signal for the test |
| `data-issue` | Audit log only | Track test data quality issues |
| `env-issue` | Audit log only | Distinguish AUT vs environment failures |

No Jira ticket is created in any of these cases.

---

## What gets uploaded to Jira

For each filed defect, three artifacts are uploaded as Jira attachments:

| Artifact | Format | Use case |
|---|---|---|
| Screenshot | `screenshot.png` | First-glance visual of the failure |
| Video | `video.webm` | Replay the full test run |
| Trace zip | `trace.zip` | Open in Playwright Trace Viewer |

If any artifact exceeds the **Max Attachment Size** in admin config (default 50 MB), it's silently skipped — the ticket still gets created with the smaller artifacts.

---

## Troubleshooting

### "Test Connection" returns "✗ 401 JIRA_AUTH_FAILED"
- API token expired or revoked → regenerate at https://id.atlassian.com/manage-profile/security/api-tokens
- Email doesn't match the token's account
- Project Key is wrong (the token user must have access to it)

### "Test Connection" returns "✗ JIRA_UNREACHABLE"
- Base URL is wrong (typo, missing `https://`)
- Network blocks Atlassian Cloud (firewall / proxy)

### "File Defect" button is grayed out with "Requires Editor role"
- You're logged in as Tester. Ask your admin to upgrade your role.

### Modal shows "Configure Jira mapping in Admin"
- Admin hasn't saved the config yet — go to Admin → Notifications → Jira Integration

### "Approve & File" returns "JIRA_VALIDATION_ERROR"
- Read the details — Jira's response is shown verbatim
- Common causes: User Story key doesn't exist; Issue Type name doesn't match; required custom fields aren't set
- For required custom fields not in our UI: add a default in your Jira project's "Field Configuration"

### Auto-close didn't happen after the test passed
- Check the suite + environment match exactly
- Check Jira allows the configured transition (e.g. `Closed`) from the current status
- Check `server.log` for `[autoClose] failed` warnings

### "Trace too large to attach"
- Trace zip exceeded the Max Attachment Size in admin config
- Either raise the limit (default 50 MB) or accept that traces won't be in the ticket for very long tests

---

## Privacy & security

- API tokens are stored **encrypted (AES-GCM)** in `data/jira-config.json`
- Token is never returned to the browser via API responses
- The `data/` directory is excluded from version control
- Audit log captures: who filed each defect, who dismissed, who configured Jira
- Test data, error messages, and stack traces are uploaded to Jira — make sure your Jira instance has appropriate access controls

---

## What's NOT in v1

The team explicitly deferred these to future releases:

- ❌ AI-suggested classification of failures
- ❌ Bulk filing (multiple failures in one action)
- ❌ Per-project defect templates
- ❌ Multi-Jira-instance support
- ❌ Webhook from Jira (e.g., reflect status changes back in TestForge)
- ❌ Re-open auto-closed defects (a fresh failure files a new ticket via dedup)
- ❌ Defect filing from Execution History list, Flaky Tests tab, or Analytics dashboard
- ❌ Custom field UI for fields beyond the standard parent link

---

## Quick reference

| Action | How |
|---|---|
| Set up Jira | Admin → Notifications → Jira Integration |
| File a defect | Execution Report → click 🐞 File Defect on a failed row |
| View existing defect | Click the BSM-XXXX badge on a failed row |
| Add comment to existing | File Defect on the same test → "Add as Comment" on banner |
| Dismiss as not-a-bug | File Defect modal → "Not a Bug ▾" → pick category → Dismiss |
| Test Jira creds | Admin panel → Test Connection |
| Auto-close ticket | Run the suite again — pass on same env auto-closes |
