// src/api-cognition/governed-self-optimization-engine.ts
// Phase E Step 14: Governed self-optimization engine. Approval-gated — never auto-mutates runtime.

import { randomUUID } from 'crypto';
import {
  SelfOptimizationProposal,
  OptimizationDomain,
  OptimizationApprovalStatus,
  OptimizationGovernancePolicy,
  IGovernedSelfOptimization,
} from './contracts/governed-self-optimization.contracts';

const GOVERNANCE_NOTE =
  'Self-optimization proposals require explicit approval. No runtime is mutated automatically.';
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_POLICY: OptimizationGovernancePolicy = {
  policyId: 'default',
  enabledDomains: [
    'orchestration-stabilization', 'retry-effectiveness', 'sla-optimization',
    'bottleneck-adaptation', 'dependency-stabilization', 'environment-cognition-correction',
  ],
  minConfidenceForApproval: 70,
  requiredApproverRoles: ['admin', 'editor'],
  auditAllOptimizations: true,
  maxActiveProposals: 20,
};

export class GovernedSelfOptimizationEngine implements IGovernedSelfOptimization {
  private readonly _proposals = new Map<string, SelfOptimizationProposal>();
  private readonly _policies = new Map<string, OptimizationGovernancePolicy>(
    [['default', DEFAULT_POLICY]]
  );

  propose(
    collectionId: string,
    domain: OptimizationDomain,
    currentState: string,
    proposedOptimization: string,
    expectedImprovement: string,
    confidence: number,
    reasoning: string,
    actorId: string,
    evidenceRefs: readonly string[] = []
  ): SelfOptimizationProposal {
    const now = new Date();
    const proposal: SelfOptimizationProposal = {
      proposalId: randomUUID(),
      collectionId,
      domain,
      currentStateDescription: currentState,
      proposedOptimization,
      expectedImprovement,
      confidence,
      reasoning,
      evidenceRefs,
      status: 'pending-review',
      actorId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  approve(proposalId: string, approverRole: string): SelfOptimizationProposal {
    const p = this._proposals.get(proposalId);
    if (!p) throw new Error(`Proposal ${proposalId} not found`);
    if (p.status !== 'pending-review') throw new Error(`Proposal ${proposalId} not pending`);
    const updated: SelfOptimizationProposal = { ...p, status: 'applied-advisory', approvedBy: approverRole };
    this._proposals.set(proposalId, updated);
    return updated;
  }

  reject(proposalId: string, _reason: string): SelfOptimizationProposal {
    const p = this._proposals.get(proposalId);
    if (!p) throw new Error(`Proposal ${proposalId} not found`);
    if (p.status !== 'pending-review') throw new Error(`Proposal ${proposalId} not pending`);
    const updated: SelfOptimizationProposal = { ...p, status: 'rejected' };
    this._proposals.set(proposalId, updated);
    return updated;
  }

  getProposal(proposalId: string): SelfOptimizationProposal | null {
    return this._proposals.get(proposalId) ?? null;
  }

  listProposals(collectionId: string, status?: OptimizationApprovalStatus): SelfOptimizationProposal[] {
    const all = [...this._proposals.values()].filter((p) => p.collectionId === collectionId);
    return status ? all.filter((p) => p.status === status) : all;
  }

  registerPolicy(policy: OptimizationGovernancePolicy): void {
    this._policies.set(policy.policyId, policy);
  }

  getPolicy(collectionId?: string): OptimizationGovernancePolicy {
    if (collectionId) {
      const specific = [...this._policies.values()].find((p) => p.collectionId === collectionId);
      if (specific) return specific;
    }
    return this._policies.get('default') ?? DEFAULT_POLICY;
  }

  _reset(): void {
    this._proposals.clear();
    this._policies.clear();
    this._policies.set('default', DEFAULT_POLICY);
  }
}

export const globalGovernedSelfOptimizationEngine = new GovernedSelfOptimizationEngine();
