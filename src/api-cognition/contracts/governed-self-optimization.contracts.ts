// src/api-cognition/contracts/governed-self-optimization.contracts.ts
// Phase E Step 14: Governed self-optimization contracts. Approval-gated — no uncontrolled runtime mutation.

export type OptimizationDomain =
  | 'orchestration-stabilization'
  | 'retry-effectiveness'
  | 'sla-optimization'
  | 'bottleneck-adaptation'
  | 'dependency-stabilization'
  | 'environment-cognition-correction';

export type OptimizationApprovalStatus =
  | 'pending-review'
  | 'approved'
  | 'rejected'
  | 'applied-advisory'
  | 'expired';

export interface SelfOptimizationProposal {
  readonly proposalId: string;
  readonly collectionId: string;
  readonly domain: OptimizationDomain;
  readonly currentStateDescription: string;
  readonly proposedOptimization: string;
  readonly expectedImprovement: string;
  readonly confidence: number;          // 0–100
  readonly reasoning: string;           // explainable rationale
  readonly evidenceRefs: readonly string[];
  readonly status: OptimizationApprovalStatus;
  readonly actorId: string;
  readonly approvedBy?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly governanceNote: string;
}

export interface OptimizationGovernancePolicy {
  readonly policyId: string;
  readonly collectionId?: string;
  readonly enabledDomains: readonly OptimizationDomain[];
  readonly minConfidenceForApproval: number;
  readonly requiredApproverRoles: readonly string[];
  readonly auditAllOptimizations: boolean;
  readonly maxActiveProposals: number;
}

export interface IGovernedSelfOptimization {
  propose(
    collectionId: string,
    domain: OptimizationDomain,
    currentState: string,
    proposedOptimization: string,
    expectedImprovement: string,
    confidence: number,
    reasoning: string,
    actorId: string,
    evidenceRefs?: readonly string[]
  ): SelfOptimizationProposal;
  approve(proposalId: string, approverRole: string): SelfOptimizationProposal;
  reject(proposalId: string, reason: string): SelfOptimizationProposal;
  getProposal(proposalId: string): SelfOptimizationProposal | null;
  listProposals(collectionId: string, status?: OptimizationApprovalStatus): SelfOptimizationProposal[];
  registerPolicy(policy: OptimizationGovernancePolicy): void;
  getPolicy(collectionId?: string): OptimizationGovernancePolicy;
}
