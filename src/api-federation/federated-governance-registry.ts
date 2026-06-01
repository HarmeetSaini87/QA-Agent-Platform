// src/api-federation/federated-governance-registry.ts
// Phase E Step 12: Federated governance registry. Local authority always preserved.

import { randomUUID } from 'crypto';
import {
  FederatedGovernancePolicy,
  ApprovalChainFederation,
  FederatedAuditEntry,
  IFederatedGovernanceRegistry,
} from './contracts/federated-governance.contracts';

const GOVERNANCE_NOTE = 'Local governance authority is always preserved. Federation is advisory/opt-in only.';
const EXPIRY_MS = 48 * 60 * 60 * 1000;

export class FederatedGovernanceRegistry implements IFederatedGovernanceRegistry {
  private readonly _policies = new Map<string, FederatedGovernancePolicy>();
  private readonly _chains = new Map<string, ApprovalChainFederation>();
  private readonly _audit: FederatedAuditEntry[] = [];

  registerPolicy(policy: FederatedGovernancePolicy): void {
    this._policies.set(policy.federationPolicyId, policy);
  }

  getPolicy(federationPolicyId: string): FederatedGovernancePolicy | null {
    return this._policies.get(federationPolicyId) ?? null;
  }

  listPolicies(orgId: string): FederatedGovernancePolicy[] {
    return [...this._policies.values()].filter((p) => p.ownerOrgId === orgId);
  }

  createApprovalChain(
    chain: Omit<ApprovalChainFederation, 'chainId' | 'approvals' | 'status'>
  ): ApprovalChainFederation {
    const now = new Date();
    const full: ApprovalChainFederation = {
      ...chain,
      chainId: randomUUID(),
      approvals: [],
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._chains.set(full.chainId, full);
    return full;
  }

  recordApproval(chainId: string, orgId: string, approvedBy: string): ApprovalChainFederation {
    const chain = this._chains.get(chainId);
    if (!chain) throw new Error(`Chain ${chainId} not found`);
    if (chain.status !== 'pending') throw new Error(`Chain ${chainId} is not pending`);

    const newApproval = { orgId, approvedBy, approvedAt: new Date().toISOString() };
    const updatedApprovals = [...chain.approvals, newApproval];

    const allApproved = chain.participatingOrgIds.every((id) =>
      updatedApprovals.some((a) => a.orgId === id)
    );

    const updated: ApprovalChainFederation = {
      ...chain,
      approvals: updatedApprovals,
      status: allApproved ? 'approved' : 'pending',
    };
    this._chains.set(chainId, updated);
    return updated;
  }

  getChain(chainId: string): ApprovalChainFederation | null {
    return this._chains.get(chainId) ?? null;
  }

  appendAuditEntry(entry: FederatedAuditEntry): void {
    this._audit.push(entry);
  }

  listAuditEntries(orgId: string): FederatedAuditEntry[] {
    return this._audit.filter((e) => e.orgId === orgId);
  }

  _reset(): void {
    this._policies.clear();
    this._chains.clear();
    this._audit.length = 0;
  }
}

export const globalFederatedGovernanceRegistry = new FederatedGovernanceRegistry();
