import { randomUUID } from 'crypto';
import type {
  ConsolidationDomain, ConsolidationProposalStatus, EnterpriseConsolidationProposal,
  ConsolidationDomainScore, PlatformConsolidationScorecard, ConsolidationGovernancePolicy,
  IEnterpriseOperationalConsolidationEngine
} from './contracts/enterprise-operational-consolidation.contracts';

const GOVERNANCE_NOTE = 'Enterprise operational consolidation engine — advisory only, approval-gated, no runtime mutations.';
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const ALL_DOMAINS: ConsolidationDomain[] = [
  'orchestration-federation', 'replay-continuity', 'operational-memory',
  'trust-coordination', 'reliability-fabric', 'cognition-unification',
];

const DOMAIN_SIGNALS: Record<ConsolidationDomain, string> = {
  'orchestration-federation': 'orchestration-federation-signal',
  'replay-continuity': 'replay-continuity-signal',
  'operational-memory': 'operational-memory-signal',
  'trust-coordination': 'trust-coordination-signal',
  'reliability-fabric': 'reliability-fabric-signal',
  'cognition-unification': 'cognition-unification-signal',
};

function trendForScore(score: number): ConsolidationDomainScore['trend'] {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

function platformReadiness(score: number): PlatformConsolidationScorecard['platformReadiness'] {
  if (score >= 85) return 'unified';
  if (score >= 70) return 'substantially-unified';
  if (score >= 50) return 'partially-unified';
  return 'fragmented';
}

const DEFAULT_POLICY: ConsolidationGovernancePolicy = {
  policyId: 'default',
  minConfidence: 70,
  approverRoles: ['admin', 'editor'],
  enabledDomains: ALL_DOMAINS,
  requireExplainability: true,
};

export class EnterpriseOperationalConsolidationEngine implements IEnterpriseOperationalConsolidationEngine {
  private _proposals = new Map<string, EnterpriseConsolidationProposal>();
  private _policies = new Map<string, ConsolidationGovernancePolicy>();

  _reset(): void { this._proposals.clear(); this._policies.clear(); }

  propose(collectionId: string, domain: ConsolidationDomain, action: string, reasoning: string, confidence: number): EnterpriseConsolidationProposal {
    const proposal: EnterpriseConsolidationProposal = {
      proposalId: randomUUID(),
      collectionId,
      domain,
      consolidationAction: action,
      consolidationReasoning: reasoning,
      confidence,
      status: 'pending-review',
      isExplainable: true,
      expiresAt: new Date(Date.now() + EXPIRY_MS).toISOString(),
      createdAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  approve(proposalId: string, approverRole: string): EnterpriseConsolidationProposal {
    const proposal = this._proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status !== 'pending-review') throw new Error(`Proposal ${proposalId} is not pending-review`);
    const updated = { ...proposal, status: 'consolidating-advisory' as ConsolidationProposalStatus, approvedBy: approverRole };
    this._proposals.set(proposalId, updated);
    return updated;
  }

  reject(proposalId: string): EnterpriseConsolidationProposal {
    const proposal = this._proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status !== 'pending-review') throw new Error(`Proposal ${proposalId} is not pending-review`);
    const updated = { ...proposal, status: 'rolled-back' as ConsolidationProposalStatus };
    this._proposals.set(proposalId, updated);
    return updated;
  }

  listProposals(collectionId: string): EnterpriseConsolidationProposal[] {
    return Array.from(this._proposals.values()).filter(p => p.collectionId === collectionId);
  }

  scoreConsolidation(collectionId: string): PlatformConsolidationScorecard {
    const domainScores: ConsolidationDomainScore[] = ALL_DOMAINS.map((domain, i) => {
      const score = 60 + (i % 3) * 10;
      return {
        scoreId: randomUUID(),
        collectionId,
        domain,
        unificationScore: score,
        trend: trendForScore(score),
        consolidationSignals: [DOMAIN_SIGNALS[domain]],
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      };
    });

    const overall = Math.round(domainScores.reduce((s, d) => s + d.unificationScore, 0) / domainScores.length);
    const criticalFragmentations = domainScores.filter(d => d.unificationScore < 60).map(d => `${d.domain}: fragmentation detected`);

    return {
      scorecardId: randomUUID(),
      collectionId,
      domainScores,
      overallUnificationScore: overall,
      platformReadiness: platformReadiness(overall),
      criticalFragmentations,
      governanceNote: GOVERNANCE_NOTE,
      scoredAt: new Date().toISOString(),
    };
  }

  getPolicy(collectionId: string): ConsolidationGovernancePolicy {
    return this._policies.get(collectionId) ?? DEFAULT_POLICY;
  }

  setPolicy(collectionId: string, policy: ConsolidationGovernancePolicy): void {
    this._policies.set(collectionId, policy);
  }
}

export const globalEnterpriseOperationalConsolidationEngine = new EnterpriseOperationalConsolidationEngine();
