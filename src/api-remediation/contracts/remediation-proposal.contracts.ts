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
