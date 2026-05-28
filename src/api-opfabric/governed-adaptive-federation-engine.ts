import { randomUUID } from 'crypto';
import type {
  FederationOptimizationDomain,
  FederationOptimizationProposal,
  FederationProposalStatus,
  OrchestrationStabilizationFederationResult,
  FederationGovernancePolicy,
  IGovernedAdaptiveFederationEngine,
} from './contracts/governed-adaptive-federation.contracts';

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const GOVERNANCE_NOTE = 'Advisory only — federation optimization proposals require explicit human approval; no runtime mutation occurs.';

const ALL_DOMAINS: FederationOptimizationDomain[] = [
  'orchestration-stabilization', 'retry-governance', 'dependency-resilience',
  'remediation-effectiveness', 'reliability-federation-scoring', 'predictive-stabilization',
];

const DEFAULT_POLICY: FederationGovernancePolicy = {
  policyId: 'default',
  enabledDomains: ALL_DOMAINS,
  minConfidenceForPropagation: 70,
  requiredApproverRoles: ['admin', 'editor'],
  maxActiveFederationProposals: 10,
};

export class GovernedAdaptiveFederationEngine implements IGovernedAdaptiveFederationEngine {
  private _proposals = new Map<string, FederationOptimizationProposal>();
  private _policies = new Map<string, FederationGovernancePolicy>();

  _reset(): void {
    this._proposals.clear();
    this._policies.clear();
  }

  propose(
    collectionId: string,
    domain: FederationOptimizationDomain,
    currentState: string,
    proposedState: string,
    expectedImprovement: string,
    confidenceScore: number,
    reasoning: string,
    requestedBy: string,
  ): FederationOptimizationProposal {
    const now = new Date();
    const proposal: FederationOptimizationProposal = {
      proposalId: randomUUID(),
      collectionId,
      domain,
      currentFederationState: currentState,
      proposedFederationState: proposedState,
      expectedFederationImprovement: expectedImprovement,
      confidenceScore,
      reasoning,
      status: 'pending-review',
      requestedBy,
      isExplainable: true,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  approve(proposalId: string, approvedBy: string): FederationOptimizationProposal {
    const p = this._proposals.get(proposalId);
    if (!p || p.status !== 'pending-review') {
      throw new Error(`Proposal ${proposalId} is not in pending-review status`);
    }
    const updated = { ...p, status: 'propagated-advisory' as FederationProposalStatus, approvedBy };
    this._proposals.set(proposalId, updated);
    return updated;
  }

  reject(proposalId: string, _reason: string): FederationOptimizationProposal {
    const p = this._proposals.get(proposalId);
    if (!p || p.status !== 'pending-review') {
      throw new Error(`Proposal ${proposalId} is not in pending-review status`);
    }
    const updated = { ...p, status: 'rejected' as FederationProposalStatus };
    this._proposals.set(proposalId, updated);
    return updated;
  }

  listProposals(collectionId: string, status?: FederationProposalStatus): FederationOptimizationProposal[] {
    return [...this._proposals.values()].filter(
      p => p.collectionId === collectionId && (status == null || p.status === status),
    );
  }

  scoreStabilization(collectionId: string): OrchestrationStabilizationFederationResult {
    const proposals = this.listProposals(collectionId);
    const pendingCount = proposals.filter(p => p.status === 'pending-review').length;
    const domainScores = ALL_DOMAINS.map(domain => {
      const score = Math.max(40, 82 - pendingCount * 4);
      const trend = score >= 75 ? 'improving' as const : score >= 50 ? 'stable' as const : 'degrading' as const;
      return { domain, score, trend };
    });
    const stabilizationScore = Math.round(
      domainScores.reduce((s, d) => s + d.score, 0) / domainScores.length,
    );
    const federationHealthLevel =
      stabilizationScore >= 80 ? 'excellent' as const
      : stabilizationScore >= 65 ? 'good' as const
      : stabilizationScore >= 50 ? 'fair' as const
      : 'poor' as const;
    return {
      collectionId,
      stabilizationScore,
      federationDomainScores: domainScores,
      federationHealthLevel,
      governanceNote: GOVERNANCE_NOTE,
      scoredAt: new Date().toISOString(),
    };
  }

  getPolicy(collectionId?: string): FederationGovernancePolicy {
    if (collectionId) {
      const specific = this._policies.get(collectionId);
      if (specific) return specific;
    }
    return DEFAULT_POLICY;
  }

  registerPolicy(policy: FederationGovernancePolicy): void {
    this._policies.set(policy.collectionId ?? '__global__', policy);
  }
}

export const globalGovernedAdaptiveFederationEngine = new GovernedAdaptiveFederationEngine();
