export type FederationOptimizationDomain =
  | 'orchestration-stabilization'
  | 'retry-governance'
  | 'dependency-resilience'
  | 'remediation-effectiveness'
  | 'reliability-federation-scoring'
  | 'predictive-stabilization';

export type FederationProposalStatus =
  | 'pending-review'
  | 'approved'
  | 'rejected'
  | 'propagated-advisory'
  | 'expired';

export interface FederationOptimizationProposal {
  proposalId: string;
  collectionId: string;
  domain: FederationOptimizationDomain;
  currentFederationState: string;
  proposedFederationState: string;
  expectedFederationImprovement: string;
  confidenceScore: number;
  reasoning: string;
  status: FederationProposalStatus;
  requestedBy: string;
  approvedBy?: string;
  isExplainable: true;
  createdAt: string;
  expiresAt: string;
  governanceNote: string;
}

export interface OrchestrationStabilizationFederationResult {
  collectionId: string;
  stabilizationScore: number;
  federationDomainScores: Array<{
    domain: FederationOptimizationDomain;
    score: number;
    trend: 'improving' | 'stable' | 'degrading';
  }>;
  federationHealthLevel: 'excellent' | 'good' | 'fair' | 'poor';
  governanceNote: string;
  scoredAt: string;
}

export interface FederationGovernancePolicy {
  policyId: string;
  collectionId?: string;
  enabledDomains: FederationOptimizationDomain[];
  minConfidenceForPropagation: number;
  requiredApproverRoles: string[];
  maxActiveFederationProposals: number;
}

export interface IGovernedAdaptiveFederationEngine {
  propose(
    collectionId: string,
    domain: FederationOptimizationDomain,
    currentState: string,
    proposedState: string,
    expectedImprovement: string,
    confidenceScore: number,
    reasoning: string,
    requestedBy: string,
  ): FederationOptimizationProposal;
  approve(proposalId: string, approvedBy: string): FederationOptimizationProposal;
  reject(proposalId: string, reason: string): FederationOptimizationProposal;
  listProposals(collectionId: string, status?: FederationProposalStatus): FederationOptimizationProposal[];
  scoreStabilization(collectionId: string): OrchestrationStabilizationFederationResult;
  getPolicy(collectionId?: string): FederationGovernancePolicy;
  registerPolicy(policy: FederationGovernancePolicy): void;
}
