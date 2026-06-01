// src/api-federation/contracts/federation-orchestration.contracts.ts
// Phase E Step 12: Federated orchestration contracts. Governed federation — WorkflowEnvelope authority preserved.

export type FederationNodeStatus = 'active' | 'degraded' | 'offline' | 'quarantined';
export type FederationPolicyTier = 'isolated' | 'selective-share' | 'open-intelligence';

export interface OrgFederationNode {
  readonly nodeId: string;
  readonly orgId: string;
  readonly tenantId?: string;
  readonly displayName: string;
  readonly status: FederationNodeStatus;
  readonly policyTier: FederationPolicyTier;
  readonly registeredAt: string;
  readonly lastHeartbeatAt?: string;
}

export interface FederationPolicy {
  readonly policyId: string;
  readonly ownerOrgId: string;
  readonly policyTier: FederationPolicyTier;
  readonly allowedOrgIds: readonly string[];       // empty = no external sharing
  readonly shareReplayIntelligence: boolean;
  readonly shareFlakinessPattterns: boolean;
  readonly shareRemediationInsights: boolean;
  readonly blockSensitiveFields: readonly string[];
  readonly requireApprovalForSharing: boolean;
  readonly governanceNote: string;
}

export interface FederationOrchestrationSnapshot {
  readonly snapshotId: string;
  readonly orgId: string;
  readonly activeNodeCount: number;
  readonly degradedNodeCount: number;
  readonly totalCollectionsShared: number;
  readonly generatedAt: string;
}

export interface IFederationOrchestrationRegistry {
  registerNode(node: OrgFederationNode): void;
  updateNodeStatus(nodeId: string, status: FederationNodeStatus): void;
  getNode(nodeId: string): OrgFederationNode | null;
  listNodes(orgId?: string): OrgFederationNode[];
  registerPolicy(policy: FederationPolicy): void;
  getPolicy(orgId: string): FederationPolicy | null;
  /** Check whether orgId is permitted to share intelligence with targetOrgId. */
  checkSharingPermission(orgId: string, targetOrgId: string): { permitted: boolean; reason: string };
  snapshot(orgId: string): FederationOrchestrationSnapshot;
}
