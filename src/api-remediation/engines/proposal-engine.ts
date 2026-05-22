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
