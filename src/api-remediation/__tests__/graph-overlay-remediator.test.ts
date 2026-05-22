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
