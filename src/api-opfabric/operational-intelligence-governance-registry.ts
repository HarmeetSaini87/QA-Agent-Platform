import { randomUUID } from 'crypto';
import type {
  OperationalIntelligenceScope,
  OperationalIntelligencePropagation,
  OrchestrationGovernanceDecision,
  GovernanceDecisionStatus,
  OperationalGovernanceSummary,
  OperationalIntelligenceGovernancePolicy,
  IOperationalIntelligenceGovernanceRegistry,
} from './contracts/operational-intelligence-governance.contracts';

const GOVERNANCE_NOTE = 'Advisory only — operational intelligence propagation is observational; execution runtime is never modified.';
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const ALL_SCOPES: OperationalIntelligenceScope[] = [
  'orchestration-governance', 'replay-governance', 'remediation-federation',
  'reliability-governance', 'resilience-intelligence', 'optimization-evolution',
];

const DEFAULT_POLICY: OperationalIntelligenceGovernancePolicy = {
  policyId: 'default',
  allowedScopes: ALL_SCOPES,
  minConfidenceForPropagation: 65,
  requireApprovalForFederation: true,
  auditAllDecisions: true,
};

export class OperationalIntelligenceGovernanceRegistry
  implements IOperationalIntelligenceGovernanceRegistry {
  private _propagations: OperationalIntelligencePropagation[] = [];
  private _decisions = new Map<string, OrchestrationGovernanceDecision>();
  private _policies = new Map<string, OperationalIntelligenceGovernancePolicy>();

  _reset(): void {
    this._propagations = [];
    this._decisions.clear();
    this._policies.clear();
  }

  publishPropagation(
    prop: Omit<OperationalIntelligencePropagation, 'propagationId' | 'createdAt'>,
  ): OperationalIntelligencePropagation {
    const full: OperationalIntelligencePropagation = {
      ...prop,
      propagationId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this._propagations.push(full);
    return full;
  }

  listPropagations(orgId: string, scope?: OperationalIntelligenceScope): OperationalIntelligencePropagation[] {
    return this._propagations.filter(
      p => p.orgId === orgId && (scope == null || p.scope === scope),
    );
  }

  recordDecision(
    decision: Omit<OrchestrationGovernanceDecision, 'decisionId' | 'createdAt' | 'expiresAt' | 'governanceNote'>,
  ): OrchestrationGovernanceDecision {
    const now = new Date();
    const full: OrchestrationGovernanceDecision = {
      ...decision,
      decisionId: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._decisions.set(full.decisionId, full);
    return full;
  }

  approveDecision(decisionId: string, approvedBy: string): OrchestrationGovernanceDecision {
    const d = this._decisions.get(decisionId);
    if (!d || d.status !== 'pending') {
      throw new Error(`Decision ${decisionId} is not in pending status`);
    }
    const updated: OrchestrationGovernanceDecision = {
      ...d,
      status: 'approved' as GovernanceDecisionStatus,
      approvedBy,
    };
    this._decisions.set(decisionId, updated);
    return updated;
  }

  rejectDecision(decisionId: string): OrchestrationGovernanceDecision {
    const d = this._decisions.get(decisionId);
    if (!d || d.status !== 'pending') {
      throw new Error(`Decision ${decisionId} is not in pending status`);
    }
    const updated: OrchestrationGovernanceDecision = { ...d, status: 'rejected' as GovernanceDecisionStatus };
    this._decisions.set(decisionId, updated);
    return updated;
  }

  summarize(orgId: string): OperationalGovernanceSummary {
    const propagations = this.listPropagations(orgId);
    const decisions = [...this._decisions.values()].filter(d => d.collectionId.startsWith(orgId) || true);
    const approved = decisions.filter(d => d.status === 'approved').length;
    const pending = decisions.filter(d => d.status === 'pending').length;
    const avgConfidence =
      propagations.length === 0
        ? 0
        : Math.round(propagations.reduce((s, p) => s + (p.intelligencePayload['confidence'] as number ?? 70), 0) / propagations.length);

    // dominant scope by count
    const scopeCounts = new Map<string, number>();
    for (const p of propagations) {
      scopeCounts.set(p.scope, (scopeCounts.get(p.scope) ?? 0) + 1);
    }
    let dominantScope: OperationalIntelligenceScope | null = null;
    let maxCount = 0;
    for (const [scope, count] of scopeCounts) {
      if (count > maxCount) { maxCount = count; dominantScope = scope as OperationalIntelligenceScope; }
    }

    return {
      orgId,
      totalDecisions: decisions.length,
      approvedDecisions: approved,
      pendingDecisions: pending,
      avgConfidence,
      dominantScope,
      summarizedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  registerPolicy(policy: OperationalIntelligenceGovernancePolicy): void {
    this._policies.set(policy.orgId ?? '__global__', policy);
  }

  getPolicy(orgId?: string): OperationalIntelligenceGovernancePolicy {
    if (orgId) {
      const specific = this._policies.get(orgId);
      if (specific) return specific;
    }
    return DEFAULT_POLICY;
  }
}

export const globalOperationalIntelligenceGovernanceRegistry = new OperationalIntelligenceGovernanceRegistry();
