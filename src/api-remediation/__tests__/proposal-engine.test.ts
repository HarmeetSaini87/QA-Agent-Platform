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
