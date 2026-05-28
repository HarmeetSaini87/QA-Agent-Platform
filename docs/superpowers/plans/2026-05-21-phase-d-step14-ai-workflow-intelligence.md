# Phase D Step 14: AI-Assisted Workflow Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, advisory-only AI recommendation layer that analyzes workflow structure, flakiness data, retry patterns, and replay sessions to surface actionable intelligence — without touching runtime execution or WorkflowEnvelope.

**Architecture:** A new `src/api-intelligence/` module with pure-function engines (no side effects) that accept existing data types and emit `AiRecommendation[]` or `RcaHint[]`. A thin recommendation service orchestrates all engines, applies tenant isolation, and audits generation via `logApiAudit`. Three REST endpoints expose the results. The UI adds an "AI Insights" panel to the run detail view in `25-api-runs.js`.

**Tech Stack:** TypeScript, Express, nanoid (already in deps), existing contracts from `api-flakiness`, `api-observability`, `api-governance`.

---

## File Map

### New Files
| Path | Responsibility |
|------|---------------|
| `src/api-intelligence/contracts/recommendation.contracts.ts` | `AiRecommendation`, `RecommendationBundle`, confidence/provenance types |
| `src/api-intelligence/contracts/rca-hints.contracts.ts` | `RcaHint`, `RcaHintBundle`, evidence types |
| `src/api-intelligence/contracts/graph-overlay-ai.contracts.ts` | `AiGraphAnnotation`, `AiOverlayBadge`, `AiGraphOverlayBundle` |
| `src/api-intelligence/engines/dependency-analyzer.ts` | Bottleneck detection, missing teardown, orphan dependency refs |
| `src/api-intelligence/engines/retry-intelligence.ts` | Teardown+retry anti-pattern, over-retry detection |
| `src/api-intelligence/engines/flakiness-insights.ts` | High fail-rate, alternation storm, cascade origin hints |
| `src/api-intelligence/engines/rca-hint-engine.ts` | Replay-assisted: assertion failure, propagation chain, retry hotspot, skip cascade |
| `src/api-intelligence/engines/workflow-quality-analyzer.ts` | Assertion coverage, teardown coverage, recent pass-rate score |
| `src/api-intelligence/recommendation-service.ts` | Orchestrates all engines, sorts by severity/confidence, audits, applies tenant |
| `src/api-intelligence/routes/ai-intelligence.routes.ts` | `GET /api/ai-intelligence/collections/:id/recommendations`, `/graph-overlay`, `/runs/:id/rca-hints` |
| `src/api-intelligence/__tests__/recommendation.contracts.test.ts` | Type-shape smoke tests |
| `src/api-intelligence/__tests__/retry-intelligence.test.ts` | Teardown+retry and over-retry detection |
| `src/api-intelligence/__tests__/rca-hint-engine.test.ts` | Propagation chain and retry hotspot hints |
| `src/api-intelligence/__tests__/recommendation-service.test.ts` | Full-bundle sort order and advisory note |

### Modified Files
| Path | Change |
|------|--------|
| `src/api-governance/audit.contracts.ts` | Extend `ApiAuditAction` with two new values |
| `src/ui/server.ts` | Register `registerAiIntelligenceRoutes` |
| `src/ui/public/js/25-api-runs.js` | Add AI Insights panel to run detail view |
| `src/ui/public/styles_addon.css` | AI Insights panel CSS |
| `CLAUDE.md` | Step 14 checkpoint |

---

## Task 1: AI Recommendation Contracts

**Files:**
- Create: `src/api-intelligence/contracts/recommendation.contracts.ts`
- Create: `src/api-intelligence/contracts/rca-hints.contracts.ts`
- Create: `src/api-intelligence/contracts/graph-overlay-ai.contracts.ts`
- Test: `src/api-intelligence/__tests__/recommendation.contracts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api-intelligence/__tests__/recommendation.contracts.test.ts
import type { AiRecommendation, RecommendationBundle, RecommendationBasis } from '../contracts/recommendation.contracts';
import type { RcaHint, RcaHintBundle } from '../contracts/rca-hints.contracts';
import type { AiGraphAnnotation, AiGraphOverlayBundle } from '../contracts/graph-overlay-ai.contracts';

describe('recommendation.contracts', () => {
  it('AiRecommendation has required fields', () => {
    const rec: AiRecommendation = {
      id: 'abc',
      category: 'retry',
      severity: 'warning',
      title: 'Test',
      detail: 'Detail',
      confidence: 80,
      actionHint: 'Fix it',
      provenance: { source: 'retry-intelligence', basis: 'deterministic', evidenceRefs: [], generatedAt: '2026-01-01T00:00:00Z' },
    };
    expect(rec.confidence).toBe(80);
    expect(rec.category).toBe('retry');
  });

  it('RecommendationBundle has advisoryNote', () => {
    const bundle: RecommendationBundle = {
      generatedAt: '2026-01-01T00:00:00Z',
      recommendations: [],
      advisoryNote: 'advisory only',
    };
    expect(bundle.advisoryNote).toBeTruthy();
  });

  it('RcaHint has basis and evidences', () => {
    const hint: RcaHint = {
      id: 'r1',
      runId: 'run1',
      title: 'Failure',
      probableCause: 'assertion failed',
      confidence: 75,
      basis: 'replay-evidence',
      evidences: [{ type: 'replay', ref: 'seq:3', detail: 'step failed' }],
      generatedAt: '2026-01-01T00:00:00Z',
    };
    expect(hint.basis).toBe('replay-evidence');
    expect(hint.evidences).toHaveLength(1);
  });

  it('AiGraphAnnotation has nodeId and badges', () => {
    const ann: AiGraphAnnotation = {
      nodeId: 'step-1',
      stepId: 'step-1',
      badges: [{ type: 'retry-hotspot', label: 'hotspot', confidence: 70, detail: 'retries' }],
    };
    expect(ann.badges[0].type).toBe('retry-hotspot');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx jest src/api-intelligence/__tests__/recommendation.contracts.test.ts --no-coverage
```
Expected: FAIL — module not found

- [ ] **Step 3: Create recommendation.contracts.ts**

```typescript
// src/api-intelligence/contracts/recommendation.contracts.ts

export type RecommendationCategory =
  | 'dependency'
  | 'retry'
  | 'flakiness'
  | 'healing'
  | 'assertion'
  | 'environment'
  | 'replay-rca'
  | 'workflow-quality';

export type RecommendationSeverity = 'info' | 'warning' | 'critical';

export type RecommendationBasis = 'heuristic' | 'deterministic' | 'replay-evidence';

export interface RecommendationProvenance {
  source: string;
  basis: RecommendationBasis;
  evidenceRefs: string[];
  generatedAt: string;
}

export interface AiRecommendation {
  id: string;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  title: string;
  detail: string;
  /** 0–100 heuristic confidence that this recommendation is actionable */
  confidence: number;
  actionHint: string;
  provenance: RecommendationProvenance;
  collectionId?: string;
  runId?: string;
  stepId?: string;
  tenantId?: string;
}

export interface RecommendationBundle {
  collectionId?: string;
  runId?: string;
  generatedAt: string;
  recommendations: AiRecommendation[];
  /** Always present — reminds callers that AI is advisory only */
  advisoryNote: string;
}
```

- [ ] **Step 4: Create rca-hints.contracts.ts**

```typescript
// src/api-intelligence/contracts/rca-hints.contracts.ts

export type RcaHintSource = 'replay' | 'flakiness' | 'graph' | 'retry-history';

export interface RcaHintEvidence {
  type: RcaHintSource;
  /** runId / stepId / seq:N / eventId */
  ref: string;
  detail: string;
}

export interface RcaHint {
  id: string;
  runId: string;
  stepId?: string;
  stepName?: string;
  title: string;
  probableCause: string;
  /** 0–100 */
  confidence: number;
  basis: 'heuristic' | 'deterministic' | 'replay-evidence';
  evidences: RcaHintEvidence[];
  generatedAt: string;
}

export interface RcaHintBundle {
  runId: string;
  generatedAt: string;
  hints: RcaHint[];
  advisoryNote: string;
}
```

- [ ] **Step 5: Create graph-overlay-ai.contracts.ts**

```typescript
// src/api-intelligence/contracts/graph-overlay-ai.contracts.ts

export type AiOverlayBadgeType =
  | 'unstable-dependency'
  | 'retry-hotspot'
  | 'optimization-hint'
  | 'healing-confidence'
  | 'replay-anomaly';

export interface AiOverlayBadge {
  type: AiOverlayBadgeType;
  label: string;
  /** 0–100 */
  confidence: number;
  detail: string;
}

export interface AiGraphAnnotation {
  /** Maps to workflow graph node id */
  nodeId: string;
  stepId: string;
  badges: AiOverlayBadge[];
}

export interface AiGraphOverlayBundle {
  collectionId: string;
  runId?: string;
  generatedAt: string;
  annotations: AiGraphAnnotation[];
  advisoryNote: string;
}
```

- [ ] **Step 6: Run test to verify it passes**

```
npx jest src/api-intelligence/__tests__/recommendation.contracts.test.ts --no-coverage
```
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```
git add src/api-intelligence/contracts/ src/api-intelligence/__tests__/recommendation.contracts.test.ts
git commit -m "feat(ai-intelligence): add recommendation, rca-hints, graph-overlay-ai contracts"
```

---

## Task 2: Dependency Analyzer Engine

**Files:**
- Create: `src/api-intelligence/engines/dependency-analyzer.ts`

- [ ] **Step 1: Create dependency-analyzer.ts**

```typescript
// src/api-intelligence/engines/dependency-analyzer.ts

import { nanoid } from 'nanoid';
import { ApiTestStep } from '../../data/types';
import { AiRecommendation, RecommendationProvenance } from '../contracts/recommendation.contracts';
import { AiGraphAnnotation } from '../contracts/graph-overlay-ai.contracts';

function provenance(evidenceRefs: string[]): RecommendationProvenance {
  return { source: 'dependency-analyzer', basis: 'heuristic', evidenceRefs, generatedAt: new Date().toISOString() };
}

export interface DependencyAnalysisResult {
  recommendations: AiRecommendation[];
  annotations: AiGraphAnnotation[];
}

export function analyzeDependencies(steps: ApiTestStep[], collectionId: string): DependencyAnalysisResult {
  const recommendations: AiRecommendation[] = [];
  const annotations: AiGraphAnnotation[] = [];
  const stepIds = new Set(steps.map(s => s.id));

  // Fan-in map: how many other steps depend on each step
  const fanIn: Record<string, number> = {};
  for (const step of steps) {
    for (const dep of (step.dependsOn ?? [])) {
      fanIn[dep] = (fanIn[dep] ?? 0) + 1;
    }
  }

  // Orphan dependsOn reference
  for (const step of steps) {
    for (const dep of (step.dependsOn ?? [])) {
      if (!stepIds.has(dep)) {
        recommendations.push({
          id: nanoid(8),
          category: 'dependency',
          severity: 'warning',
          title: `Step "${step.name}" has stale dependency reference`,
          detail: `dependsOn entry "${dep}" does not match any step id in this collection. It is silently ignored at runtime but indicates a stale or copy-paste reference.`,
          confidence: 95,
          actionHint: 'Remove or correct the stale dependsOn entry.',
          provenance: provenance([step.id, dep]),
          collectionId,
          stepId: step.id,
        });
      }
    }
  }

  // Bottleneck: step depended on by 3+ others
  for (const [stepId, count] of Object.entries(fanIn)) {
    if (count >= 3) {
      const step = steps.find(s => s.id === stepId);
      if (!step) continue;
      recommendations.push({
        id: nanoid(8),
        category: 'dependency',
        severity: 'warning',
        title: `Step "${step.name}" is a dependency bottleneck (${count} dependents)`,
        detail: `${count} other steps depend on this step. A single failure here causes all dependents to be skipped. Consider splitting setup responsibilities to reduce blast radius.`,
        confidence: 80,
        actionHint: 'Break this step into smaller independent setup steps, or use onFailure: "continue" on dependents that can safely proceed.',
        provenance: provenance([stepId]),
        collectionId,
        stepId,
      });
      annotations.push({
        nodeId: stepId,
        stepId,
        badges: [{ type: 'unstable-dependency', label: `${count} dependents`, confidence: 80, detail: `Bottleneck: ${count} steps depend on this node` }],
      });
    }
  }

  // Missing teardown
  const hasTeardown = steps.some(s => s.execution?.teardown === true);
  if (!hasTeardown && steps.length > 2) {
    recommendations.push({
      id: nanoid(8),
      category: 'workflow-quality',
      severity: 'info',
      title: 'No teardown steps defined in this collection',
      detail: 'Without teardown steps, each run may accumulate server-side state (created records, auth sessions). This causes assertion drift in later runs as state builds up.',
      confidence: 65,
      actionHint: 'Add cleanup steps (e.g. DELETE /resource/{id}) and mark them with execution.teardown = true.',
      provenance: provenance([collectionId]),
      collectionId,
    });
  }

  return { recommendations, annotations };
}
```

- [ ] **Step 2: Build to verify types**

```
npm run build 2>&1 | grep -E "error TS|api-intelligence"
```
Expected: no TS errors in api-intelligence files

- [ ] **Step 3: Commit**

```
git add src/api-intelligence/engines/dependency-analyzer.ts
git commit -m "feat(ai-intelligence): add dependency analyzer engine"
```

---

## Task 3: Retry Intelligence + Flakiness Insights Engines

**Files:**
- Create: `src/api-intelligence/engines/retry-intelligence.ts`
- Create: `src/api-intelligence/engines/flakiness-insights.ts`
- Test: `src/api-intelligence/__tests__/retry-intelligence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api-intelligence/__tests__/retry-intelligence.test.ts
import { analyzeRetryIntelligence } from '../engines/retry-intelligence';
import type { ApiTestStep, ApiCollectionRunResult } from '../../data/types';

function makeStep(overrides: Partial<ApiTestStep> = {}): ApiTestStep {
  return {
    id: 'step-1',
    name: 'Get User',
    request: { method: 'GET', url: '/users/1' },
    assertions: [],
    extractVariables: [],
    dependsOn: [],
    execution: {},
    ...overrides,
  } as ApiTestStep;
}

describe('analyzeRetryIntelligence', () => {
  it('flags teardown step with retries configured', () => {
    const steps = [makeStep({ id: 's1', name: 'Cleanup', execution: { teardown: true, retryPolicy: { maxRetries: 2, delayMs: 500 } } })];
    const { recommendations } = analyzeRetryIntelligence(steps, [], 'col-1');
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].severity).toBe('warning');
    expect(recommendations[0].category).toBe('retry');
    expect(recommendations[0].stepId).toBe('s1');
  });

  it('flags step with maxRetries > 2 and no assertions', () => {
    const steps = [makeStep({ id: 's2', name: 'Poll', assertions: [], execution: { retryPolicy: { maxRetries: 5, delayMs: 1000 } } })];
    const { recommendations } = analyzeRetryIntelligence(steps, [], 'col-1');
    expect(recommendations.some(r => r.category === 'retry' && r.stepId === 's2')).toBe(true);
  });

  it('returns no annotations for steps with no retry policy', () => {
    const steps = [makeStep({ id: 's3', execution: {} })];
    const { annotations } = analyzeRetryIntelligence(steps, [], 'col-1');
    expect(annotations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
npx jest src/api-intelligence/__tests__/retry-intelligence.test.ts --no-coverage
```
Expected: FAIL — module not found

- [ ] **Step 3: Create retry-intelligence.ts**

```typescript
// src/api-intelligence/engines/retry-intelligence.ts

import { nanoid } from 'nanoid';
import { ApiTestStep, ApiCollectionRunResult } from '../../data/types';
import { AiRecommendation, RecommendationProvenance } from '../contracts/recommendation.contracts';
import { AiGraphAnnotation } from '../contracts/graph-overlay-ai.contracts';

function provenance(evidenceRefs: string[]): RecommendationProvenance {
  return { source: 'retry-intelligence', basis: 'deterministic', evidenceRefs, generatedAt: new Date().toISOString() };
}

export interface RetryAnalysisResult {
  recommendations: AiRecommendation[];
  annotations: AiGraphAnnotation[];
}

export function analyzeRetryIntelligence(
  steps: ApiTestStep[],
  _runs: ApiCollectionRunResult[],
  collectionId: string,
): RetryAnalysisResult {
  const recommendations: AiRecommendation[] = [];
  const annotations: AiGraphAnnotation[] = [];

  for (const step of steps) {
    const maxRetries = step.execution?.retryPolicy?.maxRetries ?? 0;
    if (maxRetries === 0) continue;

    // Anti-pattern: teardown step with retries
    if (step.execution?.teardown === true) {
      recommendations.push({
        id: nanoid(8),
        category: 'retry',
        severity: 'warning',
        title: `Teardown step "${step.name}" has retries configured`,
        detail: `Teardown steps are cleanup operations and should not retry. Retrying a teardown can cause duplicate deletes or leave partially-cleaned state.`,
        confidence: 85,
        actionHint: 'Set retryPolicy.maxRetries = 0 for all teardown steps.',
        provenance: provenance([step.id]),
        collectionId,
        stepId: step.id,
      });
      annotations.push({
        nodeId: step.id,
        stepId: step.id,
        badges: [{ type: 'retry-hotspot', label: 'Teardown+retry', confidence: 85, detail: 'Teardown step should not retry' }],
      });
    }

    // Over-retry: maxRetries > 2 with no assertions (nothing to validate recovery)
    if (maxRetries > 2 && step.assertions.length === 0) {
      recommendations.push({
        id: nanoid(8),
        category: 'retry',
        severity: 'info',
        title: `Step "${step.name}" retries ${maxRetries}× but has no assertions`,
        detail: `Without assertions, retrying ${maxRetries} times provides no additional validation guarantee and significantly increases run duration on failure.`,
        confidence: 60,
        actionHint: `Reduce maxRetries to 1 or add status/body assertions to validate the retry outcome.`,
        provenance: provenance([step.id]),
        collectionId,
        stepId: step.id,
      });
      annotations.push({
        nodeId: step.id,
        stepId: step.id,
        badges: [{ type: 'optimization-hint', label: `${maxRetries}x retry, no assertions`, confidence: 60, detail: 'Consider reducing retries or adding assertions' }],
      });
    }
  }

  return { recommendations, annotations };
}
```

- [ ] **Step 4: Create flakiness-insights.ts**

```typescript
// src/api-intelligence/engines/flakiness-insights.ts

import { nanoid } from 'nanoid';
import { CollectionFlakinessReport } from '../../api-flakiness/contracts/flakiness.contracts';
import { AiRecommendation, RecommendationProvenance } from '../contracts/recommendation.contracts';
import { AiGraphAnnotation } from '../contracts/graph-overlay-ai.contracts';

function provenance(evidenceRefs: string[]): RecommendationProvenance {
  return { source: 'flakiness-insights', basis: 'deterministic', evidenceRefs, generatedAt: new Date().toISOString() };
}

const HIGH_FAIL_RATE = 0.4;
const ALTERNATION_STORM = 0.7;

export interface FlakinessInsightResult {
  recommendations: AiRecommendation[];
  annotations: AiGraphAnnotation[];
}

export function analyzeFlakinessInsights(report: CollectionFlakinessReport): FlakinessInsightResult {
  const recommendations: AiRecommendation[] = [];
  const annotations: AiGraphAnnotation[] = [];

  for (const record of report.stepRecords) {
    if (!record.isFlaky) continue;

    if (record.failRate >= HIGH_FAIL_RATE) {
      const sev = record.failRate >= 0.7 ? 'critical' : 'warning';
      recommendations.push({
        id: nanoid(8),
        category: 'flakiness',
        severity: sev,
        title: `Step "${record.stepName}" is highly flaky — ${Math.round(record.failRate * 100)}% fail rate`,
        detail: `Failed in ${record.failedRuns}/${record.totalRuns} runs. Dominant failure category: ${record.dominantSignature?.category ?? 'unknown'}. Last failed: ${record.lastFailedAt ?? 'unknown'}.`,
        confidence: 90,
        actionHint: 'Review response contract, environment stability, and retry configuration for this step.',
        provenance: provenance([record.stepId]),
        collectionId: report.collectionId,
        stepId: record.stepId,
      });
      annotations.push({
        nodeId: record.stepId,
        stepId: record.stepId,
        badges: [{ type: 'unstable-dependency', label: `${Math.round(record.failRate * 100)}% fail`, confidence: 90, detail: `High flakiness: ${record.failedRuns}/${record.totalRuns}` }],
      });
    }

    if (record.alternationIndex >= ALTERNATION_STORM) {
      recommendations.push({
        id: nanoid(8),
        category: 'flakiness',
        severity: 'warning',
        title: `Step "${record.stepName}" alternates pass/fail (alternation ${record.alternationIndex.toFixed(2)})`,
        detail: 'This step passes and fails on alternating runs, indicating timing or environment-state sensitivity rather than a stable bug.',
        confidence: 75,
        actionHint: 'Add execution.delayAfterMs to stabilize timing, or verify that environment state resets cleanly between runs.',
        provenance: provenance([record.stepId]),
        collectionId: report.collectionId,
        stepId: record.stepId,
      });
    }

    if (record.dominantSignature?.category === 'dependency_propagation') {
      const upstreamId = record.dominantSignature.propagatedFromStepId ?? 'unknown';
      recommendations.push({
        id: nanoid(8),
        category: 'dependency',
        severity: 'warning',
        title: `Step "${record.stepName}" fails due to upstream cascade from "${upstreamId}"`,
        detail: `Most failures originate from an upstream step failure propagating to this step. Fixing the upstream step should resolve this flakiness.`,
        confidence: 85,
        actionHint: `Investigate step "${upstreamId}" first. Consider onFailure: "continue" if this step can proceed independently.`,
        provenance: provenance([record.stepId, upstreamId]),
        collectionId: report.collectionId,
        stepId: record.stepId,
      });
    }
  }

  // Collection-level stability warning
  if (report.stabilityScore < 0.6 && report.runsAnalyzed >= 5) {
    recommendations.push({
      id: nanoid(8),
      category: 'workflow-quality',
      severity: 'critical',
      title: `Collection stability is ${Math.round(report.stabilityScore * 100)}% — below threshold`,
      detail: `${report.hotspots.length} hotspot steps across ${report.runsAnalyzed} runs analyzed. Overall quality is significantly degraded.`,
      confidence: 92,
      actionHint: 'Address hotspot steps in priority order before adding new steps to this collection.',
      provenance: provenance([report.collectionId]),
      collectionId: report.collectionId,
    });
  }

  return { recommendations, annotations };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx jest src/api-intelligence/__tests__/retry-intelligence.test.ts --no-coverage
```
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```
git add src/api-intelligence/engines/retry-intelligence.ts src/api-intelligence/engines/flakiness-insights.ts src/api-intelligence/__tests__/retry-intelligence.test.ts
git commit -m "feat(ai-intelligence): add retry intelligence and flakiness insights engines"
```

---

## Task 4: RCA Hint Engine

**Files:**
- Create: `src/api-intelligence/engines/rca-hint-engine.ts`
- Test: `src/api-intelligence/__tests__/rca-hint-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api-intelligence/__tests__/rca-hint-engine.test.ts
import { generateRcaHints } from '../engines/rca-hint-engine';
import type { ReplaySession, ReplayEvent } from '../../api-observability/contracts/replay-event.contracts';

function makeSession(events: Partial<ReplayEvent>[]): ReplaySession {
  const full = events.map((e, i) => ({
    seq: i + 1,
    kind: e.kind ?? 'step-completed',
    stepId: e.stepId ?? `step-${i}`,
    stepName: e.stepName ?? `Step ${i}`,
    timestamp: '2026-01-01T00:00:00Z',
    ...e,
  })) as ReplayEvent[];
  return {
    runId: 'run-test-1',
    collectionId: 'col-1',
    synthesizedAt: '2026-01-01T00:00:00Z',
    _schemaVersion: 1,
    events: full,
    eventCount: full.length,
    stats: { requestsSent: 1, assertionsPassed: 0, assertionsFailed: 1, retriesTriggered: 0, teardownEvents: 0, failuresPropagated: 0 },
  };
}

describe('generateRcaHints', () => {
  it('returns empty hints for a clean session', () => {
    const session = makeSession([{ kind: 'step-completed', stepId: 's1', stepName: 'Get' }]);
    const bundle = generateRcaHints(session);
    expect(bundle.hints).toHaveLength(0);
    expect(bundle.advisoryNote).toBeTruthy();
  });

  it('generates assertion failure hint', () => {
    const session = makeSession([
      { kind: 'request-sent', stepId: 's1', stepName: 'Get User', response: { status: 404, durationMs: 100, bodyTruncated: false, headerKeys: [] } },
      { kind: 'assertion-evaluated', stepId: 's1', stepName: 'Get User', assertion: { type: 'statusCode', passed: false, message: 'expected 200 got 404' } },
    ]);
    const bundle = generateRcaHints(session);
    expect(bundle.hints.some(h => h.title.includes('Assertion failure'))).toBe(true);
    expect(bundle.hints[0].basis).toBe('replay-evidence');
  });

  it('generates propagation cascade hint', () => {
    const session = makeSession([
      { kind: 'failure-propagated', stepId: 's1', stepName: 'Create Order', failure: { reason: 'step failed', propagatedToStepIds: ['s2', 's3'] } },
    ]);
    const bundle = generateRcaHints(session);
    expect(bundle.hints.some(h => h.title.includes('cascade'))).toBe(true);
  });

  it('generates skip cascade hint when 3+ steps skipped', () => {
    const session = makeSession([
      { kind: 'step-skipped', stepId: 's2', stepName: 'Step 2', skipReason: 'dependency failed' },
      { kind: 'step-skipped', stepId: 's3', stepName: 'Step 3', skipReason: 'dependency failed' },
      { kind: 'step-skipped', stepId: 's4', stepName: 'Step 4', skipReason: 'dependency failed' },
    ]);
    const bundle = generateRcaHints(session);
    expect(bundle.hints.some(h => h.title.includes('skipped'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
npx jest src/api-intelligence/__tests__/rca-hint-engine.test.ts --no-coverage
```
Expected: FAIL — module not found

- [ ] **Step 3: Create rca-hint-engine.ts**

```typescript
// src/api-intelligence/engines/rca-hint-engine.ts

import { nanoid } from 'nanoid';
import { ReplaySession } from '../../api-observability/contracts/replay-event.contracts';
import { RcaHint, RcaHintBundle } from '../contracts/rca-hints.contracts';

const ADVISORY = 'AI RCA hints are advisory only — heuristic suggestions based on replay event analysis. They do not alter execution.';

export function generateRcaHints(session: ReplaySession): RcaHintBundle {
  const hints: RcaHint[] = [];
  const events = [...session.events];

  // Hint: First assertion failure
  const firstAssertionFail = events.find(e => e.kind === 'assertion-evaluated' && e.assertion?.passed === false);
  if (firstAssertionFail) {
    const priorRequest = [...events]
      .slice(0, firstAssertionFail.seq - 1)
      .reverse()
      .find(e => e.kind === 'request-sent' && e.stepId === firstAssertionFail.stepId);
    hints.push({
      id: nanoid(8),
      runId: session.runId,
      stepId: firstAssertionFail.stepId,
      stepName: firstAssertionFail.stepName,
      title: `Assertion failure on step "${firstAssertionFail.stepName}"`,
      probableCause: [
        `Assertion "${firstAssertionFail.assertion?.type}" failed.`,
        firstAssertionFail.assertion?.message ?? '',
        priorRequest?.response?.status ? `Response status: ${priorRequest.response.status}.` : '',
      ].filter(Boolean).join(' '),
      confidence: 80,
      basis: 'replay-evidence',
      evidences: [
        { type: 'replay', ref: `seq:${firstAssertionFail.seq}`, detail: 'Assertion evaluated — failed' },
        ...(priorRequest ? [{ type: 'replay' as const, ref: `seq:${priorRequest.seq}`, detail: `Request sent: ${priorRequest.request?.method} ${priorRequest.request?.url}` }] : []),
      ],
      generatedAt: new Date().toISOString(),
    });
  }

  // Hint: Failure propagation cascade
  const propagationEvents = events.filter(e => e.kind === 'failure-propagated');
  if (propagationEvents.length > 0) {
    const root = propagationEvents[0];
    const affectedCount = root.failure?.propagatedToStepIds?.length ?? 0;
    hints.push({
      id: nanoid(8),
      runId: session.runId,
      stepId: root.stepId,
      stepName: root.stepName,
      title: `Failure cascade from step "${root.stepName}" — ${affectedCount} dependent(s) affected`,
      probableCause: `Step "${root.stepName}" failed (${root.failure?.reason ?? 'unknown reason'}) and caused ${affectedCount} dependent step(s) to skip: ${(root.failure?.propagatedToStepIds ?? []).join(', ')}.`,
      confidence: 90,
      basis: 'replay-evidence',
      evidences: [
        { type: 'replay', ref: `seq:${root.seq}`, detail: 'Failure propagated' },
        ...(root.failure?.propagatedToStepIds ?? []).map(sid => ({ type: 'replay' as const, ref: sid, detail: 'Affected dependent step' })),
      ],
      generatedAt: new Date().toISOString(),
    });
  }

  // Hint: Retry hotspot — step with the most retry events
  const retryEvents = events.filter(e => e.kind === 'retry-triggered');
  if (retryEvents.length > 0) {
    const retryByStep: Record<string, number> = {};
    for (const e of retryEvents) retryByStep[e.stepId] = (retryByStep[e.stepId] ?? 0) + 1;
    const [topStepId, retryCount] = Object.entries(retryByStep).sort(([, a], [, b]) => b - a)[0];
    const topEvent = retryEvents.find(e => e.stepId === topStepId)!;
    hints.push({
      id: nanoid(8),
      runId: session.runId,
      stepId: topStepId,
      stepName: topEvent.stepName,
      title: `Step "${topEvent.stepName}" required ${retryCount} retry attempt(s)`,
      probableCause: [
        `This step triggered ${retryCount} retries.`,
        topEvent.retry?.triggerError ? `Trigger error: ${topEvent.retry.triggerError}.` : '',
        topEvent.retry?.triggerStatus ? `Trigger status: ${topEvent.retry.triggerStatus}.` : '',
        'Repeated retries suggest network instability, slow endpoints, or assertion fragility.',
      ].filter(Boolean).join(' '),
      confidence: 70,
      basis: 'replay-evidence',
      evidences: retryEvents
        .filter(e => e.stepId === topStepId)
        .map(e => ({ type: 'replay' as const, ref: `seq:${e.seq}`, detail: `Retry attempt ${e.retry?.attempt ?? '?'} of ${e.retry?.maxRetries ?? '?'}` })),
      generatedAt: new Date().toISOString(),
    });
  }

  // Hint: Skip cascade — many steps skipped
  const skippedEvents = events.filter(e => e.kind === 'step-skipped');
  if (skippedEvents.length > 2) {
    hints.push({
      id: nanoid(8),
      runId: session.runId,
      title: `${skippedEvents.length} steps were skipped — likely dependency cascade`,
      probableCause: `${skippedEvents.length} steps were skipped, which typically means one or more upstream steps failed and their dependents were cascaded into skip state.`,
      confidence: 75,
      basis: 'replay-evidence',
      evidences: skippedEvents.slice(0, 4).map(e => ({
        type: 'replay' as const,
        ref: `seq:${e.seq}`,
        detail: `"${e.stepName}" skipped: ${e.skipReason ?? 'dependency failed'}`,
      })),
      generatedAt: new Date().toISOString(),
    });
  }

  return { runId: session.runId, generatedAt: new Date().toISOString(), hints, advisoryNote: ADVISORY };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest src/api-intelligence/__tests__/rca-hint-engine.test.ts --no-coverage
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```
git add src/api-intelligence/engines/rca-hint-engine.ts src/api-intelligence/__tests__/rca-hint-engine.test.ts
git commit -m "feat(ai-intelligence): add replay-assisted RCA hint engine"
```

---

## Task 5: Workflow Quality Analyzer

**Files:**
- Create: `src/api-intelligence/engines/workflow-quality-analyzer.ts`

- [ ] **Step 1: Create workflow-quality-analyzer.ts**

```typescript
// src/api-intelligence/engines/workflow-quality-analyzer.ts

import { nanoid } from 'nanoid';
import { ApiCollection, ApiCollectionRunResult } from '../../data/types';
import { AiRecommendation, RecommendationProvenance } from '../contracts/recommendation.contracts';

function provenance(evidenceRefs: string[]): RecommendationProvenance {
  return { source: 'workflow-quality-analyzer', basis: 'heuristic', evidenceRefs, generatedAt: new Date().toISOString() };
}

export interface WorkflowQualityScore {
  collectionId: string;
  overallScore: number;        // 0–100 weighted composite
  assertionCoverage: number;   // 0–1 fraction of steps with assertions
  teardownCoverage: number;    // 0–1 fraction of steps that are teardown
  recentPassRate: number;      // 0–1 across last N runs
  computedAt: string;
}

export interface WorkflowQualityResult {
  score: WorkflowQualityScore;
  recommendations: AiRecommendation[];
}

export function analyzeWorkflowQuality(
  collection: ApiCollection,
  recentRuns: ApiCollectionRunResult[],
): WorkflowQualityResult {
  const recommendations: AiRecommendation[] = [];
  const steps = collection.steps;

  const teardownSteps = steps.filter(s => s.execution?.teardown === true).length;
  const stepsWithAssertions = steps.filter(s => s.assertions.length > 0).length;

  const assertionCoverage = steps.length > 0 ? stepsWithAssertions / steps.length : 1;
  const teardownCoverage = steps.length > 0 ? teardownSteps / steps.length : 0;
  const recentPassRate = recentRuns.length === 0
    ? 1
    : recentRuns.filter(r => r.status === 'passed').length / recentRuns.length;

  // Weighted score: assertions 35%, pass rate 40%, teardown presence 25%
  const overallScore = Math.round(
    assertionCoverage * 35 + recentPassRate * 40 + (teardownCoverage > 0 ? 1 : 0) * 25
  );

  if (assertionCoverage < 0.5) {
    recommendations.push({
      id: nanoid(8),
      category: 'assertion',
      severity: 'warning',
      title: `Only ${Math.round(assertionCoverage * 100)}% of steps have assertions`,
      detail: `${stepsWithAssertions}/${steps.length} steps validate responses. Steps without assertions are pass-through — failures in response contracts go undetected.`,
      confidence: 85,
      actionHint: 'Add status code or key response field assertions to steps that currently have none.',
      provenance: provenance([collection.id]),
      collectionId: collection.id,
    });
  }

  if (teardownCoverage === 0 && steps.length > 3) {
    recommendations.push({
      id: nanoid(8),
      category: 'workflow-quality',
      severity: 'info',
      title: 'No teardown steps — collection accumulates server-side state',
      detail: 'Without teardown, each run may leave behind created resources. Over multiple runs this causes assertion drift (e.g. duplicate name conflicts, quota exhaustion).',
      confidence: 70,
      actionHint: 'Add DELETE/cleanup steps and mark them execution.teardown = true so the engine guarantees they run even on failure.',
      provenance: provenance([collection.id]),
      collectionId: collection.id,
    });
  }

  if (recentPassRate < 0.5 && recentRuns.length >= 5) {
    recommendations.push({
      id: nanoid(8),
      category: 'workflow-quality',
      severity: 'critical',
      title: `Pass rate is ${Math.round(recentPassRate * 100)}% across last ${recentRuns.length} runs`,
      detail: 'More than half of recent runs failed. This indicates a systemic issue: API contract change, broken setup step, or environment drift.',
      confidence: 95,
      actionHint: 'Open the replay session for the most recent failure and review RCA hints before making any other changes.',
      provenance: provenance([collection.id, ...recentRuns.slice(0, 3).map(r => r.id)]),
      collectionId: collection.id,
    });
  }

  const score: WorkflowQualityScore = {
    collectionId: collection.id,
    overallScore,
    assertionCoverage,
    teardownCoverage,
    recentPassRate,
    computedAt: new Date().toISOString(),
  };

  return { score, recommendations };
}
```

- [ ] **Step 2: Build to verify types**

```
npm run build 2>&1 | grep -E "error TS|api-intelligence"
```
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/api-intelligence/engines/workflow-quality-analyzer.ts
git commit -m "feat(ai-intelligence): add workflow quality analyzer engine"
```

---

## Task 6: Recommendation Service + Audit Action Extension

**Files:**
- Create: `src/api-intelligence/recommendation-service.ts`
- Test: `src/api-intelligence/__tests__/recommendation-service.test.ts`
- Modify: `src/api-governance/audit.contracts.ts`

- [ ] **Step 1: Extend ApiAuditAction in audit.contracts.ts**

Read `src/api-governance/audit.contracts.ts` first, then add two new actions to the union:

```typescript
// OLD: (last line of ApiAuditAction union)
//   | 'api:variable:accessed';
export type ApiAuditAction =
  | 'api:collection:execute'
  | 'api:collection:view'
  | 'api:replay:access'
  | 'api:graph:access'
  | 'api:defect:filed'
  | 'api:healing:applied'
  | 'api:suite:execute'
  | 'api:teardown:execute'
  | 'api:environment:accessed'
  | 'api:variable:accessed'
  | 'api:intelligence:recommendations:generated'
  | 'api:intelligence:rca:accessed';
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/api-intelligence/__tests__/recommendation-service.test.ts
import { buildRecommendationBundle } from '../recommendation-service';
import type { ApiCollection, ApiCollectionRunResult } from '../../data/types';

function makeCollection(overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'col-1',
    name: 'Test Collection',
    environmentId: 'env-1',
    steps: [
      {
        id: 's1', name: 'Create', request: { method: 'POST', url: '/items' },
        assertions: [{ field: 'status', operator: 'eq', expected: 201 }],
        extractVariables: [], dependsOn: [], execution: {},
      } as any,
      {
        id: 's2', name: 'Get', request: { method: 'GET', url: '/items/1' },
        assertions: [], extractVariables: [], dependsOn: ['s1'], execution: {},
      } as any,
    ],
    variables: [],
    onFailure: 'stop',
    executionMode: 'sequential',
    ...overrides,
  };
}

describe('buildRecommendationBundle', () => {
  it('returns a bundle with advisory note', () => {
    const bundle = buildRecommendationBundle({ collection: makeCollection(), recentRuns: [], flakinessReport: null });
    expect(bundle.advisoryNote).toBeTruthy();
    expect(bundle.collectionId).toBe('col-1');
  });

  it('recommendations sorted critical > warning > info', () => {
    const col = makeCollection({
      steps: Array.from({ length: 4 }, (_, i) => ({
        id: `s${i}`, name: `Step ${i}`,
        request: { method: 'GET', url: '/x' },
        assertions: [], extractVariables: [], dependsOn: i > 0 ? ['s0'] : [],
        execution: {},
      })) as any,
    });
    // s0 is depended on by s1, s2, s3 → bottleneck (warning)
    const bundle = buildRecommendationBundle({ collection: col, recentRuns: [], flakinessReport: null });
    const severities = bundle.recommendations.map(r => r.severity);
    const order = { critical: 0, warning: 1, info: 2 };
    for (let i = 0; i < severities.length - 1; i++) {
      expect(order[severities[i]]).toBeLessThanOrEqual(order[severities[i + 1]]);
    }
  });

  it('accepts null flakinessReport without throwing', () => {
    expect(() => buildRecommendationBundle({
      collection: makeCollection(), recentRuns: [], flakinessReport: null,
    })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```
npx jest src/api-intelligence/__tests__/recommendation-service.test.ts --no-coverage
```
Expected: FAIL — module not found

- [ ] **Step 4: Create recommendation-service.ts**

```typescript
// src/api-intelligence/recommendation-service.ts
// Advisory-only orchestration layer. MUST NOT mutate collections, runtime, or WorkflowEnvelope.

import { Request } from 'express';
import { ApiCollection, ApiCollectionRunResult } from '../data/types';
import { CollectionFlakinessReport } from '../api-flakiness/contracts/flakiness.contracts';
import { logApiAudit } from '../api-governance/audit.helper';
import { getTenantContext } from '../api-governance/tenant.helper';
import { AiRecommendation, RecommendationBundle } from './contracts/recommendation.contracts';
import { AiGraphOverlayBundle } from './contracts/graph-overlay-ai.contracts';
import { analyzeDependencies } from './engines/dependency-analyzer';
import { analyzeRetryIntelligence } from './engines/retry-intelligence';
import { analyzeFlakinessInsights } from './engines/flakiness-insights';
import { analyzeWorkflowQuality } from './engines/workflow-quality-analyzer';

const ADVISORY = 'All recommendations are advisory only. AI must not alter runtime execution, retries, WorkflowEnvelope, or collections automatically.';
const SEV_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export interface RecommendationInput {
  collection: ApiCollection;
  recentRuns: ApiCollectionRunResult[];
  flakinessReport: CollectionFlakinessReport | null;
}

export function buildRecommendationBundle(input: RecommendationInput, req?: Request): RecommendationBundle {
  const tenantId = req ? getTenantContext(req)?.tenantId : undefined;
  const all: AiRecommendation[] = [];

  all.push(...analyzeDependencies(input.collection.steps, input.collection.id).recommendations);
  all.push(...analyzeRetryIntelligence(input.collection.steps, input.recentRuns, input.collection.id).recommendations);
  if (input.flakinessReport) {
    all.push(...analyzeFlakinessInsights(input.flakinessReport).recommendations);
  }
  all.push(...analyzeWorkflowQuality(input.collection, input.recentRuns).recommendations);

  const tenanted = all.map(r => ({ ...r, tenantId: tenantId ?? r.tenantId }));
  tenanted.sort((a, b) => {
    const diff = (SEV_ORDER[a.severity] ?? 2) - (SEV_ORDER[b.severity] ?? 2);
    return diff !== 0 ? diff : b.confidence - a.confidence;
  });

  if (req) {
    logApiAudit('api:intelligence:recommendations:generated', input.collection.id, req, {
      details: `${tenanted.length} recommendations`,
      tenantId,
    });
  }

  return { collectionId: input.collection.id, generatedAt: new Date().toISOString(), recommendations: tenanted, advisoryNote: ADVISORY };
}

export function buildGraphOverlayBundle(input: RecommendationInput, req?: Request): AiGraphOverlayBundle {
  const tenantId = req ? getTenantContext(req)?.tenantId : undefined;
  const annotations = [
    ...analyzeDependencies(input.collection.steps, input.collection.id).annotations,
    ...analyzeRetryIntelligence(input.collection.steps, input.recentRuns, input.collection.id).annotations,
    ...(input.flakinessReport ? analyzeFlakinessInsights(input.flakinessReport).annotations : []),
  ];
  return { collectionId: input.collection.id, generatedAt: new Date().toISOString(), annotations, advisoryNote: ADVISORY };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx jest src/api-intelligence/__tests__/recommendation-service.test.ts --no-coverage
```
Expected: PASS (3 tests)

- [ ] **Step 6: Run all api-intelligence tests**

```
npx jest src/api-intelligence/ --no-coverage
```
Expected: PASS (all tests across all 4 test files)

- [ ] **Step 7: Commit**

```
git add src/api-intelligence/recommendation-service.ts src/api-intelligence/__tests__/recommendation-service.test.ts src/api-governance/audit.contracts.ts
git commit -m "feat(ai-intelligence): add recommendation service + extend ApiAuditAction"
```

---

## Task 7: AI Intelligence Routes + Server Registration

**Files:**
- Create: `src/api-intelligence/routes/ai-intelligence.routes.ts`
- Modify: `src/ui/server.ts`

- [ ] **Step 1: Create ai-intelligence.routes.ts**

```typescript
// src/api-intelligence/routes/ai-intelligence.routes.ts

import { Router, Request, Response, Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { readAll } from '../../data/store';
import type { ApiCollection, ApiCollectionRunResult } from '../../data/types';
import { buildRecommendationBundle, buildGraphOverlayBundle } from '../recommendation-service';
import { generateRcaHints } from '../engines/rca-hint-engine';
import { logApiAudit } from '../../api-governance/audit.helper';
import { replayEventStore } from '../../api-observability/replay-event-store';

const router = Router();

// GET /api/ai-intelligence/collections/:collectionId/recommendations
router.get('/collections/:collectionId/recommendations', requireAuth, async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params;
    const collections = readAll<ApiCollection>('API_COLLECTIONS' as any);
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });

    const allRuns = readAll<ApiCollectionRunResult>('API_RUNS' as any);
    const recentRuns = allRuns
      .filter(r => r.collectionId === collectionId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 20);

    let flakinessReport = null;
    try {
      const { getFlakinessReport } = await import('../../api-flakiness/flakiness-service');
      flakinessReport = await getFlakinessReport(collectionId);
    } catch { /* graceful degrade — flakiness optional */ }

    const bundle = buildRecommendationBundle({ collection, recentRuns, flakinessReport }, req);
    res.json(bundle);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-intelligence/collections/:collectionId/graph-overlay
router.get('/collections/:collectionId/graph-overlay', requireAuth, async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params;
    const collections = readAll<ApiCollection>('API_COLLECTIONS' as any);
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });

    const allRuns = readAll<ApiCollectionRunResult>('API_RUNS' as any);
    const recentRuns = allRuns.filter(r => r.collectionId === collectionId).slice(0, 10);

    let flakinessReport = null;
    try {
      const { getFlakinessReport } = await import('../../api-flakiness/flakiness-service');
      flakinessReport = await getFlakinessReport(collectionId);
    } catch { /* graceful degrade */ }

    const bundle = buildGraphOverlayBundle({ collection, recentRuns, flakinessReport }, req);
    res.json(bundle);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-intelligence/runs/:runId/rca-hints
router.get('/runs/:runId/rca-hints', requireAuth, async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const session = await replayEventStore.loadReplaySession(runId);
    if (!session) {
      return res.status(404).json({ error: 'No replay session found for this run. Run the collection first to generate replay data.' });
    }
    logApiAudit('api:intelligence:rca:accessed', runId, req);
    const bundle = generateRcaHints(session);
    res.json(bundle);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function registerAiIntelligenceRoutes(app: Express): void {
  app.use('/api/ai-intelligence', router);
}
```

- [ ] **Step 2: Read server.ts to find the right place to add the import**

Read `src/ui/server.ts` lines 1–60 to confirm the import block location.

- [ ] **Step 3: Add import to server.ts**

In `src/ui/server.ts`, add after the `import governanceRouter from '../api-governance/routes/governance.routes';` line:

```typescript
import { registerAiIntelligenceRoutes } from '../api-intelligence/routes/ai-intelligence.routes';
```

- [ ] **Step 4: Register the routes in server.ts**

Find the line `app.use('/api/governance', governanceRouter);` (or wherever governance is registered) and add after it:

```typescript
registerAiIntelligenceRoutes(app);
```

- [ ] **Step 5: Build to verify no TS errors**

```
npm run build 2>&1 | grep -E "error TS"
```
Expected: no errors

- [ ] **Step 6: Commit**

```
git add src/api-intelligence/routes/ai-intelligence.routes.ts src/ui/server.ts
git commit -m "feat(ai-intelligence): add REST routes and register with Express server"
```

---

## Task 8: Runs UI AI Insights Panel + CSS + CLAUDE.md Checkpoint

**Files:**
- Modify: `src/ui/public/js/25-api-runs.js`
- Modify: `src/ui/public/styles_addon.css`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read 25-api-runs.js to find the run detail render function**

Read `src/ui/public/js/25-api-runs.js` and locate `apiRunsViewDetail` and the section that renders run detail tabs/panels.

- [ ] **Step 2: Add AI Insights panel function to 25-api-runs.js**

Add the following function near the end of the module (before any closing IIFE if present):

```javascript
// AI Insights panel — advisory recommendations and RCA hints for a run
async function _apiRunsRenderAiInsights(runId, collectionId, container) {
  container.innerHTML = '<div class="ai-insights-loading">Loading AI insights…</div>';
  try {
    const [recRes, rcaRes] = await Promise.all([
      fetch(`/api/ai-intelligence/collections/${encodeURIComponent(collectionId)}/recommendations`),
      fetch(`/api/ai-intelligence/runs/${encodeURIComponent(runId)}/rca-hints`),
    ]);

    const recBundle = recRes.ok ? await recRes.json() : null;
    const rcaBundle = rcaRes.ok ? await rcaRes.json() : null;

    let html = `<div class="ai-insights-advisory">⚠️ ${recBundle?.advisoryNote ?? 'AI recommendations are advisory only.'}</div>`;

    // RCA Hints section
    if (rcaBundle && rcaBundle.hints && rcaBundle.hints.length > 0) {
      html += '<div class="ai-insights-section"><h4>RCA Hints</h4><ul class="ai-hints-list">';
      for (const hint of rcaBundle.hints) {
        const conf = hint.confidence;
        const confClass = conf >= 85 ? 'ai-conf-high' : conf >= 65 ? 'ai-conf-med' : 'ai-conf-low';
        html += `<li class="ai-hint-item">
          <span class="ai-hint-title">${_escHtml(hint.title)}</span>
          <span class="ai-conf-badge ${confClass}">${conf}% confidence</span>
          <div class="ai-hint-cause">${_escHtml(hint.probableCause)}</div>
        </li>`;
      }
      html += '</ul></div>';
    } else if (rcaBundle) {
      html += '<div class="ai-insights-section"><h4>RCA Hints</h4><p class="ai-empty">No anomalies detected in replay events for this run.</p></div>';
    } else {
      html += '<div class="ai-insights-section"><h4>RCA Hints</h4><p class="ai-empty">No replay session available for this run. Execute the collection to generate replay data.</p></div>';
    }

    // Recommendations section
    if (recBundle && recBundle.recommendations && recBundle.recommendations.length > 0) {
      html += '<div class="ai-insights-section"><h4>Collection Recommendations</h4><ul class="ai-rec-list">';
      for (const rec of recBundle.recommendations) {
        const sevClass = { critical: 'ai-sev-critical', warning: 'ai-sev-warning', info: 'ai-sev-info' }[rec.severity] || 'ai-sev-info';
        html += `<li class="ai-rec-item ${sevClass}">
          <div class="ai-rec-header">
            <span class="ai-sev-badge">${rec.severity.toUpperCase()}</span>
            <span class="ai-rec-title">${_escHtml(rec.title)}</span>
            <span class="ai-conf-badge">${rec.confidence}%</span>
          </div>
          <div class="ai-rec-detail">${_escHtml(rec.detail)}</div>
          <div class="ai-rec-action"><strong>Action:</strong> ${_escHtml(rec.actionHint)}</div>
        </li>`;
      }
      html += '</ul></div>';
    } else if (recBundle) {
      html += '<div class="ai-insights-section"><h4>Collection Recommendations</h4><p class="ai-empty">No recommendations — collection looks healthy.</p></div>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="ai-insights-error">Failed to load AI insights: ${_escHtml(String(err))}</div>`;
  }
}

function _escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

- [ ] **Step 3: Add AI Insights tab to the run detail view in apiRunsViewDetail**

Locate the function `apiRunsViewDetail` (or `_apiRunsRenderDetail`) and find where detail tabs are built. Add an "AI Insights" tab button and panel. The exact insertion point depends on current markup; append to the tab bar and add a panel:

In the section that builds run-detail tab HTML, add the tab trigger:
```javascript
<button class="run-tab-btn" data-tab="ai-insights" onclick="_apiRunsShowTab(this, 'ai-insights-panel')">AI Insights</button>
```

And the corresponding panel div (initially hidden):
```javascript
<div id="ai-insights-panel-${runId}" class="run-tab-panel" style="display:none;">
  <!-- populated by _apiRunsRenderAiInsights on tab activation -->
</div>
```

In the tab activation handler (`_apiRunsShowTab` or equivalent), when tab `ai-insights` becomes active, trigger:
```javascript
if (tab === 'ai-insights') {
  const container = document.getElementById(`ai-insights-panel-${currentRunId}`);
  if (container && !container.dataset.loaded) {
    container.dataset.loaded = '1';
    _apiRunsRenderAiInsights(currentRunId, _apiRunsCollectionId, container);
  }
}
```

- [ ] **Step 4: Add AI Insights CSS to styles_addon.css**

Read `src/ui/public/styles_addon.css` first, then append at the end:

```css
/* ── AI Insights Panel ────────────────────────────────────────── */
.ai-insights-advisory {
  background: #fffbeb;
  border: 1px solid #f59e0b;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #92400e;
  margin-bottom: 12px;
}
.ai-insights-loading { color: #6b7280; font-size: 13px; padding: 16px; }
.ai-insights-error { color: #dc2626; font-size: 13px; padding: 12px; }
.ai-insights-section { margin-bottom: 18px; }
.ai-insights-section h4 { font-size: 13px; font-weight: 600; color: #374151; margin: 0 0 8px 0; }
.ai-empty { font-size: 12px; color: #9ca3af; font-style: italic; }

/* RCA Hints */
.ai-hints-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.ai-hint-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
.ai-hint-title { font-size: 12px; font-weight: 600; color: #1e293b; }
.ai-hint-cause { font-size: 11px; color: #475569; margin-top: 4px; line-height: 1.4; }

/* Recommendations */
.ai-rec-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.ai-rec-item { border-radius: 6px; padding: 10px 12px; border-left: 4px solid #e5e7eb; background: #f9fafb; }
.ai-rec-item.ai-sev-critical { border-left-color: #dc2626; background: #fff5f5; }
.ai-rec-item.ai-sev-warning  { border-left-color: #f59e0b; background: #fffdf5; }
.ai-rec-item.ai-sev-info     { border-left-color: #3b82f6; background: #f0f9ff; }
.ai-rec-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.ai-rec-title { font-size: 12px; font-weight: 600; color: #1f2937; }
.ai-rec-detail { font-size: 11px; color: #4b5563; line-height: 1.4; }
.ai-rec-action { font-size: 11px; color: #374151; margin-top: 4px; }

/* Severity & confidence badges */
.ai-sev-badge {
  font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
  padding: 1px 5px; border-radius: 3px; text-transform: uppercase;
  background: #e5e7eb; color: #374151;
}
.ai-sev-critical .ai-sev-badge { background: #fee2e2; color: #dc2626; }
.ai-sev-warning  .ai-sev-badge { background: #fef3c7; color: #b45309; }
.ai-sev-info     .ai-sev-badge { background: #dbeafe; color: #1d4ed8; }
.ai-conf-badge { font-size: 10px; color: #6b7280; padding: 1px 4px; background: #f3f4f6; border-radius: 3px; }
.ai-conf-high { color: #059669; background: #d1fae5; }
.ai-conf-med  { color: #d97706; background: #fef3c7; }
.ai-conf-low  { color: #9ca3af; background: #f3f4f6; }
```

- [ ] **Step 5: Build frontend modules**

```
npm run build:js
```
Expected: modules.js regenerated with no errors

- [ ] **Step 6: Build TypeScript**

```
npm run build 2>&1 | grep "error TS"
```
Expected: no errors

- [ ] **Step 7: Update CLAUDE.md — Step 14 checkpoint**

In `CLAUDE.md`, add the following to the Shipped Features section and update the doc pointer table:

In the doc pointer table add:
```
> **📋 See [docs/superpowers/plans/2026-05-21-phase-d-step14-ai-workflow-intelligence.md](...) — Phase D Step 14 implementation plan (8 tasks). **COMPLETE as of 2026-05-21.**
```

In the Shipped Features section add:
```markdown
### AI-Assisted Workflow Intelligence (Phase D Step 14 — shipped 2026-05-21)
- Module: `src/api-intelligence/` — contracts, engines, recommendation-service, routes
- Engines: dependency-analyzer, retry-intelligence, flakiness-insights, rca-hint-engine, workflow-quality-analyzer
- All engines are pure functions (no DB/HTTP calls) — take data types, return AiRecommendation[] or RcaHint[]
- recommendation-service.ts: orchestrates all engines, sorts by severity+confidence, applies tenant context, audits via logApiAudit
- Routes: `GET /api/ai-intelligence/collections/:id/recommendations`, `/graph-overlay`, `/runs/:id/rca-hints`
- UI: "AI Insights" tab in run detail view (25-api-runs.js) — RCA hints + collection recommendations
- ADVISORY ONLY — AI must never mutate collections, runtime, WorkflowEnvelope, or retries
- Governance: ApiAuditAction extended with api:intelligence:recommendations:generated + api:intelligence:rca:accessed
- All recommendations include confidence score, provenance, basis (heuristic/deterministic/replay-evidence)
- Graceful degradation: flakinessReport=null and missing replay sessions handled without error
- Future extension points: RecommendationBasis='replay-evidence', RcaHint.evidences[], AiOverlayBadge for graph
```

- [ ] **Step 8: Commit everything**

```
git add src/ui/public/js/25-api-runs.js src/ui/public/styles_addon.css CLAUDE.md
git commit -m "feat(ai-intelligence): AI Insights UI panel, CSS, CLAUDE.md Step 14 checkpoint"
```

---

## Self-Review Against Spec

| Spec Requirement | Covered By |
|---|---|
| A. AI Recommendation Layer — all 7 categories | recommendation.contracts.ts (8 categories), all 5 engines |
| B. Workflow Intelligence Engine — graph quality, anti-patterns, retry storms, setup/teardown | dependency-analyzer, retry-intelligence, workflow-quality-analyzer |
| C. Replay-Assisted RCA Hints | rca-hint-engine.ts — 4 hint types from replay events |
| D. AI Graph Overlay — badges, unstable deps, optimization hints | graph-overlay-ai.contracts.ts, annotations returned by all engines |
| E. Runs UI Recommendation Panels | Task 8 — AI Insights tab in 25-api-runs.js |
| F. Governance & Audit Compatibility | logApiAudit in recommendation-service, new ApiAuditAction values |
| G. Deterministic Runtime Isolation | Engines are pure functions; no runtime imports; advisory note on all bundles |
| H. Recommendation Confidence Model | confidence: 0–100, basis field, RecommendationProvenance with evidenceRefs |
| I. Backward Compatibility | No existing types modified; all changes additive |
| J. Future Autonomous Orchestration Extension Points | RecommendationBundle.advisoryNote, RcaHint.evidences, AiOverlayBadge ready for future badge rendering in graph UI |
