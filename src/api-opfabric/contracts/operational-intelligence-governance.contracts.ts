export type OperationalIntelligenceScope =
  | 'orchestration-governance'
  | 'replay-governance'
  | 'remediation-federation'
  | 'reliability-governance'
  | 'resilience-intelligence'
  | 'optimization-evolution';

export type PropagationPolicyTier = 'local' | 'tenant-scoped' | 'federated' | 'globally-governed';

export type GovernanceDecisionStatus = 'pending' | 'approved' | 'rejected' | 'propagated' | 'expired';

export interface OperationalIntelligencePropagation {
  propagationId: string;
  orgId: string;
  scope: OperationalIntelligenceScope;
  policyTier: PropagationPolicyTier;
  intelligencePayload: Record<string, unknown>;
  isAnonymized: true;
  isExplainable: true;
  governanceNote: string;
  createdAt: string;
}

export interface OrchestrationGovernanceDecision {
  decisionId: string;
  collectionId: string;
  scope: OperationalIntelligenceScope;
  rationale: string;
  status: GovernanceDecisionStatus;
  requestedBy: string;
  approvedBy?: string;
  confidence: number;
  isExplainable: true;
  createdAt: string;
  expiresAt: string;
  governanceNote: string;
}

export interface OperationalGovernanceSummary {
  orgId: string;
  totalDecisions: number;
  approvedDecisions: number;
  pendingDecisions: number;
  avgConfidence: number;
  dominantScope: OperationalIntelligenceScope | null;
  summarizedAt: string;
  governanceNote: string;
}

export interface OperationalIntelligenceGovernancePolicy {
  policyId: string;
  orgId?: string;
  allowedScopes: OperationalIntelligenceScope[];
  minConfidenceForPropagation: number;
  requireApprovalForFederation: boolean;
  auditAllDecisions: boolean;
}

export interface IOperationalIntelligenceGovernanceRegistry {
  publishPropagation(prop: Omit<OperationalIntelligencePropagation, 'propagationId' | 'createdAt'>): OperationalIntelligencePropagation;
  listPropagations(orgId: string, scope?: OperationalIntelligenceScope): OperationalIntelligencePropagation[];
  recordDecision(decision: Omit<OrchestrationGovernanceDecision, 'decisionId' | 'createdAt' | 'expiresAt' | 'governanceNote'>): OrchestrationGovernanceDecision;
  approveDecision(decisionId: string, approvedBy: string): OrchestrationGovernanceDecision;
  rejectDecision(decisionId: string): OrchestrationGovernanceDecision;
  summarize(orgId: string): OperationalGovernanceSummary;
  registerPolicy(policy: OperationalIntelligenceGovernancePolicy): void;
  getPolicy(orgId?: string): OperationalIntelligenceGovernancePolicy;
}
