export type ConsolidationDomain =
  | 'orchestration-federation'
  | 'replay-continuity'
  | 'operational-memory'
  | 'trust-coordination'
  | 'reliability-fabric'
  | 'cognition-unification';

export type ConsolidationProposalStatus =
  | 'pending-review'
  | 'approved'
  | 'consolidating-advisory'
  | 'completed'
  | 'rolled-back';

export interface ConsolidationGovernancePolicy {
  policyId: string;
  orgId?: string;
  minConfidence: number;
  approverRoles: string[];
  enabledDomains: ConsolidationDomain[];
  requireExplainability: boolean;
}

export interface EnterpriseConsolidationProposal {
  proposalId: string;
  collectionId: string;
  domain: ConsolidationDomain;
  consolidationAction: string;
  consolidationReasoning: string;
  confidence: number;
  status: ConsolidationProposalStatus;
  approvedBy?: string;
  isExplainable: true;
  expiresAt: string;
  createdAt: string;
  governanceNote: string;
}

export interface ConsolidationDomainScore {
  scoreId: string;
  collectionId: string;
  domain: ConsolidationDomain;
  unificationScore: number;
  trend: 'improving' | 'stable' | 'degrading';
  consolidationSignals: string[];
  isExplainable: true;
  governanceNote: string;
}

export interface PlatformConsolidationScorecard {
  scorecardId: string;
  collectionId: string;
  domainScores: ConsolidationDomainScore[];
  overallUnificationScore: number;
  platformReadiness: 'unified' | 'substantially-unified' | 'partially-unified' | 'fragmented';
  criticalFragmentations: string[];
  governanceNote: string;
  scoredAt: string;
}

export interface IEnterpriseOperationalConsolidationEngine {
  propose(collectionId: string, domain: ConsolidationDomain, action: string, reasoning: string, confidence: number): EnterpriseConsolidationProposal;
  approve(proposalId: string, approverRole: string): EnterpriseConsolidationProposal;
  reject(proposalId: string): EnterpriseConsolidationProposal;
  listProposals(collectionId: string): EnterpriseConsolidationProposal[];
  scoreConsolidation(collectionId: string): PlatformConsolidationScorecard;
  getPolicy(collectionId: string): ConsolidationGovernancePolicy;
  setPolicy(collectionId: string, policy: ConsolidationGovernancePolicy): void;
}
