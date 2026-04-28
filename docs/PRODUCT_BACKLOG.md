# QA Agent Platform — Product Backlog
# Last Updated: 2026-04-28

---

## ✅ COMPLETED FEATURES (this platform already has these)

| Feature | Details |
|---|---|
| Keyword-based Test Script Builder | 150/150 keywords, 4-tab value source, CALL FUNCTION, Test Data |
| Test Suite Management | Group scripts, env selector, retries, hooks (beforeEach/afterEach), Fast Mode, Overlay Handlers |
| Locator Repository | CSS/XPath/ID/Role/Text selectors, project-scoped, self-healing profiles |
| Common Functions | Reusable step groups, called from any script |
| Common Data | Key-value store per project+environment, encrypted sensitive values |
| Execution History | Sortable, filterable, project-scoped, run reports |
| Standalone Execution Report | Full summary + test table + screenshots + video + trace, export HTML/PDF |
| Debugger | Step-through execution, live screenshots, color-coded highlights, common function expansion |
| UI Recorder (Chrome Extension) | Click/fill/select/shadow DOM capture, locator auto-resolve |
| Self-Healing Locators | T1 (alternatives fallback), T2 (similarity matching), healing proposals UI |
| Multi-browser Execution | Chromium + Firefox + WebKit per suite, browser column in report |
| Failure Notifications | Email (SMTP), Slack (Block Kit), Teams (Adaptive Card), configurable triggers |
| Analytics Dashboard | Pass rate trend, top failures, flaky tests, suite comparison, KPI cards |
| Scheduled Runs | Cron-based suite scheduling, last run tracking |
| API Key Access | Named keys, project-scoped, SHA-256 hashed, ADO/CI integration |
| ADO CI/CD Integration | azure-pipelines.yml, ADO_SETUP.md, API key auth on run trigger |
| Licensing System | Starter/Team/Enterprise tiers, RSA-signed .lic files, feature gates, seat enforcement |
| White-label Support | appName, logoUrl, primaryColor per Enterprise license |
| User Management | Admin/Tester roles, force password change, account lockout, audit log |
| Notification Settings UI | Admin panel with collapsible SMTP/Slack/Teams config + test button |
| Installation Scripts | Windows (install.ps1 + NSSM service) + Linux (install.sh + systemd) |
| Auto-File Jira Defect | Human-validated draft modal on Execution Report; ADF rich-text body; embedded attachments; auto-close on next-run pass; "Not a Bug" classify feeds Flakiness/Locator engines (shipped 2026-04-28) |

---

## 🔲 BACKLOG — PRIORITIZED

### Priority 1 — Visual Regression Testing
**What:** Capture baseline screenshots of UI elements/pages, then diff against future runs. Highlight pixel-level changes. Set pass/fail threshold (e.g. <2% diff = pass).

**Why:** Catch unintended visual changes (broken layouts, missing elements, style regressions) that functional assertions miss. One of the top enterprise QA platform features.

**How it fits:** New keyword `ASSERT VISUAL` — compares current screenshot against stored baseline. Baseline stored per locator+environment. Diff image shown in execution report.

**Effort:** Medium — needs sharp/jimp for image diff, baseline storage, report UI for diff viewer.

---

### Priority 2 — API Testing Keywords
**What:** New keywords for HTTP calls alongside UI steps:
- `API GET`, `API POST`, `API PUT`, `API DELETE`
- `ASSERT RESPONSE STATUS` (e.g. 200, 404)
- `ASSERT JSON FIELD` (e.g. `$.data.userId` equals `123`)
- `STORE RESPONSE FIELD` (save to variable for use in later steps)

**Why:** Most real test flows mix UI and API steps — e.g. create a record via API, then verify it appears in the UI. Competitors (Katalon, TestRigor) support this.

**How it fits:** Extend `codegenGenerator.ts` to emit `request()` Playwright API calls. No new UI needed — just new keywords in `keywords.json` + codegen handlers.

**Effort:** Medium — codegen changes + keyword definitions + value source for headers/body.

---

### Priority 3 — Bulk Actions on Test Scripts
**What:** Multi-select scripts in the Script list, then:
- Add selected to a suite in one click
- Delete multiple scripts at once
- Change priority/tag on multiple scripts
- Export selected scripts to JSON

**Why:** Teams managing 100+ scripts find individual actions tedious. Standard feature in any test management tool (Zephyr, Xray, TestRail).

**How it fits:** Checkbox column in script list, floating action bar appears when ≥1 selected, bulk API endpoints on server.

**Effort:** Low-Medium — mostly UI work, simple bulk API endpoints.

---

### Priority 4 — Run Comparison (Diff Two Reports)
**What:** Select any two historical runs and see a side-by-side diff:
- Tests that newly failed (regression)
- Tests that newly passed (fixed)
- Tests that changed duration significantly (performance regression)
- Tests stable across both runs

**Why:** After a release or code change, the first question is "what broke compared to last time?" This answers it instantly.

**How it fits:** New button in Execution History "Compare with…", opens a comparison view. Pure frontend — reads two existing RunRecords.

**Effort:** Low — no backend needed, just UI diff logic.

---

### Priority 5 — Role-based Access per Project
**What:** Restrict testers to specific projects only. Currently Admin vs Tester is global — a tester can see all projects.

**Why:** Enterprise clients have separate teams per product. A tester on Project A should not see Project B data.

**How it fits:** `User` model gets `allowedProjectIds: string[]`. API filters enforce it. Admin UI gets project assignment per user.

**Effort:** Medium — data model change + API filter + admin UI.

---

### Priority 6 — NL → Keyword Suggestion (AI Assist)
**What:** NL = **Natural Language**. The user types a plain English description of what they want to test — e.g.:

> *"Login as admin, go to the Patients tab, search for John Smith, open his record, and verify his status is Active"*

The AI reads the description and suggests the matching keywords + locators from the repo automatically, pre-filling the step builder.

**Why:** Reduces the learning curve for new SDETs who don't know the keyword library yet. Moves toward TestRigor-style NL automation — our long-term direction.

**How it fits:** Claude API call server-side. Input: description + project locator list + keyword list. Output: ordered ScriptStep array. UI shows suggested steps for review before saving.

**Effort:** High — needs Claude API integration, prompt engineering, UI review step.

---

### Priority 7 — SaaS Multi-tenancy
**What:** Multiple organizations share one hosted instance, each with fully isolated data (projects, users, scripts, runs). Subdomain routing (`acme.qaplatform.io`, `globex.qaplatform.io`).

**Why:** Required for offering this as a hosted SaaS product rather than on-premise only.

**How it fits:** Replace JSON file storage with PostgreSQL, add `orgId` to all data models, subdomain → org resolution middleware.

**Effort:** Very High — full data layer rewrite.

---

## 📊 SUMMARY TABLE

| # | Feature | Effort | Impact | Status |
|---|---|---|---|---|
| 1 | Visual Regression Testing | Medium | High | ❌ Not built |
| 2 | API Testing Keywords | Medium | High | ❌ Not built |
| 3 | Bulk Actions on Scripts | Low-Med | Medium | ❌ Not built |
| 4 | Run Comparison (diff) | Low | Medium | ❌ Not built |
| 5 | Role-based Access per Project | Medium | Medium | ❌ Not built |
| 6 | NL → Keyword Suggestion (AI) | High | Very High | ❌ Not built |
| 7 | SaaS Multi-tenancy | Very High | Very High | ❌ Not built |
