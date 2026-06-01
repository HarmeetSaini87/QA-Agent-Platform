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
