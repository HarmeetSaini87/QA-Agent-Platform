import { randomUUID } from 'crypto';
import type {
  StabilizationDomain,
  ReliabilityOptimizationProposal,
  ReliabilityOptimizationStatus,
  RetryEvolutionRecommendation,
  DependencyTuningRecommendation,
  ResilienceScoringResult,
  ReliabilityOptimizationPolicy,
  IGovernedReliabilityOptimization,
} from './contracts/governed-reliability-optimization.contracts';

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const GOVERNANCE_NOTE = 'Advisory only — proposals require explicit human approval before any changes are applied.';

const ALL_DOMAINS: StabilizationDomain[] = [
  'retry-evolution', 'dependency-tuning', 'sla-optimization',
  'remediation-velocity', 'orchestration-resilience', 'environment-hardening',
];

const DEFAULT_POLICY: ReliabilityOptimizationPolicy = {
  policyId: 'default',
  enabledDomains: ALL_DOMAINS,
  minConfidenceForApproval: 70,
  requiredApproverRoles: ['admin', 'editor'],
  auditAllOptimizations: true,
  maxActiveProposals: 10,
};

export class GovernedReliabilityOptimizationEngine implements IGovernedReliabilityOptimization {
  private _proposals = new Map<string, ReliabilityOptimizationProposal>();
  private _policies = new Map<string, ReliabilityOptimizationPolicy>();

  _reset(): void {
    this._proposals.clear();
    this._policies.clear();
  }

  propose(
    collectionId: string,
    domain: StabilizationDomain,
    currentState: string,
    proposedState: string,
    expectedImprovement: string,
    confidenceScore: number,
    reasoning: string,
    requestedBy: string,
  ): ReliabilityOptimizationProposal {
    const now = new Date();
    const proposal: ReliabilityOptimizationProposal = {
      proposalId: randomUUID(),
      collectionId,
      domain,
      currentState,
      proposedState,
      expectedImprovement,
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

  approve(proposalId: string, approvedBy: string): ReliabilityOptimizationProposal {
    const p = this._proposals.get(proposalId);
    if (!p || p.status !== 'pending-review') {
      throw new Error(`Proposal ${proposalId} is not in pending-review status`);
    }
    const updated = { ...p, status: 'applied-advisory' as ReliabilityOptimizationStatus, approvedBy };
    this._proposals.set(proposalId, updated);
    return updated;
  }

  reject(proposalId: string, _reason: string): ReliabilityOptimizationProposal {
    const p = this._proposals.get(proposalId);
    if (!p || p.status !== 'pending-review') {
      throw new Error(`Proposal ${proposalId} is not in pending-review status`);
    }
    const updated = { ...p, status: 'rejected' as ReliabilityOptimizationStatus };
    this._proposals.set(proposalId, updated);
    return updated;
  }

  listProposals(collectionId: string, status?: ReliabilityOptimizationStatus): ReliabilityOptimizationProposal[] {
    return [...this._proposals.values()].filter(
      p => p.collectionId === collectionId && (status == null || p.status === status),
    );
  }

  scoreResilience(collectionId: string): ResilienceScoringResult {
    const proposals = this.listProposals(collectionId);
    const pendingCount = proposals.filter(p => p.status === 'pending-review').length;
    const dimensionScores = ALL_DOMAINS.map(domain => {
      const score = Math.max(40, 85 - pendingCount * 5);
      const trend = score >= 75 ? 'improving' as const : score >= 50 ? 'stable' as const : 'degrading' as const;
      return { domain, score, trend };
    });
    const overallResilienceScore = Math.round(
      dimensionScores.reduce((s, d) => s + d.score, 0) / dimensionScores.length,
    );
    const resilienceLevel =
      overallResilienceScore >= 80 ? 'high' as const
      : overallResilienceScore >= 60 ? 'medium' as const
      : overallResilienceScore >= 40 ? 'low' as const
      : 'critical' as const;
    return {
      collectionId,
      overallResilienceScore,
      dimensionScores,
      resilienceLevel,
      scoredAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  recommendRetryEvolution(collectionId: string): RetryEvolutionRecommendation {
    return {
      recommendationId: randomUUID(),
      collectionId,
      currentMaxRetries: 5,
      recommendedMaxRetries: 3,
      backoffStrategy: 'exponential-with-jitter',
      confidenceScore: 78,
      reasoning: 'Retry storm signals detected; reducing max retries advisable',
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  recommendDependencyTuning(collectionId: string, dependencyId: string): DependencyTuningRecommendation {
    return {
      recommendationId: randomUUID(),
      collectionId,
      dependencyId,
      currentTimeoutMs: 5000,
      recommendedTimeoutMs: 8000,
      circuitBreakerThreshold: 3,
      confidenceScore: 74,
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  getPolicy(collectionId?: string): ReliabilityOptimizationPolicy {
    if (collectionId) {
      const specific = this._policies.get(collectionId);
      if (specific) return specific;
    }
    return DEFAULT_POLICY;
  }

  registerPolicy(policy: ReliabilityOptimizationPolicy): void {
    const key = policy.collectionId ?? '__global__';
    this._policies.set(key, policy);
  }
}

export const globalGovernedReliabilityOptimizationEngine = new GovernedReliabilityOptimizationEngine();
