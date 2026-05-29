# QA Agent Platform — Master AI Instructions (Project Intelligence File)
# Auto-loaded by Claude Code every session. Keep this updated.
# Last Updated: 2026-05-22

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
> **📋 See [docs/superpowers/plans/2026-05-22-phase-d-step15-ai-remediation-governance.md](docs/superpowers/plans/2026-05-22-phase-d-step15-ai-remediation-governance.md) — Phase D Step 15 implementation plan (8 tasks). **COMPLETE as of 2026-05-22.**
> **📋 Phase E Step 1 — Runtime Performance Optimization & Scalability Hardening. **COMPLETE as of 2026-05-22.** Module: `src/api-performance/`. 26 tests passing.
> **📋 Phase E Step 2 — Persistence Layer Evolution & Scalable Storage Abstraction. **COMPLETE as of 2026-05-22.** Module: `src/api-persistence/`. 24 tests passing.
> **📋 Phase E Step 3 — Distributed Queue Orchestration & Scalable Worker Execution Foundation. **COMPLETE as of 2026-05-22.** Module: `src/api-orchestration/`. 26 tests passing.
> **📋 Phase E Step 4 — Security Hardening, Secret Governance & Compliance-Ready Execution Controls. **COMPLETE as of 2026-05-22.** Module: `src/api-security/`. 33 tests passing.
> **📋 Phase E Step 5 — Enterprise Graph Editor Evolution & Controlled Visual Workflow Authoring. **COMPLETE as of 2026-05-22.** Module: `src/api-graph-editor/`. 32 tests passing.
> **📋 Phase E Step 6 — Cloud-Native Execution Platform, Kubernetes Readiness & Elastic Enterprise Scaling. **COMPLETE as of 2026-05-22.** Module: `src/api-cloud/`. 34 tests passing.
> **📋 Phase E Step 7 — Enterprise Analytics Platform, SLA Intelligence & Advanced Operational Insights. **COMPLETE as of 2026-05-22.** Module: `src/api-analytics/`. 31 tests passing.
> **📋 Phase E Step 8 — Enterprise Plugin Ecosystem, SDK Extensibility & Integration Marketplace Foundation. **COMPLETE as of 2026-05-22.** Module: `src/api-plugins/`. 27 tests passing.
> **📋 Phase E Step 9 — Enterprise Collaboration Platform, Shared Workflow Intelligence & Organization-Scale QA Operations. **COMPLETE as of 2026-05-22.** Module: `src/api-collaboration/`. 30 tests passing.
> **📋 Phase E Step 10 — Enterprise AI QA Copilot, Predictive Intelligence & Controlled Autonomous Operations Foundation. **COMPLETE as of 2026-05-22.** Module: `src/api-copilot/`. 42 tests passing.
> **📋 Phase E Step 11 — Autonomous Enterprise QA Operations, Policy-Governed Self-Healing & Adaptive Orchestration Evolution. **COMPLETE as of 2026-05-22.** Module: `src/api-autonomous/`. 50 tests passing.
> **📋 Phase E Step 12 — Enterprise Federated QA Platform, Cross-Organization Intelligence & Global Orchestration Fabric. **COMPLETE as of 2026-05-22.** Module: `src/api-federation/`. 47 tests passing.
> **📋 Phase E Step 13 — Enterprise QA Operating Mesh, Autonomous Knowledge Fabric & Adaptive Global Reliability Intelligence. **COMPLETE as of 2026-05-22.** Module: `src/api-mesh/`. 48 tests passing.
> **📋 Phase E Step 14 — Enterprise Operational Cognition Platform, Governed Self-Optimization & Global Reliability Governance Fabric. **COMPLETE as of 2026-05-22.** Module: `src/api-cognition/`. 49 tests passing.
> **📋 Phase E Step 15 — Enterprise Autonomous Reliability Fabric, Global QA Governance Mesh & Explainable Adaptive Operations Platform. **COMPLETE as of 2026-05-22.** Module: `src/api-reliability/`. 60 tests passing.
> **📋 Phase E Step 16 — Enterprise QA Neural Governance Fabric, Adaptive Reliability Federation & Explainable Global Operational Intelligence. **COMPLETE as of 2026-05-22.** Module: `src/api-opfabric/`. 62 tests passing.
> **📋 Phase E Step 17 — Enterprise Execution Knowledge Graph, Semantic QA Intelligence & Contextual Operational Reasoning Fabric. **COMPLETE as of 2026-05-22.** Module: `src/api-semknow/`. 67 tests passing.
> **📋 Phase E Step 18 — Multi-Region Resilience, Disaster Recovery & Global Execution Continuity Fabric. **COMPLETE as of 2026-05-22.** Module: `src/api-resilience/`. 65 tests passing.
> **📋 Phase E Step 19 — Enterprise Governance Automation, Compliance Intelligence & Policy-Orchestrated QA Trust Fabric. **COMPLETE as of 2026-05-22.** Module: `src/api-govautomation/`. 68 tests passing.
> **📋 Phase E Step 20 — Unified Enterprise QA Operating System Completion, Platform Consolidation & Governed Global Reliability Fabric. **COMPLETE as of 2026-05-22.** Module: `src/api-qaos/`. 67 tests passing.
> **📋 Phase F (Tracks 1–4) — Debugger Engine, AI Generators, Example Plugins & Test Guide Enrichment. **COMPLETE as of 2026-05-22.**
> - Track 1: Phase C live `ExecutionCoordinator` bridge. `USE_COORDINATOR=true` feature flag. Routes: `GET /api/coordinator/health`, `GET /api/api-runs/:runId/coordinator-state`, `POST /api/api-runs/:runId/cancel`, `POST /api/api-runs/:runId/replay-node-context`. Module: `src/api-runtime/execution-coordinator/coordinator-bridge.ts`.
> - Track 2a: Debugger Engine. Module: `src/api-runtime/debugger-engine/`. Routes: `GET /api/api-runs/:runId/timeline`, `GET /api/api-runs/:runId/variable-trace`, `POST /api/api-runs/:runId/replay-node`, `POST /api/api-runs/:runId/replay-workflow`.
> - Track 2b/2c: AI engines. `negative-test-generator.ts` (5 strategies). `assertion-suggester.ts` (4 suggestion types). Routes: `POST /api/ai-intelligence/collections/:id/generate-negative-tests`, `POST /api/ai-intelligence/steps/:stepId/suggest-assertions`. Module: `src/api-intelligence/engines/`.
> - Track 3: Phase F health alias `GET /api/api-runtime/health`. Example plugins: `custom-bearer-auth.plugin.ts`, `custom-json-assertion.plugin.ts`. Route: `GET /api/plugins/examples`. Module: `src/api-plugins/examples/`.
> - Track 4: `API_TESTING_TEST_GUIDE.md` enriched with 8 new test categories TC-341–TC-416 (416 total).

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

### Enterprise Collaboration Platform, Shared Workflow Intelligence & Organization-Scale QA Operations (Phase E Step 9 — shipped 2026-05-22)
- Module: `src/api-collaboration/` — contracts, stores, overlay builder, routes
- **Workflow version store**: `WorkflowVersionStore` — save/get/list revisions (draft/review/published/archived/rolled-back); `getLatestPublished()`; `diff(from, to)` → step additions/removals + dependency changes; `rollback()` creates new published revision from target snapshot; `globalWorkflowVersionStore` singleton
- **Collaboration review store**: `CollaborationReviewStore` — append-only `ReviewComment[]` per collection (step/dependency/collection/replay/graph-node targets); `resolveComment()`; `createThread/getThread/listThreads`; status filters (open/resolved/wont-fix); `globalCollaborationReviewStore` singleton
- **Organization template registry**: `OrganizationTemplateRegistry` — governed `WorkflowTemplate` artifacts (api-workflow/suite-orchestration/replay-investigation/governance-policy/analytics-dashboard); `instantiate()` returns advisory scaffold only — never creates collections; built-in REST CRUD template pre-registered; `globalOrganizationTemplateRegistry` singleton
- **Replay knowledge store**: `ReplayKnowledgeStore` — `ReplayAnnotation[]` per runId (never mutates replay data); `RcaKnowledgeEntry[]` per collection (rca-finding/flakiness-note/dependency-issue/remediation-ref/investigation-note); `globalReplayKnowledgeStore` singleton
- **Graph collaboration overlay builder**: `GraphCollaborationOverlayBuilder` — builds `GraphCollaborationOverlay` with `CollaborationMarker[]` (review-comment/ownership/investigation/knowledge-link); `ownershipMap` (nodeId → ownerId); graph read-only, additive markers only; `globalGraphCollaborationOverlayBuilder` singleton
- **Realtime collaboration stubs**: `NoOpCollaborativeCursorBroadcast`, `NoOpWorkflowPublishingPipeline`, `ICrossTeamOrchestrationFederation` — extension points for future real-time editing, publishing pipelines, cross-team federation
- **Routes**: `GET/POST /api/collaboration/:id/revisions`, `POST .../rollback`, `POST .../diff`, `GET/POST /api/collaboration/:id/comments`, `POST /api/collaboration/comments/:id/resolve`, `GET /api/collaboration/templates`, `POST /api/collaboration/templates/:id/instantiate`, `POST/GET /api/collaboration/replay/:runId/annotations`, `POST /api/collaboration/:id/graph-overlay`
- 30 unit tests passing, 0 TypeScript errors
- Replay determinism preserved: annotations stored separately, never touch replay event store; WorkflowEnvelope authority unchanged; DAG/execution/retries untouched

### Enterprise AI QA Copilot, Predictive Intelligence & Controlled Autonomous Operations Foundation (Phase E Step 10 — shipped 2026-05-22)
- Module: `src/api-copilot/` — contracts, engines, overlay builder, routes
- **Copilot guidance engine**: `CopilotGuidanceEngine` — `guide(query)` produces `CopilotGuidanceResult` with `CopilotGuidanceItem[]` (severity/confidence/actionHint/evidenceRefs/provenance/advisoryNote); `listHistory(collectionId)` audit trail; per-collection history map; `globalCopilotGuidanceEngine` singleton
- **Predictive intelligence engine**: `PredictiveIntelligenceEngine` — `forecastFlakiness(collectionId, stepIds)` per-step `FlakinessForecast[]`; `forecastRetryStorm(collectionId)` → stormRisk (low/medium/high); `forecastSlaBreach(collectionId, metric, value)` → breachLikelihood; all advisory/read-only; `globalPredictiveIntelligenceEngine` singleton
- **Replay reasoning engine**: `ReplayReasoningEngine` — `summarizeReplay(runId, collectionId)` → `ReplaySummary` (failedStepIds, retryStepIds, teardownStepIds, anomalySignals); `correlateRcaEvidence(runId, collectionId, failedStepId)` → `RcaEvidenceCorrelation` (evidenceItems with weight 0–1, rootCauseHypothesis, confidence); read-only, never touches replay store; `globalReplayReasoningEngine` singleton
- **AI graph overlay builder**: `AiGraphOverlayBuilder` — `build(collectionId, context)` composes `PredictiveInstabilityIndicator[]` from flakiness/retryHotspot/rcaCorrelation inputs + `DependencyRiskOverlay` from dependency edges; indicatorTypes: predicted-flakiness/retry-storm-risk/sla-breach-risk/dependency-risk/rca-hotspot/optimization-opportunity; additive badges only, graph never mutated; `globalAiGraphOverlayBuilder` singleton
- **Autonomous preparation engine**: `AutonomousPreparationEngine` — `propose()` creates `ApprovalBasedAutonomousAction` (status: pending-human-review, 7-day expiry, governanceNote); `listPending(collectionId)` for review UI; APPROVAL-GATED — never auto-executes; `NoOpAutonomousExecutionPipeline` stub; `globalAutonomousPreparationEngine` singleton
- **Routes** (9 endpoints): `POST /api/copilot/guide`, `GET /api/copilot/history/:collectionId`, `POST /api/copilot/predict/flakiness`, `POST /api/copilot/predict/retry-storm`, `POST /api/copilot/predict/sla-breach`, `POST /api/copilot/replay/:runId/summarize`, `POST /api/copilot/replay/:runId/rca`, `POST /api/copilot/graph-overlay/:collectionId`, `POST/GET /api/copilot/autonomous/:collectionId/propose|pending`
- 42 unit tests passing, 0 TypeScript errors
- ADVISORY ONLY throughout — no runtime mutation, no WorkflowEnvelope modification, no DAG/retry alteration; replay determinism preserved; all autonomous actions require explicit human approval

### Autonomous Enterprise QA Operations, Policy-Governed Self-Healing & Adaptive Orchestration Evolution (Phase E Step 11 — shipped 2026-05-22)
- Module: `src/api-autonomous/` — contracts, registry, executor, intelligence engines, overlay builder, routes
- **Autonomy governance registry**: `AutonomyGovernanceRegistry` — `AutonomyPolicy` with `AutonomyTier` (advisory-only/approval-required/confidence-gated/fully-governed); `AutonomyConfidenceThreshold` per action category; `ApprovalEscalationRule` for below-threshold escalation; `checkPermission(category, confidence, role, tenantId)` → permitted/reason/requiredTier; tenant override policies; default policy pre-registered (approval-required tier, all 6 categories enabled); `globalAutonomyGovernanceRegistry` singleton
- **Controlled remediation executor**: `ControlledRemediationExecutor` — `createPlan()` → status: pending-approval; `approvePlan(planId, approverRole)` → approved; `executeApproved()` → advisory simulation only (never auto-mutates collections); `rollback()` → rolled-back; `recordEffectiveness/listEffectiveness` for historical tracking; per-plan `governanceNote`; `globalControlledRemediationExecutor` singleton
- **Adaptive retry intelligence**: `AdaptiveRetryIntelligence` — `recommendRetryAdaptations()`: per-step signals (retry-storm-detected/sla-breach-risk/dependency-cascade/environment-instability/flakiness-pattern), recommended maxRetries+intervalMs; `adviseStormContainment()`: storm detection at ≥0.5 threshold, containment action (isolate-step/reduce-retries/add-backoff/none); `governSlaRetries()`: safe retry budget = 30% of SLA threshold, breachRisk 0–1; advisory only; `globalAdaptiveRetryIntelligence` singleton
- **Replay autonomous intelligence engine**: `ReplayAutonomousIntelligenceEngine` — `correlateReplayWithRemediation(runId, collectionId, linkedPlanId)` → `ReplayRemediationCorrelation` (rcaConfidence, predictedEffectiveness weighted by historical records); `computeStabilizationInsight(collectionId, recentRunIds)` → instabilityScore + stabilizationHints; `generateFailurePreventionInsights(collectionId, stepIds)` → per-step failureProbability + preventionHints; `ingestEffectiveness()` for historical scoring; replay data never modified; `globalReplayAutonomousIntelligenceEngine` singleton
- **Autonomous graph overlay builder**: `AutonomousGraphOverlayBuilder` — `build(collectionId, input)` composes `AutonomousOverlayIndicator[]` from remediation plans (remediation-pending/remediation-approved), stabilization insights (stabilization-candidate), retry adaptations (retry-adaptation-hint); `totalRemediationPending` + `totalStabilizationCandidates` counts; additive badges only, graph never mutated; `globalAutonomousGraphOverlayBuilder` singleton
- **Plugin autonomous extension stubs**: `ICustomRemediationEnginePlugin`, `IEnterpriseStabilizationPlugin`, `IAdaptiveOrchestrationEnricher`, `IReplayIntelligenceAdapter`, `NoOpPolicyAwareAutomationPlugin` — advisory-only/read-only extension interfaces for future marketplace integration
- **Routes** (15 endpoints): governance policy GET/POST, permission check, tenant control; remediation plan create/list/approve/execute/rollback/effectiveness; retry recommendations/storm-containment/sla-governance; replay correlate/stabilization/failure-prevention; autonomous graph overlay
- 50 unit tests passing, 0 TypeScript errors
- Execution determinism preserved: all autonomous actions advisory or approval-gated; DAG, WorkflowEnvelope, retry semantics, replay contracts all unchanged; governance/RBAC/audit infrastructure untouched; manual-only workflows fully supported

### Enterprise Federated QA Platform, Cross-Organization Intelligence & Global Orchestration Fabric (Phase E Step 12 — shipped 2026-05-22)
- Module: `src/api-federation/` — contracts, registries, intelligence hub, governance, replay engine, overlay builder, routes
- **Federation orchestration registry**: `FederationOrchestrationRegistry` — `OrgFederationNode` lifecycle (active/degraded/offline/quarantined); `FederationPolicy` with `FederationPolicyTier` (isolated/selective-share/open-intelligence); `checkSharingPermission(orgId, targetOrgId)` — policy tier + allowedOrgIds enforcement; `snapshot(orgId)` → active/degraded node counts; `globalFederationOrchestrationRegistry` singleton
- **Cross-org intelligence hub**: `CrossOrgIntelligenceHub` — `publishRecord()` accepts anonymized `AnonymizedIntelligenceRecord[]` (6 categories: flakiness-pattern/retry-anti-pattern/orchestration-anti-pattern/rca-knowledge/workflow-optimization/dependency-instability); `createBundle()` filters isAnonymized=true only — never shares non-anonymized data; `aggregate(category)` → contributingOrgs + avgWeight; `globalCrossOrgIntelligenceHub` singleton
- **Federated governance registry**: `FederatedGovernanceRegistry` — `FederatedGovernancePolicy` with `FederatedPolicyPropagationMode` (advisory/opt-in/enforced-by-local); `ApprovalChainFederation` multi-org approval lifecycle (pending→approved when all participatingOrgIds approve); append-only `FederatedAuditEntry[]` per orgId; `globalFederatedGovernanceRegistry` singleton
- **Federated replay intelligence engine**: `FederatedReplayIntelligenceEngine` — anonymized `AnonymizedReplayPattern` publishing (failureSignature + retrySequenceHash, no raw payloads); `generateInsights()` groups by failureSignature → `FederatedReplayInsight[]` with recommendedAction based on avgRemediationEffectiveness; `detectFederatedAnomaly(collectionId, localAnomalyType)` → crossOrgFrequency + isKnownPattern; replay data never modified; `globalFederatedReplayIntelligenceEngine` singleton
- **Federated graph overlay builder**: `FederatedGraphOverlayBuilder` — `build(collectionId, orgId, input)` composes `FederatedOverlayIndicator[]` (cross-org-instability/federated-retry-pattern/global-health-signal/federation-optimization-hint/cross-team-dependency-risk); `globalHealthScore` = avg of crossOrgConfidence; additive badges only; `globalFederatedGraphOverlayBuilder` singleton
- **Federation plugin stubs**: `IFederatedOrchestrationPlugin`, `IEnterpriseFederationAdapter`, `IReplayFederationEnricher`, `ICrossOrgAnalyticsPlugin`, `NoOpFederatedGovernanceAdapter`, `NoOpOrchestrationMeshFederation`, `NoOpCrossEnterpriseReplayNetwork` — extension points for future marketplace and mesh federation
- **Routes** (18 endpoints): federation nodes CRUD/status/policy/permission-check/snapshot; intelligence records/bundles/aggregate; governance policies/approval-chains/audit; replay patterns/insights/anomaly; federated graph overlay
- 47 unit tests passing, 0 TypeScript errors
- Federation governance invariants: tenant-sensitive execution data never exposed; all sharing requires valid `FederationPolicy`; anonymous-only cross-org intelligence; local governance authority always preserved; WorkflowEnvelope, DAG, retry semantics, replay determinism all unchanged; non-federated tenants fully supported

### Enterprise QA Operating Mesh, Autonomous Knowledge Fabric & Adaptive Global Reliability Intelligence (Phase E Step 13 — shipped 2026-05-22)
- Module: `src/api-mesh/` — contracts, registry, fabric, intelligence engine, operational memory, overlay builder, routes
- **Mesh intelligence registry**: `MeshIntelligenceRegistry` — `MeshIntelligenceNode` with scope (local/tenant/federated/global) and 6 signal types; `publishPropagation()` stores `OrchestrationIntelligencePropagation` (anonymized payload, never raw execution data); `summarize(orgId)` → dominantSignalType via signal count; `makePropagation()` static factory; `globalMeshIntelligenceRegistry` singleton
- **Replay knowledge fabric**: `ReplayKnowledgeFabric` — `ReplayKnowledgeEntry[]` per collectionId (6 memory types: rca-recurring/stabilization-memory/dependency-instability/retry-optimization/remediation-effectiveness/environment-anomaly); `buildIndex(collectionId)` → `OperationalMemoryIndex` with entryCountByType + strongestSignal (max avgConfidence×occurrenceCount); `ReplayOptimizationMemory` per step; replay data never modified; `globalReplayKnowledgeFabric` singleton
- **Adaptive reliability intelligence**: `AdaptiveReliabilityIntelligence` — `scoreReliability(collectionId, inputs)` computes weighted composite score across 6 dimensions (orchestration-stability 25%, retry-effectiveness 20%, sla-compliance 20%, dependency-health 15%, environment-stability 10%, remediation-velocity 10%); trend: improving(≥75)/stable(≥50)/degrading(<50); `forecastReliability()` applies decay per degrading dimension; `assessSlaAlignment()` → breachRiskScore + adaptationHints; advisory only; `globalAdaptiveReliabilityIntelligence` singleton
- **Federated operational memory**: `FederatedOperationalMemory` — `OperationalMemoryRecord[]` with TTL-based `evictExpired()`; `AntiPatternMemory` keyed by patternKey with severity (low/medium/high/critical), crossOrgOccurrences, knownEffectiveRemedies; `OperationalMemoryRetentionPolicy` per org (retentionDays, anonymizeAfterDays, blockSensitiveSignals); `globalFederatedOperationalMemory` singleton
- **Adaptive mesh graph overlay builder**: `AdaptiveMeshGraphOverlayBuilder` — `build(collectionId, input)` composes `AdaptiveMeshOverlayIndicator[]` (orchestration-memory/reliability-trend/replay-optimization-trail/dependency-learning/anti-pattern-alert/mesh-health-signal); `meshHealthScore` = avg memoryScore; anti-pattern indicators always degrading trend; additive badges only; `globalAdaptiveMeshGraphOverlayBuilder` singleton
- **Mesh plugin stubs**: `IOperationalIntelligencePlugin`, `IAdaptiveOrchestrationMeshEnricher`, `IReplayKnowledgeAdapter`, `IReliabilityScoringPlugin`, `NoOpFederatedLearningEnricher`, `NoOpOperationalCognitionLayer`, `NoOpAiOrchestrationEvolution` — extension points for future mesh enrichers and cross-mesh federation
- **Routes** (18 endpoints): mesh nodes/propagations/summary; knowledge entries/index/optimization-memory; reliability score/forecast/sla-alignment; operational memory records/evict/anti-patterns/retention-policy; adaptive graph overlay
- 48 unit tests passing, 0 TypeScript errors
- Mesh intelligence invariants: all propagated payloads are anonymized advisory signals; no execution runtime mutated; replay determinism preserved; DAG/WorkflowEnvelope/retries unchanged; non-mesh tenants fully supported

### Enterprise Operational Cognition Platform, Governed Self-Optimization & Global Reliability Governance Fabric (Phase E Step 14 — shipped 2026-05-22)
- Module: `src/api-cognition/` — contracts, registry, reasoning engine, optimization engine, memory, overlay builder, routes
- **Cognition layer registry**: `CognitionLayerRegistry` — `CognitionMemoryRecord` with 6 types (orchestration-cognition/replay-reasoning/reliability-cognition/remediation-trail/optimization-cognition/federated-cognition); `isExplainable: true` required on all records; `summarize(collectionId)` → dominantMemoryType + avgConfidence + topSignals (top-3 by confidence); `globalCognitionLayerRegistry` singleton
- **Replay operational reasoning engine**: `ReplayOperationalReasoningEngine` — `buildReasoningTrail(runId, collectionId, dimensions)` → `ReasoningTrail` with per-dimension `ReasoningTrailStep` (observation + inference); 6 dimensions: dependency-cognition/retry-cognition/remediation-effectiveness/environment-cognition/orchestration-bottleneck/stabilization-reasoning; `isExplainable: true` + unique trailId; `OptimizationReasoningRecord` persistence per collection; replay data never modified; `globalReplayOperationalReasoningEngine` singleton
- **Governed self-optimization engine**: `GovernedSelfOptimizationEngine` — `propose()` → `SelfOptimizationProposal` (pending-review, 7-day expiry, required reasoning field for explainability); `approve(proposalId, approverRole)` → applied-advisory status; `reject()` → rejected; approval-gated lifecycle (throws if not pending); default policy: minConfidence=70, roles=[admin,editor], all 6 domains enabled; per-collection policy override; `globalGovernedSelfOptimizationEngine` singleton
- **Federated cognition memory**: `FederatedCognitionMemory` — `addCognitionRecord()` + `buildIndex(orgId, collectionId)` → `CognitionMemoryIndex` (recordsByMemoryType, avgConfidence, strongestReasoning by max confidence); `AntiPatternCognitionRecord` with `reasoningChain[]` (explainable steps), crossOrgFrequency, knownEffectiveReasonings; `CognitionRetentionPolicy` with `requireExplainability` flag; `globalFederatedCognitionMemory` singleton
- **Cognitive graph overlay builder**: `CognitiveGraphOverlayBuilder` — `build(collectionId, input)` composes `CognitiveOverlayIndicator[]` (6 types: cognition-memory/reasoning-trail/optimization-cognition/reliability-cognition/stabilization-history/anti-pattern-cognition); `isExplainable: true` on all indicators; `overallCognitionScore` = avg cognitionScore; `totalExplainableSignals` count; additive badges only; `globalCognitiveGraphOverlayBuilder` singleton
- **Cognition plugin stubs**: `ICognitionEnricher`, `IReplayReasoningPlugin`, `IOperationalCognitionAdapter`, `IReliabilityCognitionScoringPlugin`, `NoOpFederatedCognitionEnricher`, `NoOpGovernedSelfOptimizingInfrastructure`, `NoOpOperationalReasoningPlatform` — explainability required on all stubs; extension points for future cognition federation
- **Routes** (17 endpoints): cognition records/summary; reasoning trail/optimization-reasoning; proposals CRUD/approve/reject + governance policy; federated memory records/index/anti-patterns/retention; cognitive graph overlay
- 49 unit tests passing, 0 TypeScript errors
- Cognition governance invariants: all records require reasoning field (explainability enforced at type level); self-optimization proposals approval-gated; no runtime execution mutated; replay determinism preserved; DAG/WorkflowEnvelope unchanged; non-cognitive tenants fully supported

### Enterprise Autonomous Reliability Fabric, Global QA Governance Mesh & Explainable Adaptive Operations Platform (Phase E Step 15 — shipped 2026-05-22)
- Module: `src/api-reliability/` — contracts, fabric registry, explainability engine, optimization engine, memory, overlay builder, routes
- **Reliability fabric registry**: `ReliabilityFabricRegistry` — `ReliabilityFabricNode` lifecycle (active/degraded/stabilizing/offline); `StabilizationGovernanceMode` (advisory/approval-gated/supervised/fully-governed); `snapshot(orgId)` → active/degraded counts + avgReliabilityScore; `recordGovernance()` append-only governance audit; `globalReliabilityFabricRegistry` singleton
- **Replay explainability engine**: `ReplayExplainabilityEngine` — `buildTrail(collectionId, runId, dimensions)` → `ReplayExplainabilityTrail` with per-dimension `ExplainabilityTrailStep` (observation + inference); 6 dimensions: retry-evolution/dependency-stabilization/sla-optimization/remediation-effectiveness/orchestration-resilience/environment-adaptation; `isExplainable: true` + unique trailId; `explainRetryEvolution()`, `explainDependencyStabilization()`, `explainSlaOptimization()` — all advisory, replay data never modified; `globalReplayExplainabilityEngine` singleton
- **Governed reliability optimization engine**: `GovernedReliabilityOptimizationEngine` — `propose()` → `ReliabilityOptimizationProposal` (pending-review, 7-day expiry, isExplainable: true, required reasoning); `approve()` → applied-advisory; `reject()` → rejected; throws if not pending; `scoreResilience(collectionId)` → weighted 6-dimension `ResilienceScoringResult` (high/medium/low/critical level); `recommendRetryEvolution()` + `recommendDependencyTuning()` advisory recommendations; default policy (minConfidence=70, roles=[admin,editor]); per-collection policy override; `globalGovernedReliabilityOptimizationEngine` singleton
- **Federated reliability memory**: `FederatedReliabilityMemory` — `ReliabilityMemoryRecord[]` with TTL-based `evictExpired()`; `buildIndex(orgId, collectionId)` → `ReliabilityMemoryIndex` (recordsByMemoryType, avgConfidence, strongestReasoning by max confidence); `ResilienceAntiPatternRecord` keyed by patternKey (reasoningChain[], severity, knownEffectiveRemedies, crossOrgFrequency); `ReliabilityRetentionPolicy` per org (requireExplainability flag); `globalFederatedReliabilityMemory` singleton
- **Reliability graph overlay builder**: `ReliabilityGraphOverlayBuilder` — `build(collectionId, input)` composes `ReliabilityOverlayIndicator[]` (6 types: resilience-cognition/stabilization-history/retry-evolution-trail/dependency-reliability/sla-optimization-signal/remediation-reasoning); `isExplainable: true` on all indicators; `overallResilienceScore` = avg indicator score; `fabricHealthScore` = % non-degrading indicators; anti-pattern inputs always degrading trend; additive badges only, graph never mutated; `globalReliabilityGraphOverlayBuilder` singleton
- **Plugin stubs**: `IReliabilityFabricPlugin`, `IExplainabilityEnricher`, `IReliabilityOptimizationAdapter`, `IResilienceScoringPlugin`, `IReliabilityMemoryAdapter`, `NoOpFederatedReliabilityEnricher`, `NoOpResilienceOptimizationFabric`, `NoOpOperationalReliabilityPlatform` — extension points for future reliability federation and marketplace
- **Routes** (18 endpoints): fabric nodes CRUD/snapshot/governance; explainability trail/retry-evolution/dependency-stabilization/sla-optimization; optimization proposals CRUD/approve/reject/resilience-score/policy; memory records/index/evict/anti-patterns/retention-policy; reliability graph overlay
- 60 unit tests passing, 0 TypeScript errors
- Reliability governance invariants: all explainability trails have isExplainable: true enforced at type level; optimization proposals approval-gated (never auto-applied); fabric nodes are observational only; no execution runtime mutated; replay determinism preserved; DAG/WorkflowEnvelope/retries unchanged; non-reliability tenants fully supported

### Enterprise QA Neural Governance Fabric, Adaptive Reliability Federation & Explainable Global Operational Intelligence (Phase E Step 16 — shipped 2026-05-22)
- Module: `src/api-opfabric/` — contracts, governance registry, memory fabric, federation engine, intelligence hub, overlay builder, routes
- **Operational intelligence governance registry**: `OperationalIntelligenceGovernanceRegistry` — `OperationalIntelligencePropagation` (6 scopes: orchestration-governance/replay-governance/remediation-federation/reliability-governance/resilience-intelligence/optimization-evolution); `PropagationPolicyTier` (local/tenant-scoped/federated/globally-governed); `OrchestrationGovernanceDecision` approval lifecycle (pending→approved/rejected, 7-day expiry); `summarize(orgId)` → dominantScope by count + avgConfidence; default policy pre-registered; `globalOperationalIntelligenceGovernanceRegistry` singleton
- **Replay operational memory fabric**: `ReplayOperationalMemoryFabric` — `ReplayOperationalMemoryEntry` with 6 federation types (orchestration-reasoning/remediation-memory/retry-stabilization/dependency-resilience/sla-governance/optimization-memory); `buildIndex()` strongest signal = max(confidence×occurrenceCount); TTL-based `evictExpired()`; `ReplayBackedRemediationMemory` per collection+runId; `FederatedRetryStabilizationRecord` keyed by patternKey; all isAnonymized: true required; replay data never modified; `globalReplayOperationalMemoryFabric` singleton
- **Governed adaptive federation engine**: `GovernedAdaptiveFederationEngine` — `FederationOptimizationProposal` lifecycle (pending-review→propagated-advisory/rejected, throws if not pending); 6 domains; `scoreStabilization(collectionId)` → 6-domain `OrchestrationStabilizationFederationResult` (excellent/good/fair/poor); approval-gated, advisory only; per-collection policy; `globalGovernedAdaptiveFederationEngine` singleton
- **Federated reliability intelligence hub**: `FederatedReliabilityIntelligenceHub` — `FederatedReliabilityIntelligenceRecord` (6 categories: retry-anti-pattern/dependency-instability/orchestration-bottleneck/remediation-effectiveness/sla-resilience/stabilization-signal); enforces isAnonymized=true on publish (non-anonymized records rejected); `bundleByCategory()` → top-3 signals by confidence + contributingOrgs; `OrchestrationAntiPatternFederationMemory` with reasoningChain + severity; `buildIndex()` per org; `globalFederatedReliabilityIntelligenceHub` singleton
- **Operational federation graph overlay builder**: `OperationalFederationGraphOverlayBuilder` — `build(collectionId, input)` composes `OperationalFederationOverlayIndicator[]` (6 types: orchestration-federation/replay-optimization-reasoning/adaptive-stabilization-federation/resilience-federation-cognition/explainable-governance-trail/dependency-federation-intelligence); isExplainable: true on all; anti-pattern inputs always degrading trend; `fabricGovernanceScore` = % non-degrading indicators; additive badges only; `globalOperationalFederationGraphOverlayBuilder` singleton
- **Plugin stubs**: `IOperationalFederationEnricher`, `IReplayExplainabilityFederationPlugin`, `IAdaptiveStabilizationFederationAdapter`, `IOrchestrationResilienceFederationScoringPlugin`, `IFederatedOperationalIntelligenceEnricher`, `NoOpFederatedOperationalEnricher`, `NoOpOperationalFederationRouter`, `NoOpGlobalOperationalGovernanceMesh` — extension points for future enterprise operational intelligence marketplace
- **Routes** (`/api/opfabric`, 21 endpoints): governance propagations/decisions/approve/reject/summary/policy; memory entries/index/remediation/retry-stabilization/evict; federation proposals CRUD/approve/reject/stabilization-score/policy; reliability intelligence records/bundle/index/anti-patterns; operational federation graph overlay
- 62 unit tests passing, 0 TypeScript errors
- Operational fabric governance invariants: all propagations isAnonymized: true enforced; intelligence hub rejects non-anonymized data; federation proposals approval-gated (never auto-propagated); governance decisions follow pending→approved/rejected lifecycle with expiry; no execution runtime mutated; replay determinism preserved; DAG/WorkflowEnvelope/retries unchanged; non-federated tenants fully supported

### Enterprise Execution Knowledge Graph, Semantic QA Intelligence & Contextual Operational Reasoning Fabric (Phase E Step 17 — shipped 2026-05-22)
- Module: `src/api-semknow/` — contracts, knowledge graph registry, semantic replay engine, contextual reasoning engine, semantic memory fabric, semantic overlay builder, routes
- **Execution knowledge graph registry**: `ExecutionKnowledgeGraphRegistry` — `ExecutionKnowledgeNode` (6 types: orchestration-step/dependency/remediation-action/retry-pattern/sla-constraint/environment-factor; isExplainable: true); `ExecutionKnowledgeEdge` (6 relation types: depends-on/triggers/remediates/correlates-with/constrains/optimizes); `snapshot(collectionId)` → nodeTypeBreakdown + dominantRelationType by edge count + avgNodeConfidence; observational only, never mutates DAG/WorkflowEnvelope; `globalExecutionKnowledgeGraphRegistry` singleton
- **Semantic replay intelligence engine**: `SemanticReplayIntelligenceEngine` — `correlateSemantics(collectionId, runId, categories)` → `SemanticReplayCorrelation[]` (6 categories with contextualReasoning chains, isAnonymized: true); `inferOrchestrationIntent()` → complex/sequential inference from signal count; `categorizeRetrySemantics()` → dependency-cascade/environment-instability/transient-failure/unknown with recommendedSemanticAction; `analyzeSlaSemantics()` → semanticGap assessment + optimizationSemantics[]; replay data never modified; `globalSemanticReplayIntelligenceEngine` singleton
- **Contextual operational reasoning engine**: `ContextualOperationalReasoningEngine` — `buildReasoningTrail(collectionId, dimensions)` → `ContextualReasoningTrail` with per-dimension steps (contextObservation + semanticInference); 6 dimensions; confidenceLevel (low/medium/high/definitive) derived from overallConfidence; unique trailId per call; `analyzeAnomalySemantics()` → semanticInterpretation + contextualFactors; `deriveOptimizationSemantics()` → contextualReasoning chain; all advisory; `globalContextualOperationalReasoningEngine` singleton
- **Federated semantic memory fabric**: `FederatedSemanticMemoryFabric` — `SemanticMemoryRecord` (6 types; isAnonymized: true; TTL retentionExpiresAt); `buildIndex()` strongestSemanticSignal = max(confidence×occurrenceCount), dominantMemoryType by count; `OrchestrationAntiPatternSemantics` keyed by patternKey (contextualReasoningChain[], semanticSeverity, knownSemanticRemedies); `SemanticRetentionPolicy` (requireExplainability); TTL-based `evictExpired()`; `globalFederatedSemanticMemoryFabric` singleton
- **Semantic graph overlay builder**: `SemanticGraphOverlayBuilder` — `build(collectionId, input)` composes `SemanticOverlayIndicator[]` (6 types: orchestration-semantic/dependency-semantic/retry-semantic-cluster/remediation-semantic/operational-intent/semantic-evolution-trail); isExplainable: true on all; anti-pattern inputs always degrading trend; `semanticHealthScore` = % non-degrading indicators; additive badges only, graph never mutated; `globalSemanticGraphOverlayBuilder` singleton
- **Plugin stubs**: `ISemanticEnricher`, `IReplaySemanticPlugin`, `IContextualReasoningAdapter`, `IOrchestrationSemanticScoringPlugin`, `IFederatedSemanticIntelligenceEnricher`, `NoOpFederatedSemanticEnricher`, `NoOpSemanticOrchestrationEnricher`, `NoOpEnterpriseKnowledgeGraphFabric` — extension points for future enterprise semantic cognition marketplace
- **Routes** (`/api/semknow`, 18 endpoints): knowledge graph nodes/edges/snapshot; semantic replay correlate/infer-intent/categorize-retries/sla-semantics; contextual reasoning trail/anomaly-semantics/optimization-semantics; semantic memory records/index/evict/anti-patterns/retention-policy; semantic graph overlay
- 67 unit tests passing, 0 TypeScript errors
- Semantic intelligence governance invariants: all correlations isAnonymized: true; knowledge graph observational only (never mutates DAG/WorkflowEnvelope); contextual reasoning advisory-only; no execution runtime mutated; replay determinism preserved; retries/DAG/WorkflowEnvelope unchanged; non-semantic tenants fully supported

### Multi-Region Resilience, Disaster Recovery & Global Execution Continuity Fabric (Phase E Step 18 — shipped 2026-05-22)
- Module: `src/api-resilience/` — contracts, resilience registry, DR orchestrator, failover intelligence, continuity memory, overlay builder, routes
- **Multi-region resilience registry**: `MultiRegionResilienceRegistry` — `RegionalOrchestrationNode` (5 statuses: healthy/degraded/failover/recovering/offline; 4 continuity modes: active-active/active-passive/warm-standby/cold-standby); `updateNodeStatus()` throws for unknown node; `recordFailover()` → `OrchestrationFailoverRecord` (isApproved, isExplainable: true, governanceNote); `snapshot(orgId)` → healthy/degraded/failover counts + avgResilienceScore; default policy (requireApprovalForFailover: true, active-passive); `globalMultiRegionResilienceRegistry` singleton
- **Disaster recovery orchestrator**: `DisasterRecoveryOrchestrator` — `DisasterRecoveryPlan` lifecycle (pending-approval→executing-advisory/rolled-back, 7-day expiry, throws if not pending); 6 recovery scopes with default step templates (orchestration-recovery/replay-reconstruction/worker-failover/queue-recovery/environment-recovery/replay-continuity); `planWorkerFailover()` → `WorkerFailoverContinuity` (replayStatePreserved: true, isAdvisoryOnly: true); `adviseQueueRecovery()` → replay-from-checkpoint advisory; approval-gated, never mutates runtime; `globalDisasterRecoveryOrchestrator` singleton
- **Failover intelligence engine**: `FailoverIntelligenceEngine` — `buildIntelligenceTrail(collectionId, dimensions)` → `FailoverIntelligenceTrail` with per-dimension steps (observation + recoveryInference); 6 dimensions (orchestration-continuity/replay-safety/worker-redundancy/queue-durability/dependency-resilience/regional-isolation); `scoreSurvivability()` → 6-dimension `SurvivabilityScoringResult` (excellent/good/at-risk/critical); `analyzeResilienceAnomaly()` → survivabilityImpact scaled by signal count; advisory, replay never modified; `globalFailoverIntelligenceEngine` singleton
- **Federated continuity memory fabric**: `FederatedContinuityMemoryFabric` — `ContinuityMemoryRecord` (6 types: failover-event/replay-continuity/worker-recovery/queue-recovery/outage-pattern/resilience-signal; isAnonymized: true; TTL); `buildIndex()` strongestSignal = max(confidence×occurrenceCount), dominantMemoryType by count; `OutagePatternRecord` keyed by patternKey (recoveryChain[], severity, knownRecoveryStrategies, isAnonymized: true); `ContinuityRetentionPolicy`; TTL-based `evictExpired()`; `globalFederatedContinuityMemoryFabric` singleton
- **Resilience graph overlay builder**: `ResilienceGraphOverlayBuilder` — `build(collectionId, input)` composes `ResilienceOverlayIndicator[]` (6 types: regional-orchestration/failover-reasoning-trail/dependency-survivability/recovery-overlay/continuity-evolution-trail/outage-pattern-signal); isExplainable: true on all; outage-pattern inputs always degrading; `continuityHealthScore` = % non-degrading indicators; additive badges only; `globalResilienceGraphOverlayBuilder` singleton
- **Plugin stubs**: `IResilienceEnricher`, `IReplayContinuityPlugin`, `IDisasterRecoveryAdapter`, `ISurvivabilityScoringPlugin`, `IFederatedResilienceIntelligenceEnricher`, `NoOpFederatedResilienceEnricher`, `NoOpGlobalContinuityMesh`, `NoOpAdaptiveRecoveryFabric` — extension points for future global continuity marketplace
- **Routes** (`/api/resilience`, 20 endpoints): regional nodes CRUD/status/snapshot/failovers/policy; recovery plans CRUD/approve/reject/worker-failover/queue-recovery; intelligence trail/survivability-score/anomaly; continuity memory records/index/evict/outage-patterns/retention-policy; resilience graph overlay
- 65 unit tests passing, 0 TypeScript errors
- Resilience governance invariants: all recovery plans approval-gated (never auto-execute); worker failover is advisory-only (isAdvisoryOnly: true); all continuity memory isAnonymized: true; regional nodes observational (never mutate DAG/WorkflowEnvelope); replay determinism preserved across all recovery paths; single-region tenants fully supported; no nondeterministic regional execution introduced

### Enterprise Governance Automation, Compliance Intelligence & Policy-Orchestrated QA Trust Fabric (Phase E Step 19 — shipped 2026-05-22)
- Module: `src/api-govautomation/` — contracts, registry, compliance engine, reasoning engine, memory fabric, overlay builder, routes
- **Governance automation registry**: `GovernanceAutomationRegistry` — `PolicyAutomationRule` with scope, complianceThreshold, requireExplainability, requireApprovalForWaiver; `recordDecision()` generates decisionId/evaluatedAt/governanceNote; `listDecisions(collectionId, status?)` filtered query; `summarize(orgId)` → `EnterpriseGovernanceSummary` (totalEvaluations, compliantCount, nonCompliantCount, avgComplianceScore, dominantScope by count, overallTrustLevel); 3 default rules pre-loaded; `globalGovernanceAutomationRegistry` singleton
- **Compliance intelligence engine**: `ComplianceIntelligenceEngine` — `evaluateDimension()` → `ComplianceEvaluationResult` (isExplainable: true, trend/score/evidenceSignals/complianceGap); `buildScorecard()` → 6-dimension `OrchestrationComplianceScorecard` (fully-compliant/substantially-compliant/partially-compliant/non-compliant); `scoreExecutionGovernance()` → policyViolations/trustIndicators split; `assessEnterpriseTrust()` → `EnterpriseTrustIntelligence` (high/medium/low/critical, isExplainable: true); all advisory; `globalComplianceIntelligenceEngine` singleton
- **Replay governance reasoning engine**: `ReplayGovernanceReasoningEngine` — `buildGovernanceTrail()` → `ReplayGovernanceReasoningTrail` (isExplainable: true, 65+(i%4)×8 confidence pattern); `analyzeGovernanceAnomaly()` → `GovernanceAnomalyAnalysis` (complianceImpact 0=none/1=low/2-3=medium/4-5=high/>5=critical); `classifyRetryGovernance()` → `RetryGovernanceSemantics` (within-policy/borderline/policy-breach/escalation-required); `globalReplayGovernanceReasoningEngine` singleton
- **Federated governance memory fabric**: `FederatedGovernanceMemoryFabric` — `GovernanceMemoryRecord` (isAnonymized: true, isExplainable: true, TTL); `buildIndex()` → dominantMemoryType by count, strongestSignal = max(confidence×occurrenceCount), complianceHealthScore = % non-anomaly records; `ComplianceAntiPatternRecord` (policyViolationChain[]); `GovernanceRetentionPolicy` (auditAllRecords); TTL-based `evictExpired()`; `globalFederatedGovernanceMemoryFabric` singleton
- **Governance graph overlay builder**: `GovernanceGraphOverlayBuilder` — `build(collectionId, input)` composes `GovernanceOverlayIndicator[]` (6 types: policy-orchestration/compliance-reasoning-trail/dependency-compliance/trust-overlay/governance-evolution-trail/audit-signal); isExplainable: true on all; anti-pattern inputs always degrading; `trustHealthScore` = % non-degrading indicators; additive badges only, graph never mutated; `globalGovernanceGraphOverlayBuilder` singleton
- **Plugin stubs**: `IGovernanceEnricher`, `IReplayCompliancePlugin`, `IPolicyAutomationAdapter`, `IOrchestrationTrustScoringPlugin`, `IFederatedGovernanceIntelligenceEnricher`, `NoOpFederatedGovernanceEnricher`, `NoOpEnterpriseComplianceFabric`, `NoOpGlobalTrustOrchestrationMesh` — extension points for future compliance federation
- **Routes** (`/api/govautomation`, 19 endpoints): rules CRUD; decisions record/list; org summary; compliance evaluate/scorecard/execution-governance/enterprise-trust; reasoning trail/anomaly/retry-governance; memory records/index/evict/anti-patterns/retention-policy; governance graph overlay
- 68 unit tests passing, 0 TypeScript errors
- Governance automation invariants: all decisions advisory (no runtime mutation); compliance evaluations read-only; all memory isAnonymized: true; overlay additive-only (graph never mutated); retry governance classification advisory (never alters retry semantics); replay determinism preserved; DAG/WorkflowEnvelope/retries unchanged; non-governance tenants fully supported

### Unified Enterprise QA Operating System Completion, Platform Consolidation & Governed Global Reliability Fabric (Phase E Step 20 — shipped 2026-05-22)
- Module: `src/api-qaos/` — contracts, governance registry, consolidation engine, reasoning engine, memory fabric, overlay builder, routes
- **Unified orchestration governance registry**: `UnifiedOrchestrationGovernanceRegistry` — `UnifiedOrchestrationRule` (6 scopes: orchestration-federation/replay-continuity/operational-trust/reliability-coordination/cognition-harmonization/platform-consolidation); `recordDecision()` generates decisionId/evaluatedAt/governanceNote; `summarize(orgId)` → `EnterpriseOrchestrationSummary` (overallPlatformTrustLevel: unified/substantially-unified/partially-unified/fragmented); 3 default rules; `globalUnifiedOrchestrationGovernanceRegistry` singleton
- **Enterprise operational consolidation engine**: `EnterpriseOperationalConsolidationEngine` — `propose()` → `EnterpriseConsolidationProposal` (pending-review, 7-day expiry, isExplainable: true); `approve()` → consolidating-advisory; `reject()` → rolled-back; throws if not pending; `scoreConsolidation()` → 6-domain `PlatformConsolidationScorecard` (unified/substantially-unified/partially-unified/fragmented readiness); per-collection policy; `globalEnterpriseOperationalConsolidationEngine` singleton
- **Replay unified operational reasoning engine**: `ReplayUnifiedOperationalReasoningEngine` — `buildReasoningTrail()` → `UnifiedOperationalReasoningTrail` (isExplainable: true, 65+(i%4)×8 confidence); `analyzeOrchestrationAnomaly()` → platformImpact by signal count (0=none/1=low/2-3=medium/4-5=high/>5=critical); `harmonizeRetryGovernance()` → within-unified-policy/borderline-unified/policy-fragmentation/escalation-required; `globalReplayUnifiedOperationalReasoningEngine` singleton
- **Federated enterprise memory fabric**: `FederatedEnterpriseMemoryFabric` — `EnterpriseMemoryRecord` (isAnonymized: true, isExplainable: true, TTL); `buildIndex()` strongestSignal = max(confidence×occurrenceCount), operationalHealthScore = % non-anomaly records; `OrchestrationAntiPatternRecord` (governanceViolationChain[]); `EnterpriseRetentionPolicy` (auditAllRecords); `evictExpired()`; `globalFederatedEnterpriseMemoryFabric` singleton
- **Unified graph governance overlay builder**: `UnifiedGraphGovernanceOverlayBuilder` — `build()` → `UnifiedGovernanceOverlayIndicator[]` (6 types: enterprise-orchestration/replay-governance-reasoning-trail/dependency-continuity/orchestration-trust-overlay/unified-operational-evolution-trail/platform-consolidation-signal); isExplainable: true on all; anti-pattern inputs always degrading; `platformHealthScore` = % non-degrading; additive-only; `globalUnifiedGraphGovernanceOverlayBuilder` singleton
- **Plugin stubs**: `IEnterpriseOrchestrationEnricher`, `IReplayOperationalPlugin`, `IGovernanceFederationAdapter`, `IOrchestrationTrustScoringPlugin`, `IFederatedEnterpriseIntelligenceEnricher`, `NoOpUnifiedEnterpriseOrchestrationEnricher`, `NoOpEnterpriseOrchestrationCognitionFabric`, `NoOpGovernedSelfEvolvingQAEcosystem`, `NoOpAiAssistedEnterpriseOrchestrationGovernance` — future evolution extension points
- **Routes** (`/api/qaos`, 21 endpoints): rules CRUD; decisions record/list; org summary; consolidation propose/list/approve/reject/scorecard/policy; reasoning trail/anomaly/retry-harmonization; memory records/index/evict/anti-patterns/retention-policy; unified graph governance overlay
- 67 unit tests passing, 0 TypeScript errors
- Platform consolidation invariants: all proposals approval-gated (never auto-consolidate); all memory isAnonymized: true; overlay additive-only (graph never mutated); retry harmonization advisory (never alters retry semantics); replay determinism preserved; DAG/WorkflowEnvelope/retries unchanged; non-enterprise tenants fully supported; governed self-evolving ecosystem remains future extension point (not implemented)

### Enterprise Plugin Ecosystem, SDK Extensibility & Integration Marketplace Foundation (Phase E Step 8 — shipped 2026-05-22)
- Module: `src/api-plugins/` — contracts, registry, hooks, security guard, SDK access layer, routes
- **Plugin registry**: `PluginRegistry` — register/enable/disable/unregister/list with capability+tenant+status filters; `PluginManifest` declares capabilities, isolationTier, requiredRoles, tenantId; `globalPluginRegistry` singleton
- **Hook registry**: `HookRegistry` — priority-ordered hook execution (`before-request`/`after-response`/`assertion`/`replay-enricher`/`analytics-enricher`/`graph-overlay-enricher`); hooks annotate/enrich only — never alter execution order, retries, or DAG; hook failures swallowed silently (never propagate to runtime); `makeHookRegistration()` factory; `globalHookRegistry` singleton
- **Plugin security guard**: `PluginSecurityGuard` — RBAC-aware permission checks (capability-allowed/denied/tenant-mismatch/role-insufficient/plugin-disabled); isolation tier compliance (read-only/enrichment/integration); forbidden operations enforced (`alter-dag`, `alter-retries`, `mutate-workflow-envelope`, `read-unmasked-secrets`); secrets NEVER passed to plugins (maskedSecretRefs always empty); `globalPluginSecurityGuard` singleton
- **SDK access layer**: `SdkAccessLayer` — read-only surfaces: `getWorkflowInfo` (no WorkflowEnvelope internals), `getReplaySummary` (no raw event payloads), `getAnalyticsSummary`, `getGraphSummary`; wraps `findById` from store.ts; `globalSdkAccessLayer` singleton
- **Marketplace stubs**: `NoOpPluginMarketplace` — search/install/listWorkflowPacks extension points for future plugin catalog; `WorkflowPack` + `MarketplacePluginListing` contracts
- **Routes**: `GET/POST /api/plugins`, `GET /api/plugins/:id`, `POST /api/plugins/:id/enable`, `POST /api/plugins/:id/disable`, `POST /api/plugins/:id/hooks`, `GET /api/plugins/hooks/:type`, `POST /api/plugins/:id/check-permission`, `GET /api/plugins/sdk/workflow/:collectionId`
- 27 unit tests passing, 0 TypeScript errors
- Execution determinism preserved: plugins are extension points only; WorkflowEnvelope, DAG, retries, replay contracts all untouched

### Enterprise Analytics Platform, SLA Intelligence & Advanced Operational Insights (Phase E Step 7 — shipped 2026-05-22)
- Module: `src/api-analytics/` — contracts, engines, aggregators, routes
- **Execution trend aggregator**: `ExecutionTrendAggregator` — records `TrendSample[]` per collection; `aggregate(collectionId, windowMs)` computes avgPassRate/failRate/retryRate, avgDurationMs, p95DurationMs, flakinessScore; `evict(retentionMs)` for retention management; `globalExecutionTrendAggregator` singleton
- **SLA intelligence engine**: `SlaIntelligenceEngine` — policy-driven scorecard evaluation (latency/retry-rate/pass-rate/teardown-failure); breach records with advisory notes; score 0–100 (−25 per breach type); `listBreaches(collectionId)`; default SLA policy pre-registered; `globalSlaIntelligenceEngine` singleton
- **RCA analytics engine**: `RcaAnalyticsEngine` — pure functions: `computeFailureTrends()` (escalating/periodic/stable/isolated patterns, instability score), `identifyRetryHotspots()` (storm detection at configurable threshold), `identifyTeardownInstability()`; sorted by severity; `globalRcaAnalyticsEngine` singleton
- **Graph analytics overlay builder**: `GraphAnalyticsOverlayBuilder` — builds `GraphAnalyticsOverlay` with `AnalyticsNodeBadge[]` (retry-hotspot/sla-breach/dependency-unstable/execution-bottleneck/flakiness-high); deduplication by nodeId+badgeType (keep highest score); `isFresh` flag (< 5min); graph read-only, additive badges only; `globalGraphAnalyticsOverlayBuilder` singleton
- **Tenant analytics aggregator**: `TenantAnalyticsAggregator` — `TenantAnalyticsSummary` + `TeamReliabilityMetrics` + `EnvironmentHealthMetric`; in-memory store; `globalTenantAnalyticsAggregator` singleton
- **Predictive intelligence stubs**: `NoOpPredictiveFlakinessAnalyzer`, `NoOpSlaForecaster`, `NoOpAnomalyDetector` — extension points for Phase E Step 9+
- **Routes**: registered as `registerEnterpriseAnalyticsRoutes` (aliased to avoid conflict with existing `/api/analytics` flakiness routes); `POST /api/analytics/trends/record`, `GET /api/analytics/trends/:id`, `POST /api/analytics/sla/evaluate`, `GET /api/analytics/sla/:id/breaches`, `POST /api/analytics/rca/failure-trends`, `POST /api/analytics/rca/retry-hotspots`, `POST /api/analytics/graph-overlay/:id`, `GET/POST /api/analytics/tenant`
- 31 unit tests passing, 0 TypeScript errors
- All analytics purely observational — no auto-remediation, no execution mutation; replay determinism unchanged; existing flakiness routes untouched

### Cloud-Native Execution Platform, Kubernetes Readiness & Elastic Enterprise Scaling (Phase E Step 6 — shipped 2026-05-22)
- Module: `src/api-cloud/` — contracts, registries, advisor, routes
- **Cloud worker registry**: `CloudWorkerRegistry` — ephemeral worker lifecycle (pending/running/idle/draining/terminated); `register/update/get/listActive/terminate/snapshot`; `globalCloudWorkerRegistry` singleton
- **K8s readiness manifest builder**: `KubernetesReadinessManifestBuilder` — produces K8s-compatible `K8sExecutionPodSpec` (pod labels + annotations incl. tenant, collection, run, lease, replay-owner, teardown-owner); `validate()` checks required labels; advisory only — nothing deployed
- **Elastic scaling advisor**: `ElasticScalingAdvisor` — policy-driven scale-up/down/hold recommendations; threshold-based (scaleUpThreshold, scaleDownThreshold, burstContainmentLimit); advisory only — no auto-scale nondeterminism; default policy pre-registered; `globalElasticScalingAdvisor` singleton
- **Resource governance registry**: `ResourceGovernanceRegistry` — per-tenant worker quota policies (maxConcurrentRuns + burstAllowancePercent, maxQueueDepth, maxRetriesPerRun); `checkBudget()` advisory; `recordUsage/getUsage`; default policy pre-registered; `globalResourceGovernanceRegistry` singleton
- **Cloud queue broker abstraction**: `LocalInProcessBroker` (FIFO, in-memory default); `NoOpRedisBroker` stub; `NoOpAzureServiceBusBroker`/`NoOpRabbitMQBroker` extension points — wire connection strings + provider in Phase E Step 7+
- **Multi-cloud extension stubs**: `NoOpCloudOrchestrationProvider`, `NoOpDistributedReplayIndex` — future Kubernetes operators, Azure Container Apps, AWS ECS/EKS, GCP Cloud Run, multi-region federation
- **Routes**: `GET/POST /api/cloud/workers`, `POST /api/cloud/workers/:id/terminate`, `POST /api/cloud/k8s/pod-spec`, `GET /api/cloud/scaling/policies`, `POST /api/cloud/scaling/advise`, `GET /api/cloud/resource-governance/budget`, `GET /api/cloud/resource-governance/policies`, `GET /api/cloud/queue/stats`
- 34 unit tests passing, 0 TypeScript errors
- Local single-node execution unchanged and remains default; replay determinism preserved; WorkflowEnvelope authority untouched; all governance/RBAC/audit unchanged

### Enterprise Graph Editor Evolution & Controlled Visual Workflow Authoring (Phase E Step 5 — shipped 2026-05-22)
- Module: `src/api-graph-editor/` — contracts, DAG validator, dependency editor, authoring session, routes
- **WorkflowEnvelope authority preserved**: all graph editing produces visualization metadata only — zero writes to WorkflowEnvelope or execution runtime
- **Layout snapshot store**: `InMemoryLayoutSnapshotStore` — save/load/delete `LayoutSnapshot` (positions + visualGroups + layoutLocked); `globalLayoutSnapshotStore` singleton
- **DAG validator**: `DagValidator` — full validation (cycle/self-loop/unknown-dep); Kahn's BFS topological sort; `hasCycle()` fast-path; `globalDagValidator` singleton
- **Dependency editor**: `DependencyEditor` — add/remove `dependsOn` edges with cycle prevention (DFS tentative check before apply); `dryRun()` for batch validation; `globalDependencyEditor` singleton
- **Graph authoring session**: `GraphAuthoringSession` — composes all three above; `saveLayout`, `applyDependencyEdit` (validates DAG after apply), `validateDag`, `recordEdit` (audit trail), `snapshot`; `globalGraphAuthoringSession` singleton
- **Collaborative editor stubs**: `NoOpCollaborativeGraphEditor`, `NoOpWorkflowTemplateRegistry` — extension points for future real-time collaboration and workflow templates
- **Routes**: `GET/POST /api/graph-editor/:collectionId/layout`, `DELETE /api/graph-editor/:collectionId/layout`, `POST /api/graph-editor/:collectionId/validate-dag`, `POST /api/graph-editor/:collectionId/dependency`, `GET /api/graph-editor/:collectionId/snapshot`
- 32 unit tests passing, 0 TypeScript errors
- Replay determinism preserved; existing graph projection unchanged; GraphProjection remains derived/ephemeral; all overlays, AI recommendations, governance flows untouched

### Security Hardening, Secret Governance & Compliance-Ready Execution Controls (Phase E Step 4 — shipped 2026-05-22)
- Module: `src/api-security/` — contracts, engines, routes
- **Secret governance**: `SecretGovernanceEngine` — `isSecret(key)`, `classify(key)` → SecretClassification, `scanRecord(record, layer)` → violation list; advisory only, never mutates
- **Configurable masking policy**: `ConfigurableMaskingPolicy` — `maskHeaders/maskVariables/maskBodyFields/mergeReports`; extends existing SENSITIVE_HEADER_RE/SENSITIVE_VAR_RE patterns; `DEFAULT_MASKING_CONFIG` covers auth/token/password/secret/cookie/x-api-key; `maskReplayPayloads: true`, `maskAiOverlays: true`
- **Compliance audit exporter**: `ComplianceAuditExporter` — append-only `ComplianceTraceRecord[]`; `export(format)` returns `ComplianceAuditExport` with SHA-256 `integrityHash`; `verify(exported)` checks tamper evidence
- **Environment security guard**: `EnvironmentSecurityGuard` — policy registry (allowedRoles, approvalRequirement, restrictSecretDecryption, blockReplaySynthesis); `checkAccess(envId, role)` → `EnvironmentAccessDecision`; default production policy (admin-only, single-approver)
- **Worker security boundary**: `WorkerSecurityBoundary` — `markSecretsActive/clearSecrets/forceCleanup/snapshot`; `SecretCleanupRecord` with advisory notes; teardown cleanup guarantee
- **Vault extension stubs**: `ISecretVault`, `IAzureKeyVaultProvider`, `IHashiCorpVaultProvider`, `NoOpSecretVault` — wire in Phase E Step 7+ for real vault
- **Routes**: `GET /api/security/masking-policy`, `POST /api/security/secret-scan`, `POST /api/security/mask-headers`, `GET /api/security/compliance/audit-export`, `GET /api/security/environment/:envId/access`, `GET/POST /api/security/environment/policies`, `GET/POST /api/security/workers/:workerId/snapshot`, `POST /api/security/workers/:workerId/force-cleanup`
- 33 unit tests passing, 0 TypeScript errors
- All enforcement is advisory — no auto-blocking of existing execution; replay determinism, WorkflowEnvelope, DAG, and runtime semantics unchanged

### Distributed Queue Orchestration & Scalable Worker Execution Foundation (Phase E Step 3 — shipped 2026-05-22)
- Module: `src/api-orchestration/` — contracts, implementations, routes
- **Queue orchestrator**: `LocalQueueOrchestrator` — composes `InMemoryExecutionQueue` + `InMemoryLeaseRegistry`; submit/cancel/drainOne/snapshot; runId→requestId map for correct cancel; singleton via `getQueueOrchestratorSingleton()`
- **Lease renewer**: `InMemoryLeaseRenewer` — renew (re-acquire with extended TTL), forceRelease (advisory, no auto-restart), detectStuck (threshold-based)
- **Heartbeat registry**: `InMemoryHeartbeatRegistry` — record/latest/detectDead/snapshot; dead threshold configurable; `globalHeartbeatRegistry` singleton
- **Dispatch strategy**: `LocalDispatchStrategy` (always local) + `AffinityDispatchStrategy` stub (env/tenant affinity, falls through to local today)
- **Distributed replay coordinator**: `SingleWorkerReplayCoordinator` — single-worker passthrough + multi-worker seq-sorted merge with deduplication; `validateDeterminism()` ensures strict seq ordering; `deterministicGuarantee: true` in all results
- **Cloud queue stubs**: `IRedisExecutionQueue`, `IAzureServiceBusQueue`, `IKubernetesJobRunner` + no-op impls for Phase E Step 7+
- **Routes**: `GET /api/orchestration/queue/snapshot`, `/leases`, `/leases/stuck`, `POST /leases/:runId/force-release`, `GET/POST /api/orchestration/heartbeats`
- 26 unit tests passing, 0 TypeScript errors
- Single-node execution unchanged; all existing coordinator/lease/worker-pool infrastructure untouched; replay determinism preserved

### Persistence Layer Evolution & Scalable Storage Abstraction (Phase E Step 2 — shipped 2026-05-22)
- Module: `src/api-persistence/` — contracts, provider, repositories, registry
- **Storage provider abstraction**: `IStorageProvider` / `IAtomicStorageProvider` — backend-agnostic interface; `JsonStorageProvider` wraps `store.ts` (zero behavior change)
- **Repository contracts (6)**: `ICollectionRepository`, `IApiRunRepository`, `IReplayRepository`, `IFlakinessRepository`, `IAuditRepository`, `IRemediationRepository` — clean domain interfaces, decoupled from runtime
- **JSON implementations (6)**: all repositories wrap existing stores (`store.ts`, `replay-event-store.ts`, `flakiness-store.ts`, `proposal-store.ts`, `approval-store.ts`) — no behavior change, fully backward-compatible
- **Persistence registry**: `globalPersistenceRegistry` singleton — provides all 6 repositories; swap backend by changing provider here only
- **Cloud extension points**: `ISqlStorageProvider`, `ICloudStorageProvider`, `ITenantPartitionedProvider`, `IReplayArchiveTier` — no-op stubs; wire in Phase E Steps 7+ for SQLite/Postgres/Azure
- **Audit repository**: append-only invariant enforced at interface level — no update/delete methods exposed
- **Replay repository**: `listIndex()` — reads `ReplayIndexEntry[]` without loading full session payloads (scalability optimization)
- 24 unit tests passing, 0 TypeScript errors
- JSON persistence remains default and unchanged; all existing callers unaffected

### Runtime Performance Optimization & Scalability Hardening (Phase E Step 1 — shipped 2026-05-22)
- Module: `src/api-performance/` — contracts, profiling, optimization, safeguards, scalability, routes
- **Profiling layer** (observational only): `withProfilingSync/Async`, `recordSpan`, `globalProfilerRegistry` (1000-event circular buffer), phase stats aggregation
- **Graph projection cache**: `globalProjectionCache` — TTL-based (30s default), hit/miss/eviction stats; integrated into `projection-service.ts` (cache-first, non-breaking)
- **Overlay differ**: `diffOverlays()` — pure fn, computes `OverlayDiff` (addedBadges, removedBadges, nodesAdded/removed) for incremental rendering prep
- **Event compactor**: `compactReplaySession()` — view-only copy (never mutates store); folds ≥3 consecutive same-kind events; terminal events (step-completed, failure-propagated) never folded; `deterministicGuarantee: true` in result
- **Performance safeguards**: `PerformanceSafeguards` — 6 configurable threshold checks (graph size, replay growth, polling overload, retry storm, memory pressure, cache miss rate); advisory-only, zero auto-throttling
- **Scalability extension points**: `IWebSocketOverlayChannel`, `IGraphVirtualizer`, `IAdaptivePoller`, `ICloudTelemetryEmitter`, `IDistributedReplayIndex`, `IShardCache`, `IReplayArchiver` — all no-op stubs today; wire in future Phase E steps
- **Graph rendering hints**: `VirtualizationReadiness` added to `ProjectionMeta` (optional, absent for small graphs); computed in `graph-projection-builder.ts` when nodeCount ≥ 100
- **Routes**: `GET /api/performance/profile`, `GET /api/performance/cache/stats`, `POST /api/performance/cache/invalidate/:collectionId`, `GET /api/performance/safeguards`
- 26 unit tests passing, 0 TypeScript errors
- Invariants preserved: execution semantics unchanged, replay determinism unchanged, WorkflowEnvelope remains authoritative, governance/AI layers untouched

### Enterprise AI Remediation Governance (Phase D Step 15 — shipped 2026-05-22)
- Module: `src/api-remediation/` — contracts, engines, stores, policy-registry, graph-overlay-remediator, routes
- Engines: proposal-diff (field-level diff), proposal-engine (pure fn: AiRecommendation[] → RemediationProposal[])
- Proposal categories: retry-tuning, url-healing, dependency-restructure, assertion-repair, flaky-stabilization, environment-correction
- ADVISORY + APPROVAL-GATED — proposals have `pending-approval` status; must be explicitly approved or rejected by authorized user
- Stores: `data/remediation-proposals.json` (atomic write) + `data/remediation-approvals.json` (atomic write, audit trail)
- Policy: `RemediationPolicyRegistry` — confidence threshold, restricted envs, approver roles, `globalRemediationPolicyRegistry` singleton
- Graph overlay: `annotateOverlayWithProposals()` augments existing AiGraphOverlayBundle with `approval-pending`/`remediation-proposed` badges
- RBAC: `api:propose-remediation` (admin/editor/tester) + `api:approve-remediation` (admin/editor)
- Audit: `api:remediation:proposed`, `api:remediation:approved`, `api:remediation:rejected` via existing `logApiAudit`
- Routes: `POST /api/remediation/collections/:id/proposals`, `GET /api/remediation/collections/:id/proposals`, `POST /api/remediation/proposals/:id/approve`, `POST /api/remediation/proposals/:id/reject`, `GET /api/remediation/approvals`
- UI: "Remediation Proposals" section in AI Insights tab (25-api-runs.js) — generate proposals button, diff table, approve/reject buttons, status badges
- Backward compatible: existing collections, runs, recommendations, replay, graph overlays all unchanged
- Future extension points: `rolled-back` status, policy-approved autonomous healing, confidence-based auto-approval (not implemented)

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
