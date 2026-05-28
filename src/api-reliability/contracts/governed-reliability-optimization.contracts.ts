export type StabilizationDomain =
  | 'retry-evolution'
  | 'dependency-tuning'
  | 'sla-optimization'
  | 'remediation-velocity'
  | 'orchestration-resilience'
  | 'environment-hardening';

export type ReliabilityOptimizationStatus =
  | 'pending-review'
  | 'approved'
  | 'rejected'
  | 'applied-advisory'
  | 'expired';

export interface ReliabilityOptimizationProposal {
  proposalId: string;
  collectionId: string;
  domain: StabilizationDomain;
  currentState: string;
  proposedState: string;
  expectedImprovement: string;
  confidenceScore: number;
  reasoning: string;
  status: ReliabilityOptimizationStatus;
  requestedBy: string;
  approvedBy?: string;
  isExplainable: true;
  createdAt: string;
  expiresAt: string;
  governanceNote: string;
}

export interface RetryEvolutionRecommendation {
  recommendationId: string;
  collectionId: string;
  currentMaxRetries: number;
  recommendedMaxRetries: number;
  backoffStrategy: string;
  confidenceScore: number;
  reasoning: string;
  governanceNote: string;
}

export interface DependencyTuningRecommendation {
  recommendationId: string;
  collectionId: string;
  dependencyId: string;
  currentTimeoutMs: number;
  recommendedTimeoutMs: number;
  circuitBreakerThreshold: number;
  confidenceScore: number;
  governanceNote: string;
}

export interface ResilienceScoringResult {
  collectionId: string;
  overallResilienceScore: number;
  dimensionScores: Array<{ domain: StabilizationDomain; score: number; trend: 'improving' | 'stable' | 'degrading' }>;
  resilienceLevel: 'high' | 'medium' | 'low' | 'critical';
  scoredAt: string;
  governanceNote: string;
}

export interface ReliabilityOptimizationPolicy {
  policyId: string;
  collectionId?: string;
  enabledDomains: StabilizationDomain[];
  minConfidenceForApproval: number;
  requiredApproverRoles: string[];
  auditAllOptimizations: boolean;
  maxActiveProposals: number;
}

export interface IGovernedReliabilityOptimization {
  propose(
    collectionId: string,
    domain: StabilizationDomain,
    currentState: string,
    proposedState: string,
    expectedImprovement: string,
    confidenceScore: number,
    reasoning: string,
    requestedBy: string,
  ): ReliabilityOptimizationProposal;
  approve(proposalId: string, approvedBy: string): ReliabilityOptimizationProposal;
  reject(proposalId: string, reason: string): ReliabilityOptimizationProposal;
  listProposals(collectionId: string, status?: ReliabilityOptimizationStatus): ReliabilityOptimizationProposal[];
  scoreResilience(collectionId: string): ResilienceScoringResult;
  getPolicy(collectionId?: string): ReliabilityOptimizationPolicy;
  registerPolicy(policy: ReliabilityOptimizationPolicy): void;
}
