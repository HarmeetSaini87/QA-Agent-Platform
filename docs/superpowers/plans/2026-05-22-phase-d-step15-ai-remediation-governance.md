# Phase D Step 15 — Enterprise AI Orchestration Governance, Controlled Automation Policies & Approval-Based Remediation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an approval-gated AI remediation workflow layer on top of the existing recommendation engine — proposals are generated from recommendations, persisted, and human-approved/rejected via RBAC-enforced REST endpoints and a UI panel, with full audit trail and zero runtime mutation.

**Architecture:** A new `src/api-remediation/` module provides pure-function proposal generation (recommendation → typed proposal + field-level diff), an atomic-write store for proposals and approval records, policy-governed RBAC checks, and a graph overlay augmentation helper. All proposals start as `pending-approval` and require explicit human decision; status transitions are audited via the existing `logApiAudit` pipeline. The AI Insights tab in 25-api-runs.js gains a Remediation Proposals section with approve/reject buttons.

**Tech Stack:** TypeScript · Express.js · Vitest · Vanilla JS · existing `logApiAudit` / `requirePermission` / `readAll` patterns from Phase D Steps 13–14.

---

## File Structure

**New — `src/api-remediation/`**

| File | Responsibility |
|------|---------------|
| `contracts/remediation-proposal.contracts.ts` | `RemediationProposal`, `RemediationProposalBundle`, `RemediationFieldChange` types |
| `contracts/approval-workflow.contracts.ts` | `ApprovalRequest`, `ApprovalsRegistry` types |
| `contracts/remediation-policy.contracts.ts` | `RemediationPolicy`, `RemediationPolicyCheckResult` types |
| `engines/proposal-diff.ts` | Pure fn: `buildDiff(rec, steps)` → `RemediationFieldChange[]` |
| `engines/proposal-engine.ts` | Pure fn: `buildRemediationProposals(recs, steps, collectionId)` → `RemediationProposalBundle` |
| `proposal-store.ts` | Atomic CRUD → `data/remediation-proposals.json` |
| `approval-store.ts` | Atomic CRUD → `data/remediation-approvals.json` |
| `remediation-policy-registry.ts` | `RemediationPolicyRegistry` + `globalRemediationPolicyRegistry` singleton |
| `graph-overlay-remediator.ts` | Pure fn: `annotateOverlayWithProposals(bundle, proposals)` → augmented overlay |
| `routes/remediation.routes.ts` | 5 REST routes, registers on `/api/remediation` |
| `__tests__/remediation.contracts.test.ts` | 4 contract shape tests |
| `__tests__/remediation-policy-registry.test.ts` | 3 policy registry tests |
| `__tests__/proposal-engine.test.ts` | 3 engine tests |
| `__tests__/approval-store.test.ts` | 4 store tests |
| `__tests__/graph-overlay-remediator.test.ts` | 3 overlay tests |

**Modified**

| File | Change |
|------|--------|
| `src/api-governance/rbac.contracts.ts` | Add `'api:propose-remediation'` + `'api:approve-remediation'` |
| `src/api-governance/audit.contracts.ts` | Add 3 audit actions |
| `src/api-intelligence/contracts/graph-overlay-ai.contracts.ts` | Extend `AiOverlayBadgeType` |
| `src/api-intelligence/routes/ai-intelligence.routes.ts` | graph-overlay route augments annotations with pending proposals |
| `src/ui/server.ts` | Register remediation routes |
| `src/ui/public/js/25-api-runs.js` | Remediation Proposals section in AI Insights tab |
| `src/ui/public/styles_addon.css` | Remediation proposal CSS |
| `CLAUDE.md` | Add Step 15 doc pointer + shipped features entry |

---

## Task 1: Remediation Proposal + Approval Contracts

**Files:**
- Create: `src/api-remediation/contracts/remediation-proposal.contracts.ts`
- Create: `src/api-remediation/contracts/approval-workflow.contracts.ts`
- Create: `src/api-remediation/__tests__/remediation.contracts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api-remediation/__tests__/remediation.contracts.test.ts
import { describe, it, expect } from 'vitest';
import type {
  RemediationProposal,
  RemediationProposalBundle,
  RemediationFieldChange,
} from '../contracts/remediation-proposal.contracts';
import type { ApprovalRequest, ApprovalsRegistry } from '../contracts/approval-workflow.contracts';

describe('remediation.contracts', () => {
  it('RemediationProposal has required advisory fields', () => {
    const proposal: RemediationProposal = {
      id: 'prop-1',
      collectionId: 'col-1',
      type: 'retry-tuning',
      title: 'Reduce retries',
      rationale: 'Over-retrying step',
      confidence: 85,
      diff: [],
      evidenceRefs: [],
      sourceRecommendationId: 'rec-1',
      basis: 'deterministic',
      status: 'pending-approval',
      createdAt: '2026-05-22T00:00:00Z',
      advisoryNote: 'AI advisory only',
    };
    expect(proposal.status).toBe('pending-approval');
    expect(proposal.advisoryNote).toBeTruthy();
    expect(proposal.confidence).toBeLessThanOrEqual(100);
  });

  it('RemediationFieldChange captures before/after/humanLabel', () => {
    const change: RemediationFieldChange = {
      field: 'execution.retryPolicy.maxRetries',
      before: 3,
      after: 2,
      humanLabel: "Max retries for 'GET /users'",
    };
    expect(change.field).toBe('execution.retryPolicy.maxRetries');
    expect(change.before).toBe(3);
    expect(change.after).toBe(2);
  });

  it('RemediationProposalBundle requires advisoryNote at wire level', () => {
    const bundle: RemediationProposalBundle = {
      collectionId: 'col-1',
      generatedAt: '2026-05-22T00:00:00Z',
      proposals: [],
      advisoryNote: 'Proposals are approval-gated.',
    };
    expect(bundle.advisoryNote).toBeTruthy();
    expect(Array.isArray(bundle.proposals)).toBe(true);
  });

  it('ApprovalsRegistry has schemaVersion 1', () => {
    const reg: ApprovalsRegistry = { _schemaVersion: 1, approvals: [] };
    expect(reg._schemaVersion).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-remediation/__tests__/remediation.contracts.test.ts
```
Expected: FAIL — cannot find module `'../contracts/remediation-proposal.contracts'`

- [ ] **Step 3: Create remediation-proposal.contracts.ts**

```typescript
// src/api-remediation/contracts/remediation-proposal.contracts.ts
import type { RecommendationBasis } from '../../api-intelligence/contracts/recommendation.contracts';

export type RemediationProposalType =
  | 'retry-tuning'
  | 'url-healing'
  | 'dependency-restructure'
  | 'assertion-repair'
  | 'flaky-stabilization'
  | 'environment-correction';

export type RemediationProposalStatus =
  | 'pending-approval'
  | 'approved'
  | 'rejected'
  | 'rolled-back';

export interface RemediationFieldChange {
  /** Dot-notation field path, e.g. "execution.retryPolicy.maxRetries" */
  field: string;
  before: unknown;
  after: unknown;
  humanLabel: string;
}

export interface RemediationProposal {
  id: string;
  collectionId: string;
  runId?: string;
  stepId?: string;
  stepName?: string;
  requestedBy?: string;
  type: RemediationProposalType;
  title: string;
  rationale: string;
  /** 0–100 inherited from source AiRecommendation */
  confidence: number;
  diff: RemediationFieldChange[];
  evidenceRefs: string[];
  sourceRecommendationId: string;
  basis: RecommendationBasis;
  status: RemediationProposalStatus;
  createdAt: string;
  tenantId?: string;
  /** Required — enforces advisory contract at wire format level */
  advisoryNote: string;
}

export interface RemediationProposalBundle {
  collectionId: string;
  runId?: string;
  generatedAt: string;
  proposals: RemediationProposal[];
  advisoryNote: string;
}
```

- [ ] **Step 4: Create approval-workflow.contracts.ts**

```typescript
// src/api-remediation/contracts/approval-workflow.contracts.ts

export type ApprovalDecision = 'approved' | 'rejected';

export interface ApprovalRequest {
  id: string;
  proposalId: string;
  collectionId: string;
  /** userId of whoever generated the proposals */
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'decided';
  decision?: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: string;
  /** Optional reviewer comment — required on rejection via UI prompt */
  reviewComment?: string;
  /** True when the proposal was in pending-approval state at decision time */
  rollbackEligible: boolean;
  tenantId?: string;
}

export interface ApprovalsRegistry {
  _schemaVersion: 1;
  approvals: ApprovalRequest[];
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/api-remediation/__tests__/remediation.contracts.test.ts
```
Expected: PASS — 4 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/api-remediation/contracts/remediation-proposal.contracts.ts \
        src/api-remediation/contracts/approval-workflow.contracts.ts \
        src/api-remediation/__tests__/remediation.contracts.test.ts
git commit -m "feat(remediation): add remediation proposal + approval contracts"
```

---

## Task 2: Remediation Policy + RBAC/Audit Extensions

**Files:**
- Create: `src/api-remediation/contracts/remediation-policy.contracts.ts`
- Create: `src/api-remediation/remediation-policy-registry.ts`
- Modify: `src/api-governance/rbac.contracts.ts`
- Modify: `src/api-governance/audit.contracts.ts`
- Create: `src/api-remediation/__tests__/remediation-policy-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api-remediation/__tests__/remediation-policy-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RemediationPolicyRegistry } from '../remediation-policy-registry';

describe('RemediationPolicyRegistry', () => {
  let registry: RemediationPolicyRegistry;

  beforeEach(() => { registry = new RemediationPolicyRegistry(); });

  it('empty registry allows propose for editor at any confidence', () => {
    const result = registry.checkPropose('editor', 80);
    expect(result.canPropose).toBe(true);
  });

  it('policy with confidenceThreshold blocks proposal when confidence is below threshold', () => {
    registry.register({
      policyId: 'p1',
      name: 'High Confidence Only',
      confidenceThreshold: 70,
      approverRoles: ['admin', 'editor'],
      restrictedEnvironmentIds: [],
      allowProposalGeneration: true,
      maxProposalsPerCollection: 10,
    });
    const result = registry.checkPropose('editor', 50);
    expect(result.canPropose).toBe(false);
    expect(result.reason).toContain('50');
    expect(result.reason).toContain('70');
  });

  it('policy with restrictedEnvironmentIds blocks proposal for that environment', () => {
    registry.register({
      policyId: 'p2',
      name: 'No Prod Remediation',
      confidenceThreshold: 0,
      approverRoles: ['admin'],
      restrictedEnvironmentIds: ['env-prod'],
      allowProposalGeneration: true,
      maxProposalsPerCollection: 10,
    });
    const result = registry.checkPropose('admin', 95, 'env-prod');
    expect(result.canPropose).toBe(false);
    expect(result.reason).toContain('env-prod');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/api-remediation/__tests__/remediation-policy-registry.test.ts
```
Expected: FAIL — cannot find module `'../remediation-policy-registry'`

- [ ] **Step 3: Create remediation-policy.contracts.ts**

```typescript
// src/api-remediation/contracts/remediation-policy.contracts.ts
import type { Role } from '../../data/types';

export interface RemediationPolicy {
  policyId: string;
  name: string;
  /** Proposals with confidence below this value are blocked from generation */
  confidenceThreshold: number;
  /** Roles permitted to approve/reject proposals */
  approverRoles: Role[];
  /** Environment IDs where remediation proposals are blocked */
  restrictedEnvironmentIds: string[];
  /** When false, POST /proposals returns 403 regardless of role */
  allowProposalGeneration: boolean;
  /** Guard against proposal spam per collection */
  maxProposalsPerCollection: number;
}

export interface RemediationPolicyCheckResult {
  canPropose: boolean;
  canApprove: boolean;
  reason?: string;
}
```

- [ ] **Step 4: Create remediation-policy-registry.ts**

```typescript
// src/api-remediation/remediation-policy-registry.ts
import type { Role } from '../data/types';
import type { RemediationPolicy, RemediationPolicyCheckResult } from './contracts/remediation-policy.contracts';

export class RemediationPolicyRegistry {
  private readonly policies = new Map<string, RemediationPolicy>();

  register(policy: RemediationPolicy): void {
    this.policies.set(policy.policyId, policy);
  }

  list(): RemediationPolicy[] {
    return Array.from(this.policies.values());
  }

  remove(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  checkPropose(role: Role, confidence: number, environmentId?: string): RemediationPolicyCheckResult {
    const all = this.list();
    if (all.length === 0) {
      return { canPropose: true, canApprove: role === 'admin' || role === 'editor' };
    }

    for (const policy of all) {
      if (!policy.allowProposalGeneration) {
        return { canPropose: false, canApprove: false, reason: `Policy '${policy.name}' disables proposal generation.` };
      }
      if (confidence < policy.confidenceThreshold) {
        return {
          canPropose: false,
          canApprove: false,
          reason: `Confidence ${confidence} is below threshold ${policy.confidenceThreshold} set by policy '${policy.name}'.`,
        };
      }
      if (environmentId && policy.restrictedEnvironmentIds.includes(environmentId)) {
        return {
          canPropose: false,
          canApprove: false,
          reason: `Policy '${policy.name}' restricts remediation in environment '${environmentId}'.`,
        };
      }
    }

    const canApprove = all.every(p => p.approverRoles.includes(role));
    return { canPropose: true, canApprove };
  }
}

export const globalRemediationPolicyRegistry = new RemediationPolicyRegistry();
```

- [ ] **Step 5: Extend rbac.contracts.ts — add 2 new permissions**

Read `src/api-governance/rbac.contracts.ts` first, then add to `ApiResourcePermission` union and `PERMISSION_ROLE_MAP`:

```typescript
// Add to ApiResourcePermission union (after 'api:view-audit'):
  | 'api:propose-remediation'
  | 'api:approve-remediation';

// Add to PERMISSION_ROLE_MAP object:
  'api:propose-remediation': ['admin', 'editor', 'tester'],
  'api:approve-remediation': ['admin', 'editor'],
```

- [ ] **Step 6: Extend audit.contracts.ts — add 3 audit actions**

Read `src/api-governance/audit.contracts.ts` first, then add to `ApiAuditAction` union:

```typescript
// Add after 'api:intelligence:rca:accessed':
  | 'api:remediation:proposed'
  | 'api:remediation:approved'
  | 'api:remediation:rejected'
```

- [ ] **Step 7: Run test to verify it passes**

```bash
npx vitest run src/api-remediation/__tests__/remediation-policy-registry.test.ts
```
Expected: PASS — 3 tests pass

- [ ] **Step 8: Commit**

```bash
git add src/api-remediation/contracts/remediation-policy.contracts.ts \
        src/api-remediation/remediation-policy-registry.ts \
        src/api-governance/rbac.contracts.ts \
        src/api-governance/audit.contracts.ts \
        src/api-remediation/__tests__/remediation-policy-registry.test.ts
git commit -m "feat(remediation): policy registry + RBAC/audit extensions"
```

---

## Task 3: Proposal Engine + Diff Visualization

**Files:**
- Create: `src/api-remediation/engines/proposal-diff.ts`
- Create: `src/api-remediation/engines/proposal-engine.ts`
- Create: `src/api-remediation/__tests__/proposal-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api-remediation/__tests__/proposal-engine.test.ts
import { describe, it, expect } from 'vitest';
import { buildRemediationProposals } from '../engines/proposal-engine';
import type { AiRecommendation } from '../../api-intelligence/contracts/recommendation.contracts';
import type { ApiTestStep } from '../../data/types';

function makeRec(overrides: Partial<AiRecommendation> = {}): AiRecommendation {
  return {
    id: 'rec-1',
    category: 'retry',
    severity: 'warning',
    title: 'Reduce retry count',
    detail: 'Step retries too aggressively.',
    confidence: 85,
    actionHint: 'Reduce maxRetries to 1',
    provenance: { source: 'retry-intelligence', basis: 'deterministic', evidenceRefs: ['step-1'], generatedAt: '2026-05-22T00:00:00Z' },
    collectionId: 'col-1',
    stepId: 'step-1',
    ...overrides,
  };
}

function makeStep(overrides: Partial<ApiTestStep> = {}): ApiTestStep {
  return {
    id: 'step-1',
    name: 'GET /users',
    request: { method: 'GET', url: 'https://api.example.com/users', headers: [], body: undefined },
    assertions: [],
    extractVariables: [],
    execution: { retryPolicy: { maxRetries: 3, delayMs: 500 } },
    dependsOn: [],
    ...overrides,
  } as ApiTestStep;
}

describe('buildRemediationProposals', () => {
  it('maps retry category recommendation to retry-tuning proposal with diff', () => {
    const bundle = buildRemediationProposals([makeRec()], [makeStep()], 'col-1');
    expect(bundle.proposals).toHaveLength(1);
    const proposal = bundle.proposals[0];
    expect(proposal.type).toBe('retry-tuning');
    expect(proposal.status).toBe('pending-approval');
    expect(proposal.diff).toHaveLength(1);
    expect(proposal.diff[0].field).toBe('execution.retryPolicy.maxRetries');
    expect(proposal.diff[0].before).toBe(3);
    expect(proposal.diff[0].after).toBe(2);
  });

  it('skips workflow-quality and replay-rca categories (observational only)', () => {
    const recs = [
      makeRec({ id: 'rec-a', category: 'workflow-quality' }),
      makeRec({ id: 'rec-b', category: 'replay-rca' }),
    ];
    const bundle = buildRemediationProposals(recs, [makeStep()], 'col-1');
    expect(bundle.proposals).toHaveLength(0);
  });

  it('bundle.advisoryNote is a non-empty string enforcing advisory contract', () => {
    const bundle = buildRemediationProposals([], [], 'col-1');
    expect(typeof bundle.advisoryNote).toBe('string');
    expect(bundle.advisoryNote.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/api-remediation/__tests__/proposal-engine.test.ts
```
Expected: FAIL — cannot find module `'../engines/proposal-engine'`

- [ ] **Step 3: Create proposal-diff.ts**

```typescript
// src/api-remediation/engines/proposal-diff.ts
import type { ApiTestStep } from '../../data/types';
import type { AiRecommendation } from '../../api-intelligence/contracts/recommendation.contracts';
import type { RemediationFieldChange } from '../contracts/remediation-proposal.contracts';

export function buildDiff(rec: AiRecommendation, steps: ApiTestStep[]): RemediationFieldChange[] {
  const step = steps.find(s => s.id === rec.stepId);
  const label = step?.name ?? rec.stepId ?? 'step';
  const changes: RemediationFieldChange[] = [];

  switch (rec.category) {
    case 'retry': {
      const current = step?.execution?.retryPolicy?.maxRetries ?? 0;
      changes.push({
        field: 'execution.retryPolicy.maxRetries',
        before: current,
        after: Math.max(0, current - 1),
        humanLabel: `Max retries for '${label}'`,
      });
      break;
    }
    case 'healing': {
      changes.push({
        field: 'request.url',
        before: step?.request?.url ?? '(current URL)',
        after: rec.actionHint,
        humanLabel: `URL for '${label}'`,
      });
      break;
    }
    case 'dependency': {
      changes.push({
        field: 'dependsOn',
        before: step?.dependsOn ?? [],
        after: '(remove orphaned dependency references)',
        humanLabel: `Dependency list for '${label}'`,
      });
      break;
    }
    case 'assertion': {
      changes.push({
        field: 'assertions',
        before: `${step?.assertions?.length ?? 0} assertions configured`,
        after: rec.actionHint,
        humanLabel: `Assertion coverage for '${label}'`,
      });
      break;
    }
    case 'flakiness': {
      const currentMax = step?.execution?.retryPolicy?.maxRetries ?? 0;
      changes.push({
        field: 'execution.retryPolicy.maxRetries',
        before: currentMax,
        after: Math.max(2, currentMax),
        humanLabel: `Max retries for '${label}'`,
      });
      changes.push({
        field: 'quarantineEligible',
        before: false,
        after: true,
        humanLabel: `Quarantine eligibility for '${label}'`,
      });
      break;
    }
    case 'environment': {
      changes.push({
        field: 'environment.baseUrl',
        before: '(current environment base URL)',
        after: rec.actionHint,
        humanLabel: 'Environment base URL',
      });
      break;
    }
    default:
      break;
  }
  return changes;
}
```

- [ ] **Step 4: Create proposal-engine.ts**

```typescript
// src/api-remediation/engines/proposal-engine.ts
// Pure function — data in, proposals out. No DB or HTTP calls.

import type { AiRecommendation } from '../../api-intelligence/contracts/recommendation.contracts';
import type { ApiTestStep } from '../../data/types';
import type {
  RemediationProposal,
  RemediationProposalType,
  RemediationProposalBundle,
} from '../contracts/remediation-proposal.contracts';
import { buildDiff } from './proposal-diff';

const ADVISORY = 'Remediation proposals are advisory and approval-gated. AI must not apply proposals automatically. Human approval required before any remediation action.';

const CATEGORY_TO_TYPE: Partial<Record<string, RemediationProposalType>> = {
  'retry':        'retry-tuning',
  'healing':      'url-healing',
  'dependency':   'dependency-restructure',
  'assertion':    'assertion-repair',
  'flakiness':    'flaky-stabilization',
  'environment':  'environment-correction',
  // 'workflow-quality' and 'replay-rca' are observational — no actionable diff possible
};

export function buildRemediationProposals(
  recommendations: AiRecommendation[],
  steps: ApiTestStep[],
  collectionId: string,
  runId?: string,
): RemediationProposalBundle {
  const proposals: RemediationProposal[] = [];
  const now = new Date().toISOString();

  for (const rec of recommendations) {
    const type = CATEGORY_TO_TYPE[rec.category];
    if (!type) continue;

    const diff = buildDiff(rec, steps);
    if (diff.length === 0) continue;

    proposals.push({
      id: `prop-${rec.id}`,
      collectionId,
      runId,
      stepId: rec.stepId,
      stepName: steps.find(s => s.id === rec.stepId)?.name,
      type,
      title: rec.title,
      rationale: rec.detail,
      confidence: rec.confidence,
      diff,
      evidenceRefs: rec.provenance.evidenceRefs,
      sourceRecommendationId: rec.id,
      basis: rec.provenance.basis,
      status: 'pending-approval',
      createdAt: now,
      tenantId: rec.tenantId,
      advisoryNote: ADVISORY,
    });
  }

  return { collectionId, runId, generatedAt: now, proposals, advisoryNote: ADVISORY };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/api-remediation/__tests__/proposal-engine.test.ts
```
Expected: PASS — 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/api-remediation/engines/proposal-diff.ts \
        src/api-remediation/engines/proposal-engine.ts \
        src/api-remediation/__tests__/proposal-engine.test.ts
git commit -m "feat(remediation): proposal engine + diff visualization"
```

---

## Task 4: Proposal Store + Approval Store

**Files:**
- Create: `src/api-remediation/proposal-store.ts`
- Create: `src/api-remediation/approval-store.ts`
- Create: `src/api-remediation/__tests__/approval-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api-remediation/__tests__/approval-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadApprovalsRegistry,
  upsertApproval,
  findApprovalByProposalId,
  listApprovalsByCollection,
} from '../approval-store';
import type { ApprovalRequest } from '../contracts/approval-workflow.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'appr-1',
    proposalId: 'prop-1',
    collectionId: 'col-1',
    requestedBy: 'user-1',
    requestedAt: '2026-05-22T00:00:00Z',
    status: 'pending',
    rollbackEligible: true,
    ...overrides,
  };
}

describe('approval-store', () => {
  it('loadApprovalsRegistry returns empty registry when file absent', () => {
    const reg = loadApprovalsRegistry();
    expect(reg._schemaVersion).toBe(1);
    expect(reg.approvals).toEqual([]);
  });

  it('upsertApproval persists and retrieves the record', () => {
    upsertApproval(makeApproval());
    const reg = loadApprovalsRegistry();
    expect(reg.approvals).toHaveLength(1);
    expect(reg.approvals[0].id).toBe('appr-1');
  });

  it('findApprovalByProposalId returns pending approval by proposalId', () => {
    upsertApproval(makeApproval());
    const result = findApprovalByProposalId('prop-1');
    expect(result).not.toBeNull();
    expect(result!.proposalId).toBe('prop-1');
  });

  it('listApprovalsByCollection filters by collectionId', () => {
    upsertApproval(makeApproval({ id: 'a1', collectionId: 'col-1' }));
    upsertApproval(makeApproval({ id: 'a2', collectionId: 'col-2', proposalId: 'prop-2' }));
    const result = listApprovalsByCollection('col-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/api-remediation/__tests__/approval-store.test.ts
```
Expected: FAIL — cannot find module `'../approval-store'`

- [ ] **Step 3: Create proposal-store.ts**

```typescript
// src/api-remediation/proposal-store.ts
import * as fs from 'fs';
import * as path from 'path';
import type { RemediationProposal } from './contracts/remediation-proposal.contracts';

interface ProposalsRegistry { _schemaVersion: 1; proposals: RemediationProposal[]; }

function dataDir(): string { return path.resolve(process.env.DATA_DIR || 'data'); }
function proposalsPath(): string { return path.join(dataDir(), 'remediation-proposals.json'); }

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function load(): ProposalsRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(proposalsPath(), 'utf8')) as ProposalsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, proposals: [] };
  }
}

function save(reg: ProposalsRegistry): void {
  atomicWrite(proposalsPath(), JSON.stringify(reg, null, 2));
}

export function upsertProposal(proposal: RemediationProposal): void {
  const reg = load();
  const idx = reg.proposals.findIndex(p => p.id === proposal.id);
  if (idx >= 0) reg.proposals[idx] = proposal; else reg.proposals.push(proposal);
  save(reg);
}

export function findProposalById(id: string): RemediationProposal | null {
  return load().proposals.find(p => p.id === id) ?? null;
}

export function listProposalsByCollection(collectionId: string): RemediationProposal[] {
  return load().proposals.filter(p => p.collectionId === collectionId);
}
```

- [ ] **Step 4: Create approval-store.ts**

```typescript
// src/api-remediation/approval-store.ts
import * as fs from 'fs';
import * as path from 'path';
import type { ApprovalRequest, ApprovalsRegistry } from './contracts/approval-workflow.contracts';

function dataDir(): string { return path.resolve(process.env.DATA_DIR || 'data'); }
function approvalsPath(): string { return path.join(dataDir(), 'remediation-approvals.json'); }

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadApprovalsRegistry(): ApprovalsRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(approvalsPath(), 'utf8')) as ApprovalsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, approvals: [] };
  }
}

export function saveApprovalsRegistry(reg: ApprovalsRegistry): void {
  atomicWrite(approvalsPath(), JSON.stringify(reg, null, 2));
}

export function upsertApproval(approval: ApprovalRequest): void {
  const reg = loadApprovalsRegistry();
  const idx = reg.approvals.findIndex(a => a.id === approval.id);
  if (idx >= 0) reg.approvals[idx] = approval; else reg.approvals.push(approval);
  saveApprovalsRegistry(reg);
}

export function findApprovalByProposalId(proposalId: string): ApprovalRequest | null {
  return loadApprovalsRegistry().approvals.find(
    a => a.proposalId === proposalId && a.status === 'pending',
  ) ?? null;
}

export function listApprovalsByCollection(collectionId: string): ApprovalRequest[] {
  return loadApprovalsRegistry().approvals.filter(a => a.collectionId === collectionId);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/api-remediation/__tests__/approval-store.test.ts
```
Expected: PASS — 4 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/api-remediation/proposal-store.ts \
        src/api-remediation/approval-store.ts \
        src/api-remediation/__tests__/approval-store.test.ts
git commit -m "feat(remediation): proposal store + approval store (atomic write)"
```

---

## Task 5: Graph Overlay Remediation Extension

**Files:**
- Modify: `src/api-intelligence/contracts/graph-overlay-ai.contracts.ts`
- Create: `src/api-remediation/graph-overlay-remediator.ts`
- Modify: `src/api-intelligence/routes/ai-intelligence.routes.ts`
- Create: `src/api-remediation/__tests__/graph-overlay-remediator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api-remediation/__tests__/graph-overlay-remediator.test.ts
import { describe, it, expect } from 'vitest';
import { annotateOverlayWithProposals } from '../graph-overlay-remediator';
import type { AiGraphOverlayBundle } from '../../api-intelligence/contracts/graph-overlay-ai.contracts';
import type { RemediationProposal } from '../contracts/remediation-proposal.contracts';

function makeBundle(annotations: AiGraphOverlayBundle['annotations'] = []): AiGraphOverlayBundle {
  return {
    collectionId: 'col-1',
    generatedAt: '2026-05-22T00:00:00Z',
    annotations,
    advisoryNote: 'advisory',
  };
}

function makeProposal(overrides: Partial<RemediationProposal> = {}): RemediationProposal {
  return {
    id: 'prop-1',
    collectionId: 'col-1',
    stepId: 'step-1',
    type: 'retry-tuning',
    title: 'Reduce retries',
    rationale: 'Over-retrying',
    confidence: 85,
    diff: [],
    evidenceRefs: [],
    sourceRecommendationId: 'rec-1',
    basis: 'deterministic',
    status: 'pending-approval',
    createdAt: '2026-05-22T00:00:00Z',
    advisoryNote: 'advisory',
    ...overrides,
  };
}

describe('annotateOverlayWithProposals', () => {
  it('returns the original bundle unchanged when proposals array is empty', () => {
    const bundle = makeBundle([{ nodeId: 'step-1', stepId: 'step-1', badges: [] }]);
    const result = annotateOverlayWithProposals(bundle, []);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].badges).toHaveLength(0);
  });

  it('adds a badge to the matching annotation when proposal has a stepId', () => {
    const bundle = makeBundle([{ nodeId: 'step-1', stepId: 'step-1', badges: [] }]);
    const result = annotateOverlayWithProposals(bundle, [makeProposal()]);
    expect(result.annotations[0].badges).toHaveLength(1);
    expect(result.annotations[0].badges[0].confidence).toBe(85);
  });

  it('pending-approval proposal adds approval-pending badge type', () => {
    const bundle = makeBundle([{ nodeId: 'step-1', stepId: 'step-1', badges: [] }]);
    const result = annotateOverlayWithProposals(bundle, [makeProposal({ status: 'pending-approval' })]);
    expect(result.annotations[0].badges[0].type).toBe('approval-pending');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/api-remediation/__tests__/graph-overlay-remediator.test.ts
```
Expected: FAIL — cannot find module `'../graph-overlay-remediator'`

- [ ] **Step 3: Extend AiOverlayBadgeType in graph-overlay-ai.contracts.ts**

Read the file first, then add to the union (additive — do not remove existing types):

```typescript
export type AiOverlayBadgeType =
  | 'unstable-dependency'
  | 'retry-hotspot'
  | 'optimization-hint'
  | 'healing-confidence'
  | 'replay-anomaly'
  | 'remediation-proposed'   // step has an approved/applied proposal
  | 'approval-pending';      // step has a pending-approval proposal
```

- [ ] **Step 4: Create graph-overlay-remediator.ts**

```typescript
// src/api-remediation/graph-overlay-remediator.ts
// Pure function — augments an existing AiGraphOverlayBundle with proposal badges.
// Does NOT modify the original bundle; returns a new object.

import type {
  AiGraphOverlayBundle,
  AiGraphAnnotation,
  AiOverlayBadge,
} from '../api-intelligence/contracts/graph-overlay-ai.contracts';
import type { RemediationProposal } from './contracts/remediation-proposal.contracts';

export function annotateOverlayWithProposals(
  bundle: AiGraphOverlayBundle,
  proposals: RemediationProposal[],
): AiGraphOverlayBundle {
  if (proposals.length === 0) return bundle;

  // Deep-copy annotations so original bundle is untouched
  const annotationsMap = new Map<string, AiGraphAnnotation>(
    bundle.annotations.map(a => [a.stepId, { ...a, badges: [...a.badges] }]),
  );

  for (const proposal of proposals) {
    if (!proposal.stepId) continue;

    const badgeType = proposal.status === 'pending-approval' ? 'approval-pending' : 'remediation-proposed';
    const badge: AiOverlayBadge = {
      type: badgeType,
      label: proposal.type,
      confidence: proposal.confidence,
      detail: proposal.title,
    };

    const existing = annotationsMap.get(proposal.stepId);
    if (existing) {
      existing.badges.push(badge);
    } else {
      annotationsMap.set(proposal.stepId, {
        nodeId: proposal.stepId,
        stepId: proposal.stepId,
        badges: [badge],
      });
    }
  }

  return { ...bundle, annotations: Array.from(annotationsMap.values()) };
}
```

- [ ] **Step 5: Update graph-overlay route in ai-intelligence.routes.ts to augment with proposals**

Read `src/api-intelligence/routes/ai-intelligence.routes.ts` first, then add these imports at the top:

```typescript
import { listProposalsByCollection } from '../../api-remediation/proposal-store';
import { annotateOverlayWithProposals } from '../../api-remediation/graph-overlay-remediator';
```

Replace the `res.json(bundle)` line in the graph-overlay route handler with:

```typescript
    const proposals = listProposalsByCollection(collectionId);
    const augmented = annotateOverlayWithProposals(bundle, proposals);
    res.json(augmented);
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run src/api-remediation/__tests__/graph-overlay-remediator.test.ts
```
Expected: PASS — 3 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/api-intelligence/contracts/graph-overlay-ai.contracts.ts \
        src/api-remediation/graph-overlay-remediator.ts \
        src/api-intelligence/routes/ai-intelligence.routes.ts \
        src/api-remediation/__tests__/graph-overlay-remediator.test.ts
git commit -m "feat(remediation): graph overlay remediation badges + annotator"
```

---

## Task 6: REST Routes

**Files:**
- Create: `src/api-remediation/routes/remediation.routes.ts`
- Modify: `src/ui/server.ts`

- [ ] **Step 1: Create remediation.routes.ts**

```typescript
// src/api-remediation/routes/remediation.routes.ts

import { Router, Request, Response, Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { requirePermission } from '../../api-governance/rbac.middleware';
import { logApiAudit } from '../../api-governance/audit.helper';
import { getTenantContext } from '../../api-governance/tenant.helper';
import { readAll, API_COLLECTIONS } from '../../data/store';
import type { ApiCollection } from '../../data/types';
import { buildRecommendationBundle } from '../../api-intelligence/recommendation-service';
import { buildRemediationProposals } from '../engines/proposal-engine';
import {
  upsertProposal,
  findProposalById,
  listProposalsByCollection,
} from '../proposal-store';
import {
  loadApprovalsRegistry,
  upsertApproval,
  listApprovalsByCollection,
} from '../approval-store';
import type { ApprovalRequest } from '../contracts/approval-workflow.contracts';
import { loadRunsForCollection, getReport } from '../../api-flakiness/flakiness-service';

const router = Router();
const ADVISORY = 'Remediation proposals are advisory and approval-gated. AI must not apply proposals automatically. Human approval required before any remediation action.';

function genApprovalId(): string {
  return `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// POST /api/remediation/collections/:collectionId/proposals
// Generates proposals from latest recommendations and persists them.
router.post(
  '/collections/:collectionId/proposals',
  requireAuth,
  requirePermission('api:propose-remediation'),
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.params;
      const collection = readAll<ApiCollection>(API_COLLECTIONS).find(c => c.id === collectionId);
      if (!collection) return res.status(404).json({ error: 'Collection not found' });

      const recentRuns = loadRunsForCollection(collectionId).slice(0, 20);
      let flakinessReport = null;
      try { flakinessReport = getReport(collectionId); } catch { /* degrade */ }

      const recBundle = buildRecommendationBundle({ collection, recentRuns, flakinessReport });
      const bundle = buildRemediationProposals(
        recBundle.recommendations,
        collection.steps,
        collectionId,
        req.query.runId as string | undefined,
      );

      const requestedBy = req.session?.userId ?? 'unknown';
      for (const proposal of bundle.proposals) {
        upsertProposal({ ...proposal, requestedBy });
      }

      logApiAudit('api:remediation:proposed', collectionId, req, {
        details: `${bundle.proposals.length} proposals generated`,
        tenantId: getTenantContext(req)?.tenantId,
      });
      res.json({ ...bundle, proposals: bundle.proposals.map(p => ({ ...p, requestedBy })) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/remediation/collections/:collectionId/proposals
router.get(
  '/collections/:collectionId/proposals',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.params;
      const proposals = listProposalsByCollection(collectionId);
      res.json({ collectionId, proposals, advisoryNote: ADVISORY });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /api/remediation/proposals/:proposalId/approve
router.post(
  '/proposals/:proposalId/approve',
  requireAuth,
  requirePermission('api:approve-remediation'),
  async (req: Request, res: Response) => {
    try {
      const { proposalId } = req.params;
      const proposal = findProposalById(proposalId);
      if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

      const updated = { ...proposal, status: 'approved' as const };
      upsertProposal(updated);

      const record: ApprovalRequest = {
        id: genApprovalId(),
        proposalId,
        collectionId: proposal.collectionId,
        requestedBy: proposal.requestedBy ?? 'unknown',
        requestedAt: proposal.createdAt,
        status: 'decided',
        decision: 'approved',
        decidedBy: req.session?.userId ?? 'unknown',
        decidedAt: new Date().toISOString(),
        reviewComment: req.body?.reviewComment,
        rollbackEligible: true,
        tenantId: proposal.tenantId,
      };
      upsertApproval(record);

      logApiAudit('api:remediation:approved', proposal.collectionId, req, {
        details: `proposal ${proposalId}`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /api/remediation/proposals/:proposalId/reject
router.post(
  '/proposals/:proposalId/reject',
  requireAuth,
  requirePermission('api:approve-remediation'),
  async (req: Request, res: Response) => {
    try {
      const { proposalId } = req.params;
      const proposal = findProposalById(proposalId);
      if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

      const updated = { ...proposal, status: 'rejected' as const };
      upsertProposal(updated);

      const record: ApprovalRequest = {
        id: genApprovalId(),
        proposalId,
        collectionId: proposal.collectionId,
        requestedBy: proposal.requestedBy ?? 'unknown',
        requestedAt: proposal.createdAt,
        status: 'decided',
        decision: 'rejected',
        decidedBy: req.session?.userId ?? 'unknown',
        decidedAt: new Date().toISOString(),
        reviewComment: req.body?.reviewComment,
        rollbackEligible: false,
        tenantId: proposal.tenantId,
      };
      upsertApproval(record);

      logApiAudit('api:remediation:rejected', proposal.collectionId, req, {
        details: `proposal ${proposalId}`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/remediation/approvals?collectionId=X  — audit trail
router.get(
  '/approvals',
  requireAuth,
  requirePermission('api:view-audit'),
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.query as { collectionId?: string };
      const approvals = collectionId
        ? listApprovalsByCollection(collectionId)
        : loadApprovalsRegistry().approvals;
      res.json({ approvals });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

export function registerRemediationRoutes(app: Express): void {
  app.use('/api/remediation', router);
}
```

- [ ] **Step 2: Register routes in server.ts**

Read `src/ui/server.ts` — find the block where `registerAiIntelligenceRoutes` is called (around line 239), then add immediately after it:

```typescript
import { registerRemediationRoutes } from '../api-remediation/routes/remediation.routes';
// ... (add to the registration block)
registerRemediationRoutes(app);
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/api-remediation/routes/remediation.routes.ts \
        src/ui/server.ts
git commit -m "feat(remediation): REST routes — propose/approve/reject/audit-trail"
```

---

## Task 7: UI — Remediation Proposals Panel

**Files:**
- Modify: `src/ui/public/js/25-api-runs.js`
- Modify: `src/ui/public/styles_addon.css`

- [ ] **Step 1: Extend _apiRunsRenderAiInsights in 25-api-runs.js**

Read `src/ui/public/js/25-api-runs.js` lines 1157–1213. Replace the entire function body with the version below (the existing RCA and recommendations sections are preserved unchanged; the proposals section is appended):

```javascript
async function _apiRunsRenderAiInsights(runId, collectionId, container) {
  container.innerHTML = '<div class="ai-insights-loading">Loading AI insights…</div>';
  try {
    const [recRes, rcaRes, propRes] = await Promise.all([
      fetch(`/api/ai-intelligence/collections/${encodeURIComponent(collectionId)}/recommendations`),
      fetch(`/api/ai-intelligence/runs/${encodeURIComponent(runId)}/rca-hints`),
      fetch(`/api/remediation/collections/${encodeURIComponent(collectionId)}/proposals`),
    ]);

    const recBundle = recRes.ok ? await recRes.json() : null;
    const rcaBundle = rcaRes.ok ? await rcaRes.json() : null;
    const propData  = propRes.ok ? await propRes.json() : null;

    let html = `<div class="ai-insights-advisory">⚠️ ${_aiEscHtml(recBundle?.advisoryNote ?? 'AI recommendations are advisory only.')}</div>`;

    // RCA Hints section
    if (rcaBundle && rcaBundle.hints && rcaBundle.hints.length > 0) {
      html += '<div class="ai-insights-section"><h4>RCA Hints</h4><ul class="ai-hints-list">';
      for (const hint of rcaBundle.hints) {
        const conf = hint.confidence;
        const confClass = conf >= 85 ? 'ai-conf-high' : conf >= 65 ? 'ai-conf-med' : 'ai-conf-low';
        html += `<li class="ai-hint-item">
          <span class="ai-hint-title">${_aiEscHtml(hint.title)}</span>
          <span class="ai-conf-badge ${confClass}">${conf}% confidence</span>
          <div class="ai-hint-cause">${_aiEscHtml(hint.probableCause)}</div>
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
            <span class="ai-rec-title">${_aiEscHtml(rec.title)}</span>
            <span class="ai-conf-badge">${rec.confidence}%</span>
          </div>
          <div class="ai-rec-detail">${_aiEscHtml(rec.detail)}</div>
          <div class="ai-rec-action"><strong>Action:</strong> ${_aiEscHtml(rec.actionHint)}</div>
        </li>`;
      }
      html += '</ul></div>';
    } else if (recBundle) {
      html += '<div class="ai-insights-section"><h4>Collection Recommendations</h4><p class="ai-empty">No recommendations — collection looks healthy.</p></div>';
    }

    // Remediation Proposals section
    html += '<div class="ai-insights-section"><h4>Remediation Proposals</h4>';
    if (propData && propData.proposals && propData.proposals.length > 0) {
      html += `<p class="ai-remediation-advisory">${_aiEscHtml(propData.advisoryNote)}</p>`;
      html += '<ul class="ai-proposal-list">';
      for (const prop of propData.proposals) {
        const statusCls = 'ai-prop-' + _aiEscHtml(prop.status.replace(/-/g, '-'));
        const canAct = prop.status === 'pending-approval';
        const diffRows = (prop.diff || []).map(function(ch) {
          return '<tr><td>' + _aiEscHtml(ch.humanLabel) + '</td>' +
            '<td class="ai-diff-before">' + _aiEscHtml(String(ch.before)) + '</td>' +
            '<td class="ai-diff-after">' + _aiEscHtml(String(ch.after)) + '</td></tr>';
        }).join('');
        const safeId = _aiEscHtml(prop.id);
        const safeCol = _aiEscHtml(collectionId);
        html += `<li class="ai-proposal-item ${statusCls}">
          <div class="ai-prop-header">
            <span class="ai-prop-type-badge">${_aiEscHtml(prop.type)}</span>
            <span class="ai-prop-title">${_aiEscHtml(prop.title)}</span>
            <span class="ai-conf-badge">${prop.confidence}%</span>
            <span class="ai-prop-status-badge">${_aiEscHtml(prop.status)}</span>
          </div>
          <div class="ai-prop-rationale">${_aiEscHtml(prop.rationale)}</div>
          ${diffRows ? '<table class="ai-prop-diff-table"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>' + diffRows + '</tbody></table>' : ''}
          ${canAct ? '<div class="ai-prop-actions">' +
            '<button class="ai-prop-approve-btn" onclick="_apiRunsApproveProposal(\'' + safeId + '\')">Approve</button>' +
            '<button class="ai-prop-reject-btn" onclick="_apiRunsRejectProposal(\'' + safeId + '\')">Reject</button>' +
            '</div>' : ''}
        </li>`;
      }
      html += '</ul>';
    } else {
      html += '<p class="ai-empty">No proposals generated yet.</p>';
      html += '<button class="ai-generate-proposals-btn" onclick="_apiRunsGenerateProposals(' +
        JSON.stringify(collectionId) + ', this)">Generate Remediation Proposals</button>';
    }
    html += '</div>';

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="ai-insights-error">Failed to load AI insights: ${_aiEscHtml(String(err))}</div>`;
  }
}
```

- [ ] **Step 2: Add three new action functions immediately after `_aiEscHtml` (after line 1221)**

```javascript
async function _apiRunsGenerateProposals(collectionId, btn) {
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    var res = await fetch('/api/remediation/collections/' + encodeURIComponent(collectionId) + '/proposals', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    var panel = document.getElementById('ai-insights-panel-run');
    if (panel) { panel.removeAttribute('data-loaded'); }
    if (_apiRunsCurrentRun && panel) {
      _apiRunsRenderAiInsights(_apiRunsCurrentRun.id, _apiRunsCurrentRun.collectionId, panel);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Generate Remediation Proposals';
    alert('Failed to generate proposals: ' + String(err));
  }
}

async function _apiRunsApproveProposal(proposalId) {
  try {
    var res = await fetch('/api/remediation/proposals/' + encodeURIComponent(proposalId) + '/approve', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    var panel = document.getElementById('ai-insights-panel-run');
    if (panel) { panel.removeAttribute('data-loaded'); }
    if (_apiRunsCurrentRun && panel) {
      _apiRunsRenderAiInsights(_apiRunsCurrentRun.id, _apiRunsCurrentRun.collectionId, panel);
    }
  } catch (err) {
    alert('Approval failed: ' + String(err));
  }
}

async function _apiRunsRejectProposal(proposalId) {
  var comment = prompt('Rejection reason (optional):') || '';
  try {
    var res = await fetch('/api/remediation/proposals/' + encodeURIComponent(proposalId) + '/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewComment: comment || undefined }),
    });
    if (!res.ok) throw new Error(await res.text());
    var panel = document.getElementById('ai-insights-panel-run');
    if (panel) { panel.removeAttribute('data-loaded'); }
    if (_apiRunsCurrentRun && panel) {
      _apiRunsRenderAiInsights(_apiRunsCurrentRun.id, _apiRunsCurrentRun.collectionId, panel);
    }
  } catch (err) {
    alert('Rejection failed: ' + String(err));
  }
}
```

- [ ] **Step 3: Append Remediation CSS to styles_addon.css**

Read `src/ui/public/styles_addon.css` to find the end of file, then append:

```css
/* ── Remediation Proposals (Phase D Step 15) ─────────────────────────────── */
.ai-proposal-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.ai-proposal-item { background: var(--bg-2, #1e1e2e); border: 1px solid var(--border, #3a3a5c); border-radius: 8px; padding: 12px; }
.ai-proposal-item.ai-prop-pending-approval { border-left: 3px solid #f59e0b; }
.ai-proposal-item.ai-prop-approved  { border-left: 3px solid #22c55e; opacity: 0.85; }
.ai-proposal-item.ai-prop-rejected  { border-left: 3px solid #ef4444; opacity: 0.70; }
.ai-proposal-item.ai-prop-rolled-back { border-left: 3px solid #6b7280; opacity: 0.60; }
.ai-prop-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.ai-prop-type-badge { background: #334155; color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 6px; border-radius: 4px; }
.ai-prop-title { font-weight: 600; font-size: 13px; flex: 1; min-width: 0; }
.ai-prop-status-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.ai-prop-pending-approval .ai-prop-status-badge { background: #451a03; color: #f59e0b; }
.ai-prop-approved  .ai-prop-status-badge { background: #052e16; color: #22c55e; }
.ai-prop-rejected  .ai-prop-status-badge { background: #450a0a; color: #ef4444; }
.ai-prop-rationale { font-size: 12px; color: var(--text-muted, #8b8b9e); margin-bottom: 8px; }
.ai-prop-diff-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px; }
.ai-prop-diff-table th { background: var(--bg-3, #2a2a3e); color: var(--text-muted, #8b8b9e); text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border, #3a3a5c); }
.ai-prop-diff-table td { padding: 4px 8px; border-top: 1px solid var(--border, #3a3a5c); }
.ai-diff-before { color: #ef4444; font-family: monospace; font-size: 11px; }
.ai-diff-after  { color: #22c55e; font-family: monospace; font-size: 11px; }
.ai-prop-actions { display: flex; gap: 8px; margin-top: 8px; }
.ai-prop-approve-btn { background: #052e16; color: #22c55e; border: 1px solid #22c55e; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.ai-prop-approve-btn:hover { background: #14532d; }
.ai-prop-reject-btn  { background: #450a0a; color: #ef4444; border: 1px solid #ef4444; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.ai-prop-reject-btn:hover  { background: #7f1d1d; }
.ai-generate-proposals-btn { background: #1e3a5f; color: #60a5fa; border: 1px solid #3b82f6; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-top: 6px; }
.ai-generate-proposals-btn:hover { background: #1e40af; }
.ai-remediation-advisory { font-size: 11px; color: #f59e0b; background: #451a03; border-radius: 4px; padding: 6px 10px; margin-bottom: 8px; }
```

- [ ] **Step 4: Rebuild frontend modules**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build:js
```
Expected: `modules.js` regenerated with no errors

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/js/25-api-runs.js \
        src/ui/public/styles_addon.css
git commit -m "feat(remediation): AI Insights tab — remediation proposals panel with approve/reject"
```

---

## Task 8: TypeScript Build + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build
```
Expected: 0 TypeScript errors, `dist/` rebuilt

- [ ] **Step 2: Run all remediation tests**

```bash
npx vitest run src/api-remediation
```
Expected: All 17 tests pass (4 contracts + 3 policy + 3 engine + 4 store + 3 overlay)

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npx vitest run
```
Expected: All tests pass (0 failures)

- [ ] **Step 4: Update CLAUDE.md**

Read `CLAUDE.md`, then:

1. Add doc pointer under the Phase D Step 14 line in the doc pointers table:
```markdown
> **📋 See [docs/superpowers/plans/2026-05-22-phase-d-step15-ai-remediation-governance.md](docs/superpowers/plans/2026-05-22-phase-d-step15-ai-remediation-governance.md) — Phase D Step 15 implementation plan (8 tasks). **COMPLETE as of 2026-05-22.**
```

2. Add shipped feature entry after the "AI-Assisted Workflow Intelligence" section:
```markdown
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
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Phase D Step 15 completion"
```

---

## Self-Review

### Spec coverage check

| Spec Requirement | Covered by |
|---|---|
| A. Remediation proposal model (6 types) | Task 1 contracts + Task 3 engine |
| B. Approval workflow contracts | Task 1 `approval-workflow.contracts.ts` |
| C. Controlled healing execution (diff preview, confidence, approval-before-application) | Task 3 diff, Task 4 stores, Task 6 routes |
| D. Governance policy integration (who can approve, env restrictions, confidence thresholds) | Task 2 policy registry + RBAC |
| E. Replay-aware approval context (evidenceRefs from provenance) | Task 3 engine preserves `evidenceRefs` from source recommendation |
| F. Graph overlay remediation visualization (`approval-pending`, `remediation-proposed` badges) | Task 5 |
| G. Runs UI remediation workflows (approve/reject/generate, advisory UX) | Task 7 |
| H. Audit & governance compatibility (logApiAudit, tenant-safe, RBAC) | Tasks 2 + 6 |
| I. Deterministic runtime isolation (no mutation of collections/runtime) | Enforced: proposals are status records only; no write to collection data |
| J. Backward compatibility | No existing files broken; all changes additive |
| K. Future autonomous enterprise extension points | `rolled-back` status, `RemediationPolicy.allowProposalGeneration`, approval store as audit trail foundation |

### No placeholders — all code is complete and runnable.

### Type consistency confirmed:
- `RemediationProposal.id` format `prop-${rec.id}` is consistent across engine, store, and routes
- `AiOverlayBadgeType` extended union matches `annotateOverlayWithProposals` badge types (`'approval-pending'` | `'remediation-proposed'`)
- `ApprovalRequest.status: 'pending' | 'decided'` — `findApprovalByProposalId` correctly filters on `'pending'`
- `requirePermission('api:propose-remediation')` and `'api:approve-remediation'` match the keys added to `PERMISSION_ROLE_MAP`
- `logApiAudit('api:remediation:proposed' | 'approved' | 'rejected')` match the `ApiAuditAction` additions in `audit.contracts.ts`
