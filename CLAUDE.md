# QA Agent Platform — Master AI Instructions (Project Intelligence File)
# Auto-loaded by Claude Code every session. Keep this updated.
# Last Updated: 2026-05-04

---

## 🚨 MANDATORY PRE-CHANGE PROTOCOL (NON-NEGOTIABLE)

**BEFORE making ANY code change, you MUST stop and answer all of the following out loud to the user:**

### 1. Root Cause Confirmed?
- State exactly what is broken and WHY — not what the symptom is.
- Cite the specific file + line number where the root cause lives.
- If root cause is not confirmed with evidence, DO NOT propose a fix. Gather more evidence first.

### 2. Impact Analysis
Present a table with the following for every affected component:

| Question | Answer |
|---|---|
| What does this code do TODAY? | (exact current behaviour) |
| What will it do AFTER the change? | (exact new behaviour) |
| What else calls / depends on this? | (list all callers, consumers) |
| Does this break any existing passing behaviour? | (yes/no + reason) |
| Was this behaviour working before? If yes, what changed? | (regression check) |

### 3. Mandatory Questions to User BEFORE coding
Ask the user these questions and wait for answers:
- "This change affects [X]. Currently it works by [Y]. After the change it will work by [Z]. Do you want to proceed?"
- "Were there any passing runs of [feature] before this session that I should check first?"
- "Is there any scenario where the current behaviour must be preserved?"

### 4. Check Historical Evidence
- Search `results/` for passing runs of the affected feature BEFORE assuming something is broken.
- If passing runs exist — find the diff between then and now BEFORE touching code.
- Never assume "it was never working" without checking run history.

### 5. One Change at a Time
- Fix ONE root cause per change.
- Do not bundle multiple hypotheses into one edit.
- If a fix doesn't work — stop, re-investigate, do NOT layer another fix on top.

### 6. Comment-Out Rule (NEVER DELETE OLD CODE)
- **Never delete existing code.** Comment it out and add new code alongside it.
- Format:
  ```ts
  // OLD: <one line explaining what this did and why it changed>
  // const oldCode = ...;
  const newCode = ...;
  ```
- This makes before/after visible inline without hunting git history.
- **Commented-out code is only removed when the user explicitly says so** — e.g. "clean up", "remove old code", "delete the comments".
- Never remove on a timer, never remove after assuming testing is complete.
- Cleanup is a deliberate user-triggered action only.

**Violation of this protocol caused the `--workers=1` regression (2026-05-04): a fix for test ordering broke multi-browser Firefox execution that was previously working. The fix took 8 iterations because impact analysis was skipped.**

**Firefox "browserContext.newPage: Target page, context or browser has been closed" RCA (2026-05-04, Run 40987611):**
- **NOT** a Playwright binary issue. **NOT** a beforeAll fixture issue. **NOT** a video recording issue.
- **ACTUAL RCA:** `suites.routes.ts:198` used `req.body.headed !== false` → defaulted to `headed: true` when UI omits the field → server spawned Playwright with `--headed` flag → Firefox headed mode requires an interactive desktop session → Windows Server has no desktop for the server process → context closed immediately at `newPage`.
- **Fix:** changed to `req.body.headed === true` → headless by default unless UI explicitly requests headed.
- **Proof:** spec ran headless from terminal (`npx playwright test ... --project=firefox`) → passed. Same spec via UI (headed) → failed. After fix → Run 40987611 passed all browsers.
- **Secondary fix:** Scheduled tasks re-registered as `harmeet.saini` (not SYSTEM) with `Interactive/Background` logon mode so services survive RDC disconnect with correct user context.

---

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
> **📋 See [docs/superpowers/specs/2026-05-02-api-testing-design.md](docs/superpowers/specs/2026-05-02-api-testing-design.md) — API Testing Module design spec (v2.0, approved, ready for implementation).**
> **📋 See [docs/superpowers/plans/2026-05-02-api-testing-phase1.md](docs/superpowers/plans/2026-05-02-api-testing-phase1.md) — API Testing Phase 1 plan: Foundations (Wks 1–2) — types, store, CRUD routes, encryption.**
> **📋 See [docs/superpowers/plans/2026-05-02-api-testing-phase2.md](docs/superpowers/plans/2026-05-02-api-testing-phase2.md) — API Testing Phase 2 plan: Engine Core (Wks 3–4) — DAG, runner, assertions, auth, variable resolution.**
> **📋 See [docs/superpowers/plans/2026-05-02-api-testing-phase3.md](docs/superpowers/plans/2026-05-02-api-testing-phase3.md) — API Testing Phase 3 plan: Import Engines (Wk 5) — OpenAPI, Postman, cURL.**
> **📋 See [docs/superpowers/plans/2026-05-02-api-testing-phase4.md](docs/superpowers/plans/2026-05-02-api-testing-phase4.md) — API Testing Phase 4 plan: Frontend + Integration (Wks 6–8) — 3 UI modules, flakiness, Jira, self-healing, suite runner, HAR viewer.**
> **📋 See [docs/superpowers/plans/2026-05-02-api-testing-phase5.md](docs/superpowers/plans/2026-05-02-api-testing-phase5.md) — API Testing Phase 5 plan: Advanced (Wks 9–11) — baselines, contract drift, Faker data, pre/post scripts.**
> **📋 See [docs/superpowers/specs/2026-05-16-phase-d-step5-workflow-graph-projection-design.md](docs/superpowers/specs/2026-05-16-phase-d-step5-workflow-graph-projection-design.md) — Phase D Step 5: Workflow Graph Projection design spec (approved, pending implementation). Read-only graph projection contracts, builder, service, GET /api/workflows/:collectionId/graph endpoint.**
> **📋 See [docs/superpowers/plans/2026-05-16-phase-d-step5-workflow-graph-projection.md](docs/superpowers/plans/2026-05-16-phase-d-step5-workflow-graph-projection.md) — Phase D Step 5 implementation plan (11 tasks). **COMPLETE as of 2026-05-17.**
> **📋 See [docs/superpowers/plans/2026-05-17-phase-d-step8-api-flakiness-analytics.md](docs/superpowers/plans/2026-05-17-phase-d-step8-api-flakiness-analytics.md) — Phase D Step 8 implementation plan (12 tasks). **COMPLETE as of 2026-05-17.**
> **📋 See [docs/superpowers/plans/2026-05-19-phase-d-step9-api-defect-intelligence.md](docs/superpowers/plans/2026-05-19-phase-d-step9-api-defect-intelligence.md) — Phase D Step 9 implementation plan (11 tasks). **COMPLETE as of 2026-05-19.**
> **📋 See [docs/superpowers/plans/2026-05-19-phase-d-step10-suite-orchestration.md](docs/superpowers/plans/2026-05-19-phase-d-step10-suite-orchestration.md) — Phase D Step 10 implementation plan (10 tasks). **COMPLETE as of 2026-05-19.**
> **📋 See [docs/superpowers/plans/2026-05-19-phase-d-step11-observability-replay.md](docs/superpowers/plans/2026-05-19-phase-d-step11-observability-replay.md) — Phase D Step 11 implementation plan (8 tasks). **COMPLETE as of 2026-05-19.**
> **📋 See [docs/superpowers/plans/2026-05-20-phase-d-step12-distributed-execution-readiness.md](docs/superpowers/plans/2026-05-20-phase-d-step12-distributed-execution-readiness.md) — Phase D Step 12 implementation plan (8 tasks). **COMPLETE as of 2026-05-20.**
> **📋 See [docs/superpowers/plans/2026-05-20-phase-d-step13-enterprise-governance.md](docs/superpowers/plans/2026-05-20-phase-d-step13-enterprise-governance.md) — Phase D Step 13 implementation plan (8 tasks). **COMPLETE as of 2026-05-20.**
> **📋 See [docs/superpowers/plans/2026-05-21-phase-d-step14-ai-workflow-intelligence.md](docs/superpowers/plans/2026-05-21-phase-d-step14-ai-workflow-intelligence.md) — Phase D Step 14 implementation plan (8 tasks). **COMPLETE as of 2026-05-21.**

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

> See `AGENTS.md` for the full folder structure and entry point table. Key paths below:

- **Edit frontend:** `src/ui/public/js/*.js` → `npm run build:js` → `modules.js`
- **Edit backend:** `src/ui/server.ts` + `src/utils/*.ts` → `npm run build` → restart server
- **Data models:** `src/data/types.ts` | **Store helpers:** `src/data/store.ts` | **Keywords:** `src/data/keywords.json`

---

## KEY COMMANDS

```bash
# Build TypeScript (ALWAYS run before restarting server after any src/ change)
npm run build

# Build frontend modules (ALWAYS run after editing any file in src/ui/public/js/)
npm run build:js

# Build and restart UI server
npm run build && npm run ui

# Find PID holding port 3003 (DEV) — report to user, do NOT kill
netstat -ano | findstr :3003

# ⚠️ Agent must NOT kill or restart the server — Admin-managed process
# User restarts via: Admin → Settings → Reset Server button
# or: force-kill the PID manually, then use Reset button

# Verify server is up (read-only check — safe for agent to run)
curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"
# → should return 200 or 302 (redirect to login)

# Run a generated spec manually (for debugging)
npx playwright test tests/codegen/<spec-file>.spec.ts --headed
```

### UI Server Restart Procedure

> ⚠️ **AGENT CANNOT RESTART THE SERVER.**
> The server runs under `setup-persistent-monitors.ps1` with **Admin privileges**.
> Agent-level `taskkill` and `npm run ui` commands will fail silently or be blocked.

**When a restart is needed after a backend `src/` change:**
1. Tell the user: *"Server restart needed — please use Admin → Settings → Reset Server button in the UI, or force-kill PID `<pid>` shown by `netstat -ano | findstr :3003` and restart via the Reset button."*
2. Agent responsibility ends at `npm run build` (compile only).
3. Never attempt `taskkill`, `npm run ui`, or any process-launch command for port 3003.
4. Wait for user to confirm server is back up before verifying changes.

**When to restart:** After any `src/` change (always build first). Static files (`*.html`, `*.js`, `*.css` in `public/`) served directly — no restart needed, changes are live immediately.

---

## DATA MODELS
Refer to `src/data/types.ts` for up-to-date TypeScript interfaces.

## SYSTEM BEHAVIOUR & UI RULES
- Auto URL navigation: `waitUntil: 'domcontentloaded'` handles SSO.
- Test Data parameterisation generates N `test()` blocks per script row.
- Polling for runs: HTTP polling (not WebSocket) via `/api/run/:runId`.
- Read UI rules directly from the source files in `src/ui/public/js/` (concatenated into `modules.js`) and `server.ts` when modifying UI.

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
12. **Frontend module source** — edit files in `src/ui/public/js/`, then run `npm run build:js` to regenerate `modules.js`. Never edit `modules.js` directly.
13. **Locator Health tab is a LIVE FEATURE** — `panel-locator-health` tab exists in index.html, `locatorHealthLoad()` + `locatorHealthRender()` in modules.js, `GET /api/locator-health?projectId=` in server.ts. Never remove or break these. Data source: `data/healing-log.ndjson` + `Locator.healingStats`. Tab is project-scoped (PROJECT_SCOPED_TABS includes `'locator-health'`).
14. **Flakiness Intelligence is a LIVE FEATURE** — `flakinessEngine.ts` is the pure scoring engine (NEVER add DB/HTTP calls to it). `data/quarantine.json` is the quarantine state store. `testId` on TestEvent is a stable SHA-256 hash — never key on display name. See rules below.
15. **Token efficiency** — follow rules in `AGENTS.md` § Token Efficiency Rules.


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

## Shipped Features (architecture notes archived)

> Full architecture notes for shipped features are in `docs/ARCHIVED_FEATURE_NOTES.md`.  
> Only the critical invariants remain here.

### Flakiness Intelligence (shipped 2026-04-26)
- Engine: `src/utils/flakinessEngine.ts` — pure, stateless. **Never add DB/HTTP calls.**
- `testId = 'TID_' + sha256(suiteId + '::' + testName).slice(0,8)` — stable, never rename-sensitive
- Only `failRate` gates quarantine; alternation/variance are insight signals only

### Trace Viewer (shipped 2026-04-27)
- Self-hosted at `public/trace-viewer/` — `npm run setup:trace-viewer`
- Secure: `GET /api/trace/:runId/:testId` — never exposes raw paths

### Auto-File Jira Defect (shipped 2026-04-28)
- `src/utils/jiraClient.ts` + `adfBuilder.ts` + `defectsStore.ts`
- Editor role for filing; Admin for config; dedup uses JQL + local registry

### API Suite Orchestration (shipped 2026-05-19)
- Module: `src/api-suite/` — contracts, orchestrator, run-store, routes
- `runSuite()` composes `runCollection` with lifecycle order: beforeAll → beforeEach → main → afterEach → afterAll
- afterAll and afterEach guaranteed via try/finally — run even on failure
- Shared context propagation: beforeAll extracted variables flow into each main collection
- `ApiStepResult.isTeardown` — step-level teardown observability (tagged by engine)
- Store: `data/api-suite-runs/<runId>.json` (atomic write)
- Routes: `GET/POST/PUT/DELETE /api/api-suites`, `POST /api/api-suites/:id/run`, `GET /api/api-suite-runs/:runId`
- UI: `27-api-suites.js` — suite management, lifecycle timeline, run history
- teardown badge in `25-api-runs.js` step table
- Backward compatible: `runCollection` unchanged API (optional 4th param)

### Observability, Replay Engine & Execution Intelligence (shipped 2026-05-19)
- Module: `src/api-observability/` — contracts, synthesizer, store, query, routes
- `synthesizeReplaySession()` — post-hoc, runtime-isolated: converts `ApiCollectionRunResult + ExecutionSnapshot` → `ReplaySession` (immutable, deterministic)
- Replay event store: `data/replay-sessions/<runId>.replay.json` (atomic write, lazy-cached on first GET)
- `getObservabilitySummary()` — aggregates run + timeline + snapshot + replay in one query; try/catch on synthesis (graceful degradation to `replay: null`)
- Routes: `GET /api/api-runs/:runId/observability`, `/replay-events`, `/timeline`
- Contracts: `ReplayEvent`, `ReplaySession`, `RunDiffSummary`, `RcaExtensionPoint` (AI RCA hook — no-op today)
- UI: `28-api-replay.js` — observability summary, replay event list, timeline list, snapshot summary
- Runtime isolation: synthesizer imports ONLY from `data/types`, `shared-core/contracts`, own contracts — zero runtime calls

### API Defect Intelligence (shipped 2026-05-19)
- Module: `src/api-defects/` — enricher, heal-advisor, store, routes
- `buildEnrichedApiDefectAdf` added to `src/utils/adfBuilder.ts`
- Routes: `POST /api/api-defects/draft`, `POST /api/api-defects/file`, `GET /api/api-defects/by-step/:stepId`
- Dedup registry: `data/api-defects.json` (atomic write, `appendApiDefectRecord`)
- UI: "Jira & Heal" tab in `25-api-runs.js` per step — File Defect button, healing suggestions panel
- ADVISORY ONLY — heal advisor never auto-modifies collections or runtime state
- Existing UI-test defect flows (`jira.routes.ts`, `defectsStore.ts`, `healingEngine.ts`) untouched

### Import Pipeline Integration (Phase D Step 3 — 2026-05-16)
- `import-engine-adapter.ts` wraps both Postman and OpenAPI importers
- Route responses now include `{ ...collection, warnings, compatibility, importHealthScore }`
- Rollback: set `USE_LEGACY_POSTMAN_IMPORTER=true` in env → reverts Postman route to legacy util
- Legacy `src/utils/postmanImport.ts` still in place — do not delete
- `parity-validator.ts` — run `validatePostmanParity()` to diff legacy vs new importer outputs

### Distributed Execution Readiness (Phase D Step 12 — shipped 2026-05-20)
- Worker Pool: `src/api-runtime/worker-pool/` — `IWorkerPool`, `SimpleWorkerPool` (round-robin, dispose-aware)
- Execution Leasing: `src/api-runtime/execution-leasing/` — `ILeaseRegistry`, `InMemoryLeaseRegistry` (TTL, expire/release)
- Environment Isolation: `src/api-runtime/environment-isolation/` — `IEnvironmentLockRegistry` (exclusive/shared locks)
- Worker Health: `src/api-runtime/worker-health/` — `aggregatePoolHealth()`, singleton, routes `GET /api/worker-pool/health`, `/stuck-runs`
- Queue Abstraction: `src/api-runtime/orchestration/` — `IExecutionQueue`, `InMemoryExecutionQueue` (priority FIFO)
- Distributed Replay: `src/api-observability/contracts/distributed-replay.contracts.ts` — `IReplayMergeEngine`, `SingleWorkerReplayMerger`
- Cloud Extension: `src/api-runtime/cloud-extension/` — `IWorkerProvider`, `NoOpWorkerProvider` (K8s stub, no-op today)
- UI: `29-worker-health.js` — worker pool health dashboard, `GET /api/worker-pool/health`
- Single-node default unchanged; all contracts IPC-ready (JSON-serialisable)

### Enterprise Governance, RBAC & Auditability (shipped 2026-05-20)
- Module: `src/api-governance/` — rbac.contracts, rbac.middleware, audit.contracts, audit.helper, tenant.contracts, tenant.helper, policy.contracts, policy.registry, environment.governance, routes/governance.routes
- `Role` extended with `'editor'` — all existing role checks valid; `'tester'` unchanged
- `ApiResourcePermission` type + `hasPermission()` + `requirePermission()` factory middleware
- `ApiAuditAction` typed enum + `logApiAudit()` wraps existing `logAudit` — original unchanged
- `TenantContext` + `getTenantContext(req)` — returns null in single-tenant mode
- `InMemoryGovernancePolicyRegistry` — role + restricted-env policy checks; `globalPolicyRegistry` singleton
- `EnvironmentGovernancePolicy` + `maskSensitiveVariables()` — masks variable values in sensitive envs
- Routes: `GET/POST /api/governance/policies`, `GET /api/governance/audit`, `GET /api/governance/tenant`
- UI: `30-governance.js` — tenant card, filterable audit log, policy list + register form
- `ApiCollection.tenantId?: string` — optional, backward-compatible
- All contracts additive, JSON-serialisable; no runtime execution modified

### AI-Assisted Workflow Intelligence (Phase D Step 14 — shipped 2026-05-21)
- Module: `src/api-intelligence/` — contracts, engines, recommendation-service, routes
- Engines: dependency-analyzer, retry-intelligence, flakiness-insights, rca-hint-engine, workflow-quality-analyzer (+ engine-helpers.ts shared factory)
- All engines are pure functions — no DB/HTTP calls; data in → AiRecommendation[] or RcaHint[] out
- recommendation-service.ts: orchestrates all engines, sorts by severity+confidence, applies tenant context, audits via logApiAudit
- Routes: `GET /api/ai-intelligence/collections/:id/recommendations`, `/graph-overlay`, `GET /api/ai-intelligence/runs/:id/rca-hints`
- UI: "AI Insights" tab in run detail view (25-api-runs.js) — RCA hints + collection recommendations, lazy-loaded on tab click
- ADVISORY ONLY — AI must never mutate collections, runtime, WorkflowEnvelope, or retries
- Governance: ApiAuditAction extended with api:intelligence:recommendations:generated + api:intelligence:rca:accessed
- All recommendations include confidence (0–100), provenance (source, basis, evidenceRefs), actionHint
- Graceful degradation: flakinessReport=null and missing replay sessions handled without error

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
