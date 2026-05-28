// src/api-federation/contracts/federated-governance.contracts.ts
// Phase E Step 12: Federated governance contracts. Local authority always preserved.

export type FederatedPolicyPropagationMode = 'advisory' | 'opt-in' | 'enforced-by-local';

export interface FederatedGovernancePolicy {
  readonly federationPolicyId: string;
  readonly ownerOrgId: string;
  readonly propagationMode: FederatedPolicyPropagationMode;
  readonly rbacRequirements: readonly string[];
  readonly requiredApproverRoles: readonly string[];
  readonly auditAllFederatedActions: boolean;
  readonly sensitiveFieldMasks: readonly string[];
  readonly governanceNote: string;
}

export interface ApprovalChainFederation {
  readonly chainId: string;
  readonly initiatingOrgId: string;
  readonly participatingOrgIds: readonly string[];
  readonly actionDescription: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired';
  readonly approvals: readonly { orgId: string; approvedBy: string; approvedAt: string }[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly governanceNote: string;
}

export interface FederatedAuditEntry {
  readonly entryId: string;
  readonly orgId: string;
  readonly federationPolicyId: string;
  readonly action: string;
  readonly actorId: string;
  readonly targetOrgId?: string;
  readonly outcome: 'permitted' | 'denied' | 'escalated';
  readonly timestamp: string;
}

export interface IFederatedGovernanceRegistry {
  registerPolicy(policy: FederatedGovernancePolicy): void;
  getPolicy(federationPolicyId: string): FederatedGovernancePolicy | null;
  listPolicies(orgId: string): FederatedGovernancePolicy[];
  createApprovalChain(chain: Omit<ApprovalChainFederation, 'chainId' | 'approvals' | 'status'>): ApprovalChainFederation;
  recordApproval(chainId: string, orgId: string, approvedBy: string): ApprovalChainFederation;
  getChain(chainId: string): ApprovalChainFederation | null;
  appendAuditEntry(entry: FederatedAuditEntry): void;
  listAuditEntries(orgId: string): FederatedAuditEntry[];
}
