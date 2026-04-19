# QA Agent Platform — Self-Healing Locator Feature Plan
# Created: 2026-04-11 | Owner: Harmeet Saini (Principal SDET)
# Status: P1–P5 + Supplemental ALL DONE ✅ | Last updated: 2026-04-17

---

## Overview

Self-Healing Locators allow test scripts to automatically recover when a UI element changes its
selector (class, ID, attribute, position) between test runs — without failing the test or requiring
manual script updates.

This matches the capability offered by commercial tools (Healenium, TestRigor, Mabl, etc.) and is a
core enterprise differentiator for the QA Agent Platform.

### Architecture Principle
> Extend existing infrastructure — do NOT build new systems.
>
> 70%+ of required infrastructure already exists:
> - `recorder.js` already captures all locator variants
> - `codegenGenerator.ts` catch blocks already handle step failure
> - Locator Repository already stores selectors per project
> - Debugger IPC channel already pauses mid-spec and accepts patch-step commands

---

## Tier Model

| Tier | Trigger | Confidence Needed | Human Review? |
|------|---------|-------------------|---------------|
| **T1 — Playwright Native** | Playwright built-in retry/auto-wait | n/a | Never |
| **T2 — Alternatives Fallback** | Primary selector fails | any | Never |
| **T3 — Similarity Engine** | All alternatives fail | ≥ 75 | Auto-apply; log to Proposals |
| **T4 — Human Review** | Score < 75 OR ASSERT step | < 75 | Always; shows Proposal card |

**Golden rule: ASSERT steps NEVER auto-heal — always require human review.**

---

## Key Data Structures (to be added to `src/data/types.ts`)

```typescript
export interface LocatorAlternative {
  selector:     string;
  selectorType: string;
  confidence:   number;   // 0–100
}

export interface HealingProfile {
  tag:          string;
  text:         string | null;
  ariaLabel:    string | null;
  role:         string | null;
  classes:      string[];
  placeholder:  string | null;
  testId:       string | null;
  parentTag:    string | null;
  parentId:     string | null;
  parentClass:  string | null;
  domDepth:     number;
  siblingIndex: number;
  capturedAt:   string;
  capturedFrom: 'recorder' | 'prescan' | 'manual';
}

export interface HealingStats {
  healCount:       number;
  lastHealedAt:    string | null;
  lastHealedFrom:  string | null;
  lastHealedBy:    'auto' | 'approved' | null;
}

export interface PageModel {
  id:           string;
  projectId:    string;
  pageKey:      string;   // normalised URL pattern e.g. /patients/:id/records
  pageName:     string;
  locatorIds:   string[];
  capturedAt:   string;
  capturedFrom: 'recorder' | 'prescan';
}

export interface HealingProposal {
  id:              string;
  projectId:       string;
  locatorId:       string;
  locatorName:     string;
  scriptId:        string;
  scriptTitle:     string;
  stepOrder:       number;
  oldSelector:     string;
  oldSelectorType: string;
  newSelector:     string;
  newSelectorType: string;
  confidence:      number;
  healedAt:        string;
  status:          'auto-applied' | 'pending-review' | 'approved' | 'rejected';
  reviewedBy?:     string;
  reviewedAt?:     string;
  screenshotPath?: string;
}
```

**`Locator` interface extensions:**
```typescript
importanceScore:  number;           // 0–100 stability rating (computed at record time)
alternatives:     LocatorAlternative[];
healingProfile:   HealingProfile;
healingStats:     HealingStats;
pageKey:          string | null;    // normalised URL at time of recording
```

**Importance Score Formula:**
```
base = 50
+ testId present      → +50
+ ariaLabel present   → +40
+ visible text present→ +35
+ role present        → +30
+ stable static ID    → +25
- generated ID (uuid-like, incrementing) → -20
capped at [0, 100]
```

**Weighted Similarity Scoring (T3 engine):**
```
testid    → weight 10
ariaLabel → weight  9
text      → weight  8
role      → weight  7
class     → weight  5
id        → weight  4
parentTag → weight  3
domDepth  → weight  2
siblingIdx→ weight  1
total max = 49 → normalise to 0–100
```

---

## Implementation Phases

---

### Phase 1 — Locator Enrichment (Foundation) ✅ ACTIVE
**Goal:** Every locator captured by the recorder carries a full healing profile.
No healing logic yet — just richer data capture.

| ID | Task | File(s) | Status |
|----|------|---------|--------|
| P1-C | Add `LocatorAlternative`, `HealingProfile`, `HealingStats`, `PageModel`, `HealingProposal` interfaces to `types.ts`; extend `Locator` interface with `importanceScore`, `alternatives[]`, `healingProfile`, `healingStats`, `pageKey` | `src/data/types.ts` | ✅ Done |
| P1-A | Extend `recorder.js` to capture full `healingProfile{}` + all generated locators as `alternatives[]` + compute `importanceScore` | `src/ui/public/recorder.js` | ✅ Done |
| P1-B | Extend `recorderParser.ts` to persist the full profile when saving to Locator Repo | `src/utils/recorderParser.ts` | ✅ Done |
| P1-D | Extend Locator Repo UI to show importanceScore stability badge (🟢 ≥80 / 🟡 50–79 / 🔴 <50) | `src/ui/public/modules.js` | ✅ Done |
| P1-E | Save `pageKey` (normalised URL: replace `/123` → `/:id`) on every Locator entry during recording | `src/ui/public/recorder.js` + `recorderParser.ts` | ✅ Done |

**Acceptance criteria:**
- Record a login flow → open Locator Repo → each entry shows importance badge + alternatives count
- `data/locators/*.json` contains `healingProfile`, `alternatives[]`, `importanceScore`, `pageKey`
- No existing test scripts break

---

### Phase 2 — T2 Alternatives Fallback (Silent Healing)
**Goal:** When a locator's primary selector fails at runtime, silently try its `alternatives[]` before
failing the step. Zero config — fully transparent to the SDET.

| ID | Task | File(s) | Status |
|----|------|---------|--------|
| P2-A | Add `__tryAlts`, `__buildLoc`, `__execWithLoc` helpers in spec preamble | `src/utils/codegenGenerator.ts` | ✅ Done |
| P2-B | Embed `__alt_N` alternatives array per step; replace `throw` with T2 heal attempt in catch | `src/utils/codegenGenerator.ts` | ✅ Done |
| P2-C | `attachHealEvents()` reads `healed.ndjson` after run; appends to `data/healing-log.ndjson`; `GET /api/heal-log` endpoint | `src/ui/server.ts` | ✅ Done |
| P2-D | `healCount` field in `/api/runs` response; 🩹 Healed N badge in Execution History table | `src/ui/server.ts` + `modules.js` | ✅ Done |

**Acceptance criteria:**
- Break an element's CSS class → re-run → test passes silently using alternative selector
- Execution report shows which step used fallback + which alternative was chosen

---

### Phase 3 — T3 Similarity Engine (Smart Healing)
**Goal:** When all alternatives are exhausted, scan the live DOM, score candidates against the stored
`HealingProfile`, and auto-apply if confidence ≥ 75.

| ID | Task | File(s) | Status |
|----|------|---------|--------|
| P3-A | Build `healingEngine.ts` — `scoreCandidate(profile, domElement)` + `DOM_SCANNER_IIFE` | `src/utils/healingEngine.ts` | ✅ Done |
| P3-B | Add `__tryT3Heal` + DOM scanner to spec preamble; T3 fallback in step catch blocks | `src/utils/codegenGenerator.ts` | ✅ Done |
| P3-C | `POST /api/heal` — scores candidates, returns best match; `GET /api/proposals` | `src/ui/server.ts` | ✅ Done |
| P3-D | Write `HealingProposal` to `data/proposals/<id>.json` on every T3 heal event | `src/ui/server.ts` | ✅ Done |
| P3-E | Auto-update `alternatives[]` + `healingStats` in Locator Repo on auto-apply | `src/ui/server.ts` | ✅ Done |
| P3-F | Healing Proposals sub-tab in Locator Repo (Approve/Reject, status filter, pending count badge) | `modules.js` + `index.html` + `styles_addon.css` | ✅ Done |

**Acceptance criteria:**
- Remove ALL selectors for an element except its `healingProfile` → re-run → test heals automatically
- `data/proposals/` file created for each healed step
- Locator Repo "Proposals" tab shows the event with old vs new selector diff

---

### Phase 4 — T4 Human Review Queue ✅ DONE
**Goal:** For low-confidence heals (< 75) and all ASSERT steps, pause the run and surface a proposal
card that the engineer must approve or reject before the run continues.

| ID | Task | File(s) | Status |
|----|------|---------|--------|
| P4-A | Detect T4 condition in `codegenGenerator.ts` catch block — `__tryT4Heal()` helper writes `pending-heal.json` to `test-results/<runId>/`; spec polls `heal-response.json` (500 ms interval, 10 min timeout) | `src/utils/codegenGenerator.ts` | ✅ Done |
| P4-B | Server `GET /api/debug/heal-pending` — returns pending heal proposal JSON for a running suite (reads `pending-heal.json` from run dir) | `src/ui/server.ts` | ✅ Done |
| P4-C | T4 Proposal Card modal — shown during `execPoll()` when heal-pending detected; displays broken selector, T3 candidate + score, SDET override input; Approve / Reject buttons | `src/ui/public/modules.js` + `index.html` + `styles_addon.css` | ✅ Done |
| P4-D | Server `POST /api/debug/heal-respond` — writes `heal-response.json` so spec exits poll loop and continues or throws | `src/ui/server.ts` | ✅ Done |
| P4-E | On Approve: write `HealingProposal` with `status: 'approved'` to `data/proposals/`; update Locator Repo `alternatives[]` + `healingStats` | `src/ui/server.ts` | ✅ Done |
| P4-F | ASSERT safety guard — `isAssert` branch in catch block calls `__tryT4Heal` (runs T3 scan first to find candidate, then requests human review) regardless of confidence | `src/utils/codegenGenerator.ts` | ✅ Done |

**Acceptance criteria:**
- ASSERT step with broken locator → run pauses → overlay shows proposal card → SDET approves
- Approved selector is immediately saved to Locator Repo
- Rejected proposal is recorded but locator unchanged → run marks step failed

---

### Phase 5 — Page Model + Pre-Scan (Proactive Healing) ✅ DONE
**Goal:** Before a script runs, scan every page it touches and pre-validate all locators. Flag any
that are already broken — before they cause a failure mid-run.

| ID | Task | File(s) | Status |
|----|------|---------|--------|
| P5-A | `pageModelManager.ts` — CRUD for `PageModel` records in `data/page-models/*.json`; `upsertPageModel`, `getPageModelByKey`, `listPageModels`, `deletePageModel` | `src/utils/pageModelManager.ts` | ✅ Done |
| P5-B | Recorder stop upserts `PageModel` — groups captured step `locatorId`s by `pageKey` (from Locator Repo entry) and calls `upsertPageModel` for each unique page visited | `src/ui/server.ts` (recorder stop handler) | ✅ Done |
| P5-C | `POST /api/prescan` — receives DOM candidates from spec `beforeAll`, scores all locators with matching `projectId`+`pageKey` via `scoreCandidates()`, persists health report to `data/prescan/<runId>.json`; `GET /api/prescan` for UI polling; `GET /api/page-models` list endpoint | `src/ui/server.ts` | ✅ Done |
| P5-D | Suite spec `test.beforeAll()` — navigates to environment URL in a separate context, runs `__qaDomScan`, POSTs candidates to `/api/prescan` before any test step executes. `normalizePageKey()` helper added to `codegenGenerator.ts` | `src/utils/codegenGenerator.ts` | ✅ Done |
| P5-E | Pre-Scan Health Grid in Execution tab — `execPoll()` polls `GET /api/prescan?runId=xxx` alongside heal-pending; `renderPrescanHealth()` renders per-locator score bars (🟢/🟡/🔴) + summary chips above the test results | `src/ui/public/modules.js` + `index.html` + `styles_addon.css` | ✅ Done |
| P5-F | "Validate Locators" button in Locator Repo — opens a modal with environment URL selector; `prescanRun()` calls `POST /api/prescan-trigger` which spawns a minimal headless Playwright spec that scans the URL and POSTs results back; modal shows live health grid | `src/ui/public/modules.js` + `index.html` + `server.ts` | ✅ Done |

**Acceptance criteria:**
- Run suite on stale app → pre-scan runs first → health grid shows 3 broken locators before any step executes
- Broken locators shown in amber/red in Locator Repo with "Last validated" timestamp

---

### Supplemental Enhancements — Post-Phase 3 ✅ COMPLETED
**Goal:** Platform stability, user feedback, and recorder quality improvements implemented after P3 completion.

| ID | Task | File(s) | Status |
|----|------|---------|--------|
| S1 | Add `WAIT FOR TOAST` + `ASSERT TOAST` keywords to codegen engine; include both in `NO_DIFF_KW` to exclude from visual diff comparisons | `src/utils/codegenGenerator.ts` | ✅ Done |
| S2 | Sync-fail banner UI — `.sync-fail-banner` amber warning banner + `.sync-fail-step-badge` inline badge displayed when a locator cannot sync during script/function list rendering | `src/ui/public/styles_addon.css` | ✅ Done |
| S3 | Recorder enrichment improvements — extended `recorder.js` (shadow DOM, dialog capture, iframe events, improved healing profile capture) + `recorderParser.ts` alignment with enriched recorder output | `src/ui/public/recorder.js` + `src/utils/recorderParser.ts` | ✅ Done |

---

## Dependency Order

```
P1 (Data Enrichment)
  └─► P2 (Alternatives Fallback)       ← needs alternatives[] from P1
        └─► P3 (Similarity Engine)     ← needs healingProfile from P1 + fallback infra from P2
              └─► P4 (Human Review)   ← needs proposal store from P3 + IPC pattern from Debugger
                    └─► P5 (Prescan)  ← needs PageModel from P1-E + scoring engine from P3
```

---

## Files Modified Per Phase

| Phase | Files Touched |
|-------|--------------|
| P1 | `types.ts`, `recorder.js`, `recorderParser.ts`, `modules.js` |
| P2 | `codegenGenerator.ts`, `server.ts`, `modules.js` |
| P3 | `healingEngine.ts` (new), `codegenGenerator.ts`, `server.ts`, `modules.js`, `index.html` |
| P4 | `codegenGenerator.ts`, `server.ts`, `modules.js`, `index.html` |
| P5 | `pageModelManager.ts` (new), `recorder.js`, `server.ts`, `codegenGenerator.ts`, `modules.js`, `index.html` |

---

## Progress Tracker

| Phase | Tasks | Done | Remaining |
|-------|-------|------|-----------|
| P1 — Locator Enrichment | 5 | 5 | 0 |
| P2 — Alternatives Fallback | 4 | 4 | 0 |
| P3 — Similarity Engine | 6 | 6 | 0 |
| P4 — Human Review | 6 | 6 | 0 |
| P5 — Pre-Scan | 6 | 6 | 0 |
| Supplemental Enhancements | 3 | 3 | 0 |
| **Total** | **31** | **31** | **0** |

---

*Last updated: 2026-04-17*
