# QA Agent Platform — Master AI Instructions (Project Intelligence File)
# Auto-loaded by Claude Code every session. Keep this updated.
# Last Updated: 2026-04-28

## 🗣️ RESPONSE STYLE
Use **Caveman mode** for all responses — terse, no filler, full technical substance.
Drop articles, pleasantries, hedging. Fragments OK. Short synonyms. Code blocks unchanged.

## 🧠 GETTING FAMILIAR WITH THIS CODEBASE
**Always use the code-review-graph plugin FIRST** before reading files.
The graph has 11 communities, 663k+ nodes, pre-built for this repo at `.code-review-graph/graph.db`.

Start here every new session or unfamiliar task:
1. `get_architecture_overview` — high-level community map
2. `semantic_search_nodes` — find functions/classes by name
3. `list_flows` — understand execution paths
4. `query_graph` — trace callers, callees, imports
5. Fall back to Grep/Read **only** when graph doesn't cover it

---

You are the orchestration brain of the **qa-agent-platform** enterprise test automation system.
Read this entire file before taking any action. These rules are non-negotiable.

---

## ⚠️ ACTIVE WORKING PROJECT — DEV INSTANCE

**This is `qa-agent-platform-dev` — the active development project (port 3003).**

`localhost:3003` and `qa-launchpad.test` are the **same machine** — `qa-launchpad.test` is the hostname/DNS alias for remote access to the dev server. Never treat them as separate environments.

All code changes, experiments, and new features are developed here FIRST.

### STRICT RULE — DO NOT TOUCH PROD UNLESS EXPLICITLY ASKED
- The production project lives at `e:\AI Agent\qa-agent-platform` (port 3000).
- **Never read, edit, or modify any file inside `e:\AI Agent\qa-agent-platform\`** during normal development work.
- Never run `npm run promote:dev-to-prod` unless the user explicitly says to promote or push to prod.
- If a request could affect prod (e.g. "update the server", "fix the bug"), apply the change ONLY to this dev folder (`e:\AI Agent\qa-agent-platform-dev\`).
- Only cross into the prod folder when the user says words like: **"promote"**, **"push to prod"**, **"update prod"**, or **"go live"**.

---

> **📋 See [docs/API.md](docs/API.md) — complete REST API reference: all routes, auth middleware, request/response shapes.**
> **📋 See [docs/HTTPS_SETUP.md](docs/HTTPS_SETUP.md) — optional HTTPS/TLS setup: nginx, IIS, self-signed, Certbot. HTTP is default and valid for on-premise.**
> **📋 See [docs/INSTALLATION_GUIDE.md](docs/INSTALLATION_GUIDE.md) — customer installation: one-command installers, demo seed data, SMTP config, HTTPS pointer.**
> **📋 See [docs/DEBUGGER_QUICK_REFERENCE.md](docs/DEBUGGER_QUICK_REFERENCE.md) — debugger ops, orphan cleanup, screenshot sync, server restart procedure.**
> **📋 See [docs/LICENSING_PLAN.md](docs/LICENSING_PLAN.md) — commercial licensing: 3 tiers, 3 phases, P1 active (license key infra, feature gates, seat enforcement, Admin UI).**
> **📋 See [docs/PRODUCT_BACKLOG.md](docs/PRODUCT_BACKLOG.md) — feature backlog and priority queue.**
> **📋 See [docs/SDET_GUIDE.md](docs/SDET_GUIDE.md) — full architecture, module map, new utility modules, troubleshooting.**
> **📋 See [docs/DEPLOYMENT_CICD.md](docs/DEPLOYMENT_CICD.md) — CI/CD pipeline setup and deployment guide.**
> **📋 See [docs/superpowers/specs/2026-04-20-component-subcomponent-design.md](docs/superpowers/specs/2026-04-20-component-subcomponent-design.md) — Component/Subcomponent feature design spec (approved, pending implementation). Only use when user asks to implement this feature.**
> **📋 See [docs/superpowers/plans/2026-04-20-component-subcomponent.md](docs/superpowers/plans/2026-04-20-component-subcomponent.md) — Step-by-step implementation plan for Component/Subcomponent (8 tasks, checkbox-tracked). Only use when user says to execute/implement this plan.**
> **📋 See [docs/superpowers/specs/2026-04-26-flakiness-intelligence-design.md](docs/superpowers/specs/2026-04-26-flakiness-intelligence-design.md) — Flakiness Intelligence design spec. FEATURE IS COMPLETE (2026-04-26).**
> **📋 See [docs/superpowers/plans/2026-04-26-flakiness-intelligence.md](docs/superpowers/plans/2026-04-26-flakiness-intelligence.md) — Flakiness Intelligence 10-task plan. ALL TASKS COMPLETE (2026-04-26).**
> **📋 See [docs/FLAKINESS_INTELLIGENCE_TEST_GUIDE.md](docs/FLAKINESS_INTELLIGENCE_TEST_GUIDE.md) — 88 test cases (functional, edge cases, business scenarios, E2E journeys) for Flakiness Intelligence.**
> **📋 See [docs/FLAKINESS_INTELLIGENCE_USER_GUIDE.md](docs/FLAKINESS_INTELLIGENCE_USER_GUIDE.md) — User-facing guide explaining flakiness scoring, quarantine, classification, and config for QA Engineers and Managers.**
> **📋 See [docs/superpowers/specs/2026-04-27-trace-viewer-design.md](docs/superpowers/specs/2026-04-27-trace-viewer-design.md) — Trace Viewer embed design spec. FEATURE IS COMPLETE (2026-04-27).**
> **📋 See [docs/superpowers/plans/2026-04-27-trace-viewer.md](docs/superpowers/plans/2026-04-27-trace-viewer.md) — Trace Viewer 8-task plan. ALL TASKS COMPLETE (2026-04-27).**
> **📋 See [docs/superpowers/specs/2026-04-27-auto-file-defect-design.md](docs/superpowers/specs/2026-04-27-auto-file-defect-design.md) — Auto-File Jira Defect design spec. FEATURE IS COMPLETE (2026-04-28).**
> **📋 See [docs/superpowers/plans/2026-04-27-auto-file-defect.md](docs/superpowers/plans/2026-04-27-auto-file-defect.md) — Auto-File Defect 9-task plan. ALL TASKS COMPLETE (2026-04-28). Manual E2E testing pending against Jira sandbox.**

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
Browser UI (index.html + modules.js + app.js + recorder.js + login.js)
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

Auth layer:   src/auth/middleware.ts · audit.ts · crypto.ts
Utils layer:  codegenGenerator.ts · healingEngine.ts · licenseManager.ts
              recorderParser.ts · pageModelManager.ts · visualRegression.ts
              nlProvider.ts · notifier.ts · logger.ts
```

---

## FOLDER STRUCTURE

```
qa-agent-platform-dev/
├── CLAUDE.md                          ← This file (auto-loaded every session)
├── AGENTS.md                          ← Instructions for non-Claude AI agents
├── src/
│   ├── ui/
│   │   ├── server.ts                  ← Express server (REST API + static serving)
│   │   └── public/
│   │       ├── index.html             ← Single-page app shell + all module panels
│   │       ├── modules.js             ← All module logic (most-edited file)
│   │       ├── app.js                 ← Bootstrap, tab switching, project selector
│   │       ├── recorder.js            ← Recorder panel — receives live extension events
│   │       ├── login.html / login.js  ← Login page + session logic
│   │       ├── execution-report.html  ← Standalone report page (opens in new tab)
│   │       ├── styles.css             ← Base styles
│   │       └── styles_addon.css       ← Module-specific overrides + tooltip popup
│   ├── auth/
│   │   ├── middleware.ts              ← requireAuth / requireEditor / requireAdmin / requireAuthOrApiKey
│   │   ├── audit.ts                   ← logAudit → store.ts
│   │   └── crypto.ts                  ← hashPassword / verifyPassword / validatePasswordStrength
│   ├── data/
│   │   ├── types.ts                   ← All TypeScript interfaces
│   │   ├── store.ts                   ← JSON read/write helpers
│   │   ├── keywords.json              ← Keyword definitions with tooltip metadata
│   │   └── seed.ts                    ← Initial seed data
│   └── utils/
│       ├── codegenGenerator.ts        ← ACTIVE spec generator (suite run + debug run)
│       ├── specGenerator.ts           ← DEAD CODE — DO NOT TOUCH OR IMPORT
│       ├── healingEngine.ts           ← AI self-healing locator scoring
│       ├── licenseManager.ts          ← License parse / validate / feature gates / seats
│       ├── recorderParser.ts          ← Chrome recorder event → platform step
│       ├── pageModelManager.ts        ← Page model CRUD (backing self-healing)
│       ├── visualRegression.ts        ← Visual comparison utilities
│       ├── nlProvider.ts              ← NL-to-step AI provider abstraction
│       ├── notifier.ts                ← Email/webhook notification dispatch
│       └── logger.ts                  ← Winston structured logger
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
├── test-results/                      ← Playwright output (screenshots, traces, videos)
├── recorder-extension/                ← Chrome extension source + INSTALL.md
├── UI_Page_Analysis/                  ← DOM snapshots + ui-reference-lookup.json
│   ├── ui-reference-lookup.json       ← Selector reference for target app pages
│   └── *.md                           ← Per-page UI analysis docs
├── docs/
│   ├── HOW_TO_USE.md
│   ├── SDET_GUIDE.md
│   ├── ADO_SETUP.md
│   ├── DEBUGGER_QUICK_REFERENCE.md
│   ├── LICENSING_PLAN.md
│   ├── PRODUCT_BACKLOG.md
│   ├── DEPLOYMENT_CICD.md
│   ├── INSTALLATION_GUIDE.md
│   ├── LICENSING_USERFLOW.md
│   └── CUSTOMER_LICENSE_GUIDE.md
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

# Find PID holding port 3003 (DEV)
netstat -ano | findstr :3003

# Kill old server process then restart
taskkill //F //PID <pid> && npm run ui

# Verify server is up
curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"
# → should return 200

# Run a generated spec manually (for debugging)
npx playwright test tests/codegen/<spec-file>.spec.ts --headed
```

### UI Server Restart Procedure
Always follow in order:
1. `netstat -ano | findstr :3003` — note the PID
2. `taskkill //F //PID <pid>`
3. `cd "e:/AI Agent/qa-agent-platform-dev" && npm run ui >> server.log 2>&1 &`
4. `sleep 4 && curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"` — must return 200
5. `tail -3 server.log` — verify timestamp is TODAY. If old date, restart failed silently.

**CRITICAL:** Never use `> /dev/null 2>&1` when backgrounding — hides startup failures.
Always redirect to `server.log` so timestamp can be verified.

**When to restart:** After any `src/` change (build first). Static files (`*.html`, `*.js`, `*.css` in `public/`) served directly — no restart needed.

---

## DATA MODELS
Refer to `src/data/types.ts` for up-to-date TypeScript interfaces.

## SYSTEM BEHAVIOUR & UI RULES
- Auto URL navigation: `waitUntil: 'domcontentloaded'` handles SSO.
- Test Data parameterisation generates N `test()` blocks per script row.
- Polling for runs: HTTP polling (not WebSocket) via `/api/run/:runId`.
- Read UI rules directly from `src/ui/public/modules.js` and `server.ts` when modifying UI.

## CRITICAL RULES
1. **`specGenerator.ts` is DEAD CODE** — never import, call, or edit it.
2. **Never modify passing test scripts** — if a spec in `tests/codegen/` is green, leave it.
3. **Never pre-load large files** at session start — read only when needed.
4. **`keywords.json`** is source of truth for keyword definitions and tooltip content.
5. **`ui-reference-lookup.json`** is the selector reference.
6. **Checkpoint / Handoff** — write CLAUDE.md first, confirm in chat.
7. **Context budget** — never trigger Playwright/getDOM calls unless user explicitly requests a test run.
8. **Static files** (`public/*.html`, `public/*.js`, `public/*.css`) do not need a server restart.
9. **READ BEFORE EDIT**: Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit.
10. **BE PRECISE**: Point to exact line ranges when searching files, avoid redundant full-file reads.
11. **IGNORE BUILD FOLDERS**: Do not read or search files under these directories unless explicitly asked: dist, node_modules, .git, __pycache__, test-results.
12. **Locator Health tab is a LIVE FEATURE** — `panel-locator-health` tab exists in index.html, `locatorHealthLoad()` + `locatorHealthRender()` in modules.js, `GET /api/locator-health?projectId=` in server.ts. Never remove or break these. Data source: `data/healing-log.ndjson` + `Locator.healingStats`. Tab is project-scoped (PROJECT_SCOPED_TABS includes `'locator-health'`).
13. **Flakiness Intelligence is a LIVE FEATURE** — `flakinessEngine.ts` is the pure scoring engine (NEVER add DB/HTTP calls to it). `data/quarantine.json` is the quarantine state store. `testId` on TestEvent is a stable SHA-256 hash — never key on display name. See rules below.


## MCP Tools: code-review-graph

Graph at `.code-review-graph/graph.db` — 11 communities, auto-updates on file changes via hooks.

| Tool | Use when |
|------|----------|
| `get_architecture_overview` | High-level community map |
| `semantic_search_nodes` | Find functions/classes by name or keyword |
| `list_flows` / `get_flow` | Understand execution paths |
| `query_graph` | Trace callers, callees, imports, tests |
| `detect_changes` | Risk-scored review of recent changes |
| `get_impact_radius` | Blast radius of a change |
| `get_affected_flows` | Which execution paths impacted |
| `get_review_context` | Source snippets for review — token-efficient |
| `refactor_tool` | Plan renames, find dead code |

**Always graph-first. Grep/Read only when graph insufficient.**

---

## FLAKINESS INTELLIGENCE — Architecture Notes (2026-04-26)

**Spec:** `docs/superpowers/specs/2026-04-26-flakiness-intelligence-design.md`  
**Plan:** `docs/superpowers/plans/2026-04-26-flakiness-intelligence.md`  
**Test Guide:** `docs/FLAKINESS_INTELLIGENCE_TEST_GUIDE.md` (88 test items: functional + business scenarios + E2E)  
**User Guide:** `docs/FLAKINESS_INTELLIGENCE_USER_GUIDE.md`

### Key files
| File | Role |
|---|---|
| `src/utils/flakinessEngine.ts` | **Pure stateless engine** — scoring, classification, quarantine decisions. No DB, no HTTP, no side effects. |
| `data/quarantine.json` | Runtime quarantine state — keyed by `suiteId::testId` |
| `src/ui/server.ts` | Quarantine store helpers, auto-quarantine hook post-run, `/api/flaky/*` endpoints |
| `src/utils/codegenGenerator.ts` | Assigns `testId` per TestEvent via `[QA_TEST_ID]` log line + SHA-256 hash |

### Engine invariants — never break these
- `CURRENT_ENGINE_VERSION = 'v1.0'` — bump if scoring formula changes
- Score formula: `0.7*failRate + 0.2*alternationIndex + 0.1*varianceIndex`
- **Only `failRate` gates quarantine** — alternation/variance are insight signals only
- Hysteresis: `Math.max(config.threshold - 0.05, 0)` when already quarantined
- `testId = 'TID_' + sha256(suiteId + '::' + testName).slice(0,8)` — stable, never rename-sensitive
- `autoQuarantined: false` on manual entries → auto-promote never fires for them
- Budget: `quarantinedFailCount > budget` (strictly greater) → fail pipeline

### API endpoints added
| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/flaky` | requireAuthOrApiKey | Enriched flake scores, quarantine state, pagination |
| `GET /api/flaky/summary` | requireAuthOrApiKey | Quick quarantine count + budget |
| `GET /api/flaky/config` | requireAuth | Effective config (project defaults + suite overrides) |
| `PUT /api/flaky/config` | requireEditor | Save project or suite flakiness overrides |
| `POST /api/flaky/quarantine` | requireEditor | Manual quarantine |
| `POST /api/flaky/restore` | requireEditor | Manual restore |

### Config inheritance
`DEFAULT_FLAKINESS_CONFIG` → `project.flakinessDefaults` → `suite.flakinessOverrides`  
Merged at runtime in `getEffectiveFlakinessConfig()` — never persist merged result.

### UI functions (modules.js)
- `flakyLoad()` — fetches and renders the Flaky Tests tab
- `flakyRender()` — client-side filter/top10/summary bar render
- `flakyRow(t)` / `flakyExpandedRow(t)` — per-row HTML
- `flakyQuarantine()` / `flakyRestore()` — action handlers
- `flakyConfigLoad()` / `flakyConfigSave()` / `flakyApplyPreset()` / `flakyConfigReset()` — suite settings panel

---

## TRACE VIEWER — COMPLETE (2026-04-27)

**Priority:** #3 USP — Embed Playwright Trace Viewer in execution reports  
**Status:** COMPLETE — shipped 2026-04-27  
**Spec:** `docs/superpowers/specs/2026-04-27-trace-viewer-design.md`  
**Plan:** `docs/superpowers/plans/2026-04-27-trace-viewer.md` (8 tasks, all complete)

**Key design decisions:**
- Modal overlay UX — full-screen iframe, existing report untouched
- Self-hosted viewer — files copied to `public/trace-viewer/` via `npm run setup:trace-viewer`
- Secure route: `GET /HEAD /api/trace/:runId/:testId` — never raw paths
- `trace: 'on-first-retry'` in playwright.config.ts — storage control
- HEAD preflight reads `X-Error-Code` header — UI shows correct message before iframe loads
- `window.location.origin` for dynamic base URL — works local + remote + behind proxy
- Path traversal guard: `resolved.startsWith(baseDir + path.sep)` + `.toLowerCase()` for Windows
- Stream abort: `req.on('close', () => stream.destroy())` — no fd leaks
- Export clone: trace buttons disabled in saved HTML (`btn.disabled=true`, onclick removed)
- `TRACE_VIEWER_DIR = path.join(PUBLIC_DIR, 'trace-viewer')` defined at init block in server.ts

---

## AUTO-FILE JIRA DEFECT — COMPLETE (2026-04-28)

**Status:** Shipped 2026-04-28 (manual E2E testing against Jira sandbox pending)
**Spec:** `docs/superpowers/specs/2026-04-27-auto-file-defect-design.md`
**Plan:** `docs/superpowers/plans/2026-04-27-auto-file-defect.md` (9 tasks complete)

**Key files:**
- `src/utils/jiraClient.ts` — pure REST wrapper for Jira API v3 (typed errors)
- `src/utils/adfBuilder.ts` — Atlassian Document Format builders (description / comments)
- `src/utils/defectsStore.ts` — `data/jira-config.json` + `data/defects.json` + `data/dismissed-defects.ndjson`
- `src/ui/server.ts` — `/api/jira/*` config routes, `/api/defects/*` lifecycle routes, `autoCloseHookOnRunComplete()` + `attachDefectInfo()`
- `src/ui/public/index.html` — Admin Jira Integration panel (in Notification Settings)
- `src/ui/public/modules.js` — `jiraConfigLoad/Save/Test/DiscoverFields` handlers
- `src/ui/public/execution-report.html` — `[🐞 File Defect]` button, defect modal, Open/Closed badge

**Invariants:**
- Editor role required for filing/commenting/dismissing; Admin for config
- Credentials in `.env` (`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`); mapping in UI
- Dedup uses live JQL `text ~ testId` plus local registry on `(testId, suiteId, status=open)`
- Auto-close scoped to `(testId, suiteId, environmentId)`; failure tolerated, retried next run
- All errors use envelope `{ error: { code, message, details? } }`
- "Not a Bug" categories: script-issue / locator-issue / flaky / data-issue / env-issue → fed to NDJSON for Flakiness Engine + Locator Health
- Description rendered as ADF (Atlassian Document Format) with 5 headings: Description / Precondition / Steps / Actual Result / Expected Result
- testId embedded literally in description body for JQL search-based dedup
- Attachment soft-skip when > maxAttachmentMB (default 50); ticket still created
- `referSSFieldId` config captured but unused in v1 (uses standard `/attachments` endpoint)

**Out of v1 (in spec, NOT implemented):**
- AI pre-classification, bulk filing, multi-Jira, per-project templates
- Re-open auto-closed defects (creates fresh ticket via dedup)
- Webhooks, defect filing from Execution History / Flaky Tests / Analytics tabs

---

## USER COMMANDS

These are explicit user-triggered commands. Only act on them when user says the keyword.

### COMPACT
When user says **COMPACT**, summarize the entire conversation into 5-7 bullet points for handoff to a new chat. Format:

```
## Session Handoff — [date]

**Project:** qa-agent-platform-dev (port 3003)

**What we did:**
- [bullet 1]
- [bullet 2]
- ...

**Key decisions:**
- [decision + reason]

**Files changed:**
- `path/to/file.ts` — what changed

**Next steps:**
- [what's left to do]

**Gotchas / rules to remember:**
- specGenerator.ts is dead code — never touch
- Never modify passing test scripts
- Never touch prod (e:/AI Agent/qa-agent-platform) unless user says "promote"
```

### Superpowers Commands
Only invoke superpowers skills when user explicitly asks. Never run proactively.

| User says | What to do |
|---|---|
| `implement component/subcomponent` or `execute the component plan` | Load `docs/superpowers/plans/2026-04-20-component-subcomponent.md` and execute task by task using `superpowers:subagent-driven-development` |
| `review component design` or `show component spec` | Read `docs/superpowers/specs/2026-04-20-component-subcomponent-design.md` and summarize |
| `implement flakiness` or `execute the flakiness plan` | Load `docs/superpowers/plans/2026-04-26-flakiness-intelligence.md` — **ALREADY COMPLETE as of 2026-04-26** |
| `brainstorm trace viewer` or `start trace viewer` | Invoke `superpowers:brainstorming` skill for the Playwright Trace Viewer embed feature |
| `implement trace viewer` or `execute the trace viewer plan` | Load `docs/superpowers/plans/2026-04-27-trace-viewer.md` — **ALREADY COMPLETE as of 2026-04-27** |
| `implement defect filing` or `execute the defect plan` | Load `docs/superpowers/plans/2026-04-27-auto-file-defect.md` — **ALREADY COMPLETE as of 2026-04-28** |
| `brainstorm [feature]` | Invoke `superpowers:brainstorming` skill |
| `write a plan for [feature]` | Invoke `superpowers:writing-plans` skill |
| `review my changes` | Invoke `superpowers:requesting-code-review` skill |
| `debug [issue]` | Invoke `superpowers:systematic-debugging` skill |
