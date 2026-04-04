# QA Agent Platform — SDET Guide

## Architecture Overview

```
Browser UI (index.html + modules.js + app.js)
        │
        │  REST API (HTTP)
        ▼
Express Server (src/ui/server.ts)  ←→  data/*.json (JSON file storage)
        │
        │  Suite Run trigger
        ▼
codegenGenerator.ts
        │  generates
        ▼
tests/codegen/<Suite>.spec.ts
        │  executed by
        ▼
Playwright (chromium)
        │
        ▼
RunRecord → results/run-<uuid>.json
        │
        ▼
Execution History UI + Standalone Report Page
```

The TypeScript codebase handles file I/O, the Web UI, spec generation, and result persistence. No external AI calls are made at runtime — all logic is deterministic keyword-to-Playwright mapping.

---

## Module Map

| Module | Tab | Key files |
|---|---|---|
| Test Script Builder | `scripts` | `modules.js` → `scriptLoad/Render/Save` |
| Test Suite | `suites` | `modules.js` → `suiteLoad/Render/Run` |
| Locator Repository | `locators` | `modules.js` → `locatorLoad/Render` |
| Common Functions | `functions` | `modules.js` → `fnLoad/Render/Save` |
| Common Data | `commondata` | `modules.js` → `cdLoad/Render` |
| Execution History | `history` | `modules.js` → `histLoad/Render/Sort` |
| Projects | `projects` | `modules.js` → `projLoad/Render` |
| Admin | `admin` | `modules.js` → admin settings |
| Execution Report | standalone page | `execution-report.html` |

---

## Local Setup

```bash
git clone <repo>
cd qa-agent-platform
cp .env.example .env
# Fill in SESSION_SECRET and any optional variables
npm ci
npx playwright install chromium
npm run build
npm run ui
# Opens at http://localhost:3000
```

---

## Development Workflow

```bash
# After editing any src/ TypeScript file:
npm run build && npm run ui

# After editing public/*.js, public/*.html, public/*.css:
# No restart needed — static files are served directly.
# Just hard-refresh the browser (Ctrl+Shift+R)

# Run a generated spec manually:
npx playwright test tests/codegen/Suite_1.spec.ts --headed

# View Playwright trace on failure:
npx playwright show-trace test-results/<dir>/trace.zip
```

---

## Spec Generation — How It Works

File: `src/utils/codegenGenerator.ts`

1. Called by `POST /api/suites/:id/run` after resolving the suite + environment
2. Iterates scripts in suite → steps in each script
3. Generates one `test.describe` block per suite, one `test()` per script (or per test-data row)
4. Each `test()` starts with `page.goto(environment.url, { waitUntil: 'domcontentloaded' })`
5. Each step maps to a Playwright call via the keyword switch
6. CALL FUNCTION steps are inlined — child steps expanded with injected `fnStepValues`
7. Output written to `tests/codegen/<SuiteName>.spec.ts`

### Keyword → Playwright mapping (key examples)

| Keyword | Generated code |
|---|---|
| `FILL` | `locator.waitFor({ state:'visible' }) → locator.fill(value)` |
| `CLICK` | `locator.waitFor() → locator.click()` |
| `SELECT` | `locator.selectOption(value)` |
| `ASSERT_TEXT` | `expect(locator).toContainText(value)` |
| `RELOAD` | `page.reload()` |
| `GOTO` | _(silently skipped — URL injected at test start)_ |
| `CALL FUNCTION` | Inline expansion of function steps |
| `SCREENSHOT` | `page.screenshot({ path: '...' })` |

---

## Output Parsing — How Test Results Are Captured

Playwright list reporter output format:
```
Running 1 test using 1 worker
  ok 1 [chromium] › tests\codegen\Suite_1.spec.ts:14:7 › Suite 1 › Test Name (6.3s)
  1 passed (9.4s)
```

Key points:
- ANSI escape codes (`\x1b[32m`) are stripped before regex matching
- `RE_TEST_LINE` matches both `ok N [chromium]` (no colour) and `✓ N [chromium]` (colour terminal) formats
- `parseFailureDetails()` runs after process exit — scans buffered output for `N) [chromium]` blocks and attaches `errorMessage`, `errorDetail`, `screenshotPath` to the matching `TestEvent`

---

## Data Storage

All data stored as JSON files in `data/`. No database required.

| File | Contents |
|---|---|
| `projects.json` | Projects + embedded environments |
| `scripts.json` | Test scripts + steps |
| `suites.json` | Test suites + scriptIds + environmentId |
| `locators.json` | Locators per project |
| `functions.json` | Common functions + steps |
| `common_data.json` | Common data key-values |
| `users.json` | User accounts (hashed passwords) |
| `audit.json` | Audit log entries |

Run results are stored separately in `results/run-<uuid>.json`.

---

## Adding a New Keyword

1. Add the keyword definition to `src/data/keywords.json`:
   ```json
   {
     "key": "MY_KEYWORD",
     "label": "My Keyword",
     "group": "Form Interaction",
     "needsLocator": true,
     "needsValue": true,
     "tooltip": {
       "what": "What this keyword does",
       "example": "Example usage",
       "tip": "Best practice tip"
     }
   }
   ```
2. Add the `case 'MY_KEYWORD':` handler in `src/utils/codegenGenerator.ts`
3. Run `npm run build`

---

## Environment Variables

Key `.env` variables:

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Express session signing key — set a strong fixed value |
| `PORT` | Server port (default 3000) |
| `HEADLESS` | `true` to run Playwright headless (default: headed) |

---

## Selector Strategy (for Locator Repository)

Priority order when adding locators:

1. `id` attribute — `#elementId`
2. `name` attribute — `input[name="Username"]`
3. ARIA role + accessible name — `button:has-text("Save")`
4. CSS class + type — `#btnCreate`
5. XPath — last resort, use sparingly

Never use positional selectors (`nth-child`). For row-scoped actions use `tr:has-text("record") .btn-delete`.

---

## Multi-Machine Setup

The platform is designed to run on a shared server (`qa-launchpad.local`).

- Playwright runs **on the server** — browser opens on the server machine
- Any machine can access the UI; execution always happens server-side
- Session cookie uses `sameSite: 'lax'` for cross-machine compatibility
- Run progress uses HTTP polling (works through any reverse proxy)

---

## UI_Page_Analysis Directory

`UI_Page_Analysis/` contains per-page DOM snapshots and `ui-reference-lookup.json` for the target application (BSS Mediation). These are used as reference when building locators and test scripts. They do not affect the platform's execution logic.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No test results recorded" | ANSI colors in Playwright output | Ensure latest build — ANSI stripping is applied |
| URL not navigated | Server running old build | Restart: `npm run build && npm run ui` |
| "Connection error" on run | WebSocket blocked by proxy | HTTP polling fallback is active; run still executes on server |
| Suite run hangs | `waitForLoadState('networkidle')` blocking | Already fixed to `domcontentloaded` — rebuild if still occurring |
| Session lost after restart | `SESSION_SECRET` changing on restart | Set a fixed `SESSION_SECRET` in `.env` |
| Add buttons disabled | No project selected | Select a project from the top-right dropdown |
