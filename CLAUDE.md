# QA Agent Platform — Master AI Instructions (Project Intelligence File)
# Auto-loaded by Claude Code every session. Keep this updated.
# Last Updated: 2026-04-08

You are the orchestration brain of the **qa-agent-platform** enterprise test automation system.
Read this entire file before taking any action. These rules are non-negotiable.

> **📋 See [docs/DEBUGGER_IMPROVEMENTS.md](docs/DEBUGGER_IMPROVEMENTS.md) for detailed notes on recent debugger fixes (2026-04-08): screenshot sync, orphan cleanup, process termination, UI styling.**
> **📋 See [docs/RECORDER_PLAN.md](docs/RECORDER_PLAN.md) for the UI Recorder feature implementation plan (2026-04-09): live step capture, locator auto-resolution, shadow DOM, browser dialogs, file upload.**

---

## PROJECT OVERVIEW

### What We're Building
- **Type:** AI-Driven Test Automation Platform — UI-first keyword-based Playwright spec generator
- **Stack:** Node.js / TypeScript · Express.js · Playwright · Vanilla JS frontend · JSON file storage
- **Environment:** Claude Code Extension · VSCode · Playwright MCP · Google AI IDE (Antigravity)
- **Stage:** Active Development — Core engine working, all UI modules feature-complete

### Project Goal
An enterprise QA automation platform where SDETs build test scripts using a structured keyword-based UI (no manual coding). Test scripts are organised into suites and executed via `codegenGenerator.ts`, which generates and runs Playwright TypeScript specs against live web apps. Test data parameterisation, common functions (reusable step groups), locator repository, environment configuration, and execution history are all managed through the UI.

### Active Architecture
```
Browser UI (index.html + modules.js + app.js)
        ↓  REST API calls
Express Server (src/ui/server.ts)
        ↓  reads/writes JSON
data/*.json  (scripts, suites, projects, locators, functions, commondata)
        ↓  suite run trigger
codegenGenerator.ts  →  generates .spec.ts  →  Playwright executes
        ↓
RunRecord (in-memory + persisted to results/*.json)
        ↓
Execution History page  +  execution-report.html (standalone report)
```

---

## FOLDER STRUCTURE

```
qa-agent-platform/
├── CLAUDE.md                          ← This file (auto-loaded every session)
├── src/
│   ├── ui/
│   │   ├── server.ts                  ← Express server (REST API + static serving)
│   │   └── public/
│   │       ├── index.html             ← Single-page app shell + all module panels
│   │       ├── modules.js             ← All module logic (most-edited file)
│   │       ├── app.js                 ← Bootstrap, tab switching, project selector
│   │       ├── execution-report.html  ← Standalone report page (opens in new tab)
│   │       ├── styles.css             ← Base styles
│   │       └── styles_addon.css       ← Module-specific overrides + tooltip popup
│   ├── data/
│   │   ├── types.ts                   ← All TypeScript interfaces
│   │   ├── store.ts                   ← JSON read/write helpers
│   │   ├── keywords.json              ← Keyword definitions with tooltip metadata
│   │   └── seed.ts                    ← Initial seed data
│   └── utils/
│       ├── codegenGenerator.ts        ← ACTIVE spec generator (suite run engine)
│       └── specGenerator.ts           ← Legacy dead code — DO NOT TOUCH OR IMPORT
├── data/                              ← Runtime JSON files (git-ignored)
│   ├── projects.json
│   ├── scripts.json
│   ├── suites.json
│   ├── locators.json
│   ├── functions.json
│   ├── common_data.json
│   ├── users.json
│   └── audit.json
├── results/                           ← Persisted RunRecord JSON files (run-*.json)
├── tests/
│   └── codegen/                       ← Auto-generated .spec.ts files (from suite runs)
├── test-plans/                        ← Dummy plan metadata (suite run context)
├── test-results/                      ← Playwright output (screenshots, traces, videos)
├── UI_Page_Analysis/                  ← DOM snapshots + ui-reference-lookup.json
│   ├── ui-reference-lookup.json       ← Selector reference for target app pages
│   └── *.md                           ← Per-page UI analysis docs
├── docs/
│   ├── HOW_TO_USE.md
│   ├── SDET_GUIDE.md
│   └── ADO_SETUP.md
└── prompts/
    ├── planner.prompt.md
    ├── generator.prompt.md
    └── healer.prompt.md
```

---

## KEY COMMANDS

```bash
# Build TypeScript (ALWAYS run before restarting server after any src/ change)
npm run build

# Build and restart UI server
npm run build && npm run ui

# Find PID holding port 3000
netstat -ano | findstr :3000

# Kill old server process then restart
taskkill //F //PID <pid> && npm run ui

# Verify server is up
curl -s http://localhost:3000 -o /dev/null -w "%{http_code}"
# → should return 200

# Run a generated spec manually (for debugging)
npx playwright test tests/codegen/<spec-file>.spec.ts --headed
```

### UI Server Restart Procedure
Always follow in order:
1. `netstat -ano | findstr :3000` — note the PID
2. `taskkill //F //PID <pid>`
3. `cd "e:/AI Agent/qa-agent-platform" && npm run build && npm run ui`

**When to restart:** After any change to `src/` files (always build first). Static files (`*.html`, `*.js`, `*.css` in `public/`) are served directly — no restart needed for those.

---

## DATA MODELS

### Project
```typescript
{ id, name, appUrl, description, tcIdPrefix, tcIdCounter, environments: ProjectEnvironment[], isActive, createdAt, createdBy }
```

### ProjectEnvironment
```typescript
{ id, name, url }   // stored inside project.environments[]
```

### Locator
```typescript
{ id, projectId, name, selector, locatorType, description, component }
```

### CommonFunction (fn)
```typescript
{
  id, projectId, name, description,
  steps: FunctionStep[]  // { order, keyword, locator, description } — no value/valueMode
}
```

### TestDataRow
```typescript
{ value: string }
```

### FnStepValue
```typescript
{
  fnStepIdx: number,
  valueMode: 'static' | 'dynamic' | 'commondata' | 'testdata',
  value: string,
  testData: TestDataRow[]
}
```

### ScriptStep
```typescript
{
  id, order, keyword, locatorName, locatorType, locator, locatorId,
  valueMode: 'static' | 'dynamic' | 'commondata' | 'testdata',
  value: string,
  testData: TestDataRow[],
  fnStepValues?: FnStepValue[],  // per-child-step value overrides for CALL FUNCTION steps
  description: string,
  screenshot: boolean
}
```

### TestScript
```typescript
{
  id, projectId, title, component, tag, priority,
  createdBy, createdAt, modifiedBy, modifiedAt,
  steps: ScriptStep[]
}
```

### TestSuite
```typescript
{
  id, projectId, name, description,
  environmentId: string,           // saved default environment for this suite
  scriptIds: string[],
  createdBy, createdAt, modifiedBy, modifiedAt
}
```

### RunRecord
```typescript
{
  runId, planPath, planId,
  startedAt, finishedAt,
  status: 'running' | 'done' | 'failed',
  exitCode, output, tests: TestEvent[],
  passed, failed, total,
  projectId, projectName,
  suiteId, suiteName,
  environmentId, environmentName,
  executedBy
}
```

### TestEvent
```typescript
{
  name, status: 'pass' | 'fail',
  durationMs,
  errorMessage?,   // first error line
  errorDetail?,    // full failure block
  screenshotPath?  // relative path under test-results/
}
```

---

## ACTIVE MODULES (UI)

| Module | Nav Tab | Purpose |
|---|---|---|
| Test Script Builder | `scripts` | Build/edit keyword-based test scripts |
| Test Suite | `suites` | Group scripts → run as a suite |
| Locator Repository | `locators` | Manage CSS/XPath selectors per project |
| Common Functions | `functions` | Reusable step groups (no value fields in definition) |
| Common Data | `commondata` | Shared key-value data for tests |
| Execution History | `history` | View past runs, filter, open report |
| Projects | `projects` | Manage projects (admin only) |
| Admin | `admin` | Platform settings (admin only) |

**Removed modules (no longer exist):** Jira Story, Upload PRD/Docs, Chat Instruction, Run History (old)

---

## CODEGENENERATOR BEHAVIOUR

File: `src/utils/codegenGenerator.ts`

### Auto URL Navigation
- Every `test()` block begins with `generateNavBlock(environment, project, indent)`
- URL taken from `environment.url` (suite's saved `environmentId`)
- `waitUntil: 'domcontentloaded'` used — handles SSO redirects without timing out
- `GOTO` keyword returns `''` — silently skipped to avoid duplicate navigation

### Test Data Parameterisation
- Scripts with `valueMode: 'testdata'` steps generate N `test()` blocks (one per row)
- `numRuns` = max row count across all testdata steps (including fn child steps)
- Run index aligned: run 0 → row[0], run 1 → row[1], etc.
- Test names get `[row 1]`, `[row 2]` suffix when N > 1

### CALL FUNCTION Injection
- `fnStepValues[]` on ScriptStep stores per-child-step value overrides
- At codegen time each child step gets a `pseudoStep` with injected `valueMode/value/testData`
- Child step locator resolved as: `fs.selector || locatorName || detail`

### Value Modes
| Mode | Generated code |
|---|---|
| `static` | Literal string |
| `dynamic` | `process.env.VALUE` |
| `commondata` | Common Data key lookup |
| `testdata` | `testDataRows[runIdx]` |

---

## EXECUTION ENGINE (server.ts)

### Suite Run Flow
1. `POST /api/suites/:id/run` with `{ environmentId }`
2. Resolves environment from project → calls `generateCodegenSpec()`
3. Writes spec to `tests/codegen/<SuiteName>.spec.ts`
4. Spawns `npx playwright test <spec>` via `spawnRunWithSpec()`
5. Output parsed line-by-line: ANSI stripped before regex matching
6. `RE_TEST_LINE` matches both `ok N [chromium]` and `✓ N [chromium]` formats
7. On close: `parseFailureDetails()` scans output for failure blocks → attaches `errorMessage`, `errorDetail`, `screenshotPath` to failed `TestEvent`s
8. `RunRecord` persisted to `results/run-<uuid>.json`

### HTTP Polling (suite run progress)
- `suiteRun()` in modules.js uses pure HTTP polling (no WebSocket for runs)
- Polls `GET /api/run/:runId` every 1.5 seconds
- Works through any reverse proxy without WS upgrade support

### Execution History
- `GET /api/runs?projectId=xxx` — returns up to 100 runs filtered by project
- All run metadata (suite, env, user, times) stored on RunRecord at run start
- Execution History tab loads on project change and tab switch

### Standalone Report Page
- `GET /execution-report?runId=xxx` — serves `execution-report.html` in new tab
- Full execution summary + metrics + test case table with failure details + screenshots
- Export HTML: clones DOM, strips dark inline colors, downloads light-mode `.html`
- Export PDF: `window.print()` with comprehensive `@media print` light-mode overrides

---

## UI RULES — MODULES.JS

### Add Buttons
All 5 module add buttons disabled until project selected. Controlled by `_toggleModuleAddButtons(enabled)`.

### Keyword Tooltips
- Trigger: `?` span with `data-tooltip-json` attribute (`{ what, example, tip }`)
- Popup: singleton `#kw-tooltip-popup` div, positioned via `getBoundingClientRect`

### Test Script Editor
- Fields: Component, Title, Tag, Priority, Created By
- TC ID: auto-generated (not shown in editor)
- Value Source tabs: Static / Dynamic / Common Data / Test Data
- Test Data table: # / Value / delete (no Label column)
- CALL FUNCTION: expands child steps as read-only header + value source per step needing a value

### Script List
- Filters: Title / Tag / Component
- Columns: TC ID / Title / Component / Tag / Priority / Created By / Created Date / Actions

### Suite Detail
- Environment selector (`suite-run-env`) populated from project environments
- Suite run requires env selection
- Run uses HTTP polling — no per-run WebSocket

### Execution History
- Sortable columns (click header to sort, toggle ▲/▼)
- Filters: Date / Search (ID, Suite, User) / Status / Environment
- "View Report" opens standalone page in new tab (only shown for completed/failed runs)

### Common Function Editor
- Steps: Keyword / Locator / Description only
- No Value or Value Source fields
- `CALL FUNCTION` and `GOTO` excluded from keyword dropdown

---

## CRITICAL RULES

1. **`specGenerator.ts` is DEAD CODE** — never import, call, or edit it.
2. **Never modify passing test scripts** — if a spec in `tests/codegen/` is green, leave it.
3. **Never pre-load large files** at session start — read only when needed.
4. **`keywords.json`** is source of truth for keyword definitions and tooltip content.
5. **`ui-reference-lookup.json`** is the selector reference — extend there, not in generator code.
6. **Checkpoint / Handoff** — when user says either word alone: write CLAUDE.md first, confirm in chat.
7. **Context budget** — never trigger Playwright/getDOM calls unless user explicitly requests a test run.
8. **Static files** (`public/*.html`, `public/*.js`, `public/*.css`) do not need a server restart — changes are served immediately.

---

## CURRENT STATUS — COMPLETED FEATURES

- [x] Project-scoped modules (all data filtered by selected project)
- [x] Authentication — login, sessions, admin/user roles
- [x] Locator Repository (CRUD, component filter)
- [x] Common Functions (steps without value fields; CALL FUNCTION + GOTO excluded from dropdown)
- [x] Common Data (key-value store per project)
- [x] Test Script Builder — full keyword-based editor with 4-tab value source
- [x] Test Script list — TC ID / Title / Component / Tag / Priority / Created By columns
- [x] Test Script filters — Title + Tag + Component
- [x] CALL FUNCTION expansion — child steps with read-only header + value source per step
- [x] Test Data parameterisation — N test() blocks per script, row-aligned
- [x] `fnStepValues` — per-child-step value injection at codegen time
- [x] Rich keyword tooltips — 3-section popup (What / Example / Tip)
- [x] Add button disabled state — all 5 buttons disabled until project selected
- [x] Suite environment selector — env saved on suite, overridable at run time
- [x] Auto URL navigation — `generateNavBlock()` injected in every test(); GOTO skipped
- [x] SSO-compatible navigation — `waitUntil: 'domcontentloaded'`
- [x] HTTP polling for suite runs — works through any proxy
- [x] ANSI stripping in output parser — `ok N [chromium]` format correctly matched
- [x] Execution History page — project-scoped, sortable, filterable
- [x] RunRecord metadata — projectId, suiteId, environmentId, executedBy, finishedAt
- [x] Failure detail parsing — errorMessage, errorDetail, screenshotPath on TestEvent
- [x] Standalone execution report page — full summary + metrics + test case table
- [x] Export HTML — light-mode self-contained file, dark colors stripped
- [x] Export PDF — `window.print()` with full print stylesheet
- [x] Removed modules — Jira Story, Upload PRD/Docs, Chat Instruction (old Run History)
- [x] Multi-machine access — fixed session cookie `sameSite: 'lax'`, fixed session secret

### Debugger Improvements — Round 1 (2026-04-08)
- [x] **Screenshot sync fix** — File existence check before broadcast (was 20-40s delay, now <2s)
- [x] **Orphan process cleanup** — 3-part system (beforeunload beacon + heartbeat timeout + enhanced close)
- [x] **Process termination fix** — Use taskkill /F /T to kill entire process tree (includes Chrome children)
- [x] **Modal UI styling** — Added missing `.modal-box` CSS class
- [x] **WebSocket on all interfaces** — Server listens on 0.0.0.0 (fixes qa-launchpad.local access)
- [x] **Loading indicator UI** — Shows spinner while screenshot loads, prevents early button enable
- [x] **120-second fallback timeout** — Shows error if network fails (no premature button enable)

### Debugger Improvements — Round 2 (2026-04-08)
- [x] **JPEG screenshots** — Replaced PNG with JPEG (quality 80) → 5× smaller files, faster delivery
- [x] **SSE screenshot delivery** — Server-Sent Events replaces WebSocket polling for screenshot push (WS blocked by IIS proxy on qa-launchpad.local); inline base64 payload eliminates HTTP round-trip
- [x] **100ms server poller** — Reduced pending.json poll interval from 400ms → 100ms
- [x] **Color-coded element highlighting** — `__debugHighlight()` outlines target element before screenshot: CLICK=red, FILL=blue, SELECT=orange, HOVER=yellow, ASSERT=green, other=purple
- [x] **Common Function expansion** — CALL FUNCTION steps expand into individual sub-step debug blocks (highlight + screenshot + pause + execute + settle per sub-step, indexed 1.1, 1.2 …)
- [x] **DOM-state settle (MutationObserver)** — `__waitForPageSettle` uses MutationObserver instead of static waits; resolves after DOM is quiet and no spinner is visible
- [x] **Spinner-aware settle** — Tiered timing: 200ms initial check → 300ms after mutation → 500ms re-arm when spinner visible; waits until spinner gone before screenshot
- [x] **Navigation path spinner check** — After URL-change steps the catch path runs `waitForFunction` to confirm spinner cleared (domcontentloaded fires before API-driven spinners disappear)
- [x] **Final "DONE" pause** — After last step, spec takes final screenshot and holds browser open until user acts (prevents browser auto-close at end of script)

### Planned — UI Recorder (2026-04-09)
- [ ] **recorder.js** — injected into AUT tab, captures click/fill/select/upload/dialogs/shadow DOM/iframes
- [ ] **recorderParser.ts** — selector derivation, smart locator name generation, ScriptStep assembly
- [ ] **Locator auto-resolve** — reverse lookup against repo; auto-creates new repo entry if no match
- [ ] **Record button** — in Test Script editor, live step insertion via SSE
- [ ] **4 new server endpoints** — `/api/recorder/start|step|stop|stream/:token`
- See [docs/RECORDER_PLAN.md](docs/RECORDER_PLAN.md) for full plan
