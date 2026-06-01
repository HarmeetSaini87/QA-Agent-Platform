// src/api-federation/federation-orchestration-registry.ts
// Phase E Step 12: Federation node and policy registry. Governed sharing — no uncontrolled federation.

import { randomUUID } from 'crypto';
import {
  OrgFederationNode,
  FederationNodeStatus,
  FederationPolicy,
  FederationOrchestrationSnapshot,
  IFederationOrchestrationRegistry,
} from './contracts/federation-orchestration.contracts';

export class FederationOrchestrationRegistry implements IFederationOrchestrationRegistry {
  private readonly _nodes = new Map<string, OrgFederationNode>();
  private readonly _policies = new Map<string, FederationPolicy>();  // keyed by orgId

  registerNode(node: OrgFederationNode): void {
    this._nodes.set(node.nodeId, node);
  }

  updateNodeStatus(nodeId: string, status: FederationNodeStatus): void {
    const node = this._nodes.get(nodeId);
    if (!node) return;
    this._nodes.set(nodeId, { ...node, status, lastHeartbeatAt: new Date().toISOString() });
  }

  getNode(nodeId: string): OrgFederationNode | null {
    return this._nodes.get(nodeId) ?? null;
  }

  listNodes(orgId?: string): OrgFederationNode[] {
    const all = [...this._nodes.values()];
    return orgId ? all.filter((n) => n.orgId === orgId) : all;
  }

  registerPolicy(policy: FederationPolicy): void {
    this._policies.set(policy.ownerOrgId, policy);
  }

  getPolicy(orgId: string): FederationPolicy | null {
    return this._policies.get(orgId) ?? null;
  }

  checkSharingPermission(orgId: string, targetOrgId: string): { permitted: boolean; reason: string } {
    const policy = this._policies.get(orgId);
    if (!policy) {
      return { permitted: false, reason: `No federation policy registered for org ${orgId}` };
    }
    if (policy.policyTier === 'isolated') {
      return { permitted: false, reason: `Org ${orgId} is in isolated federation tier` };
    }
    if (policy.allowedOrgIds.length > 0 && !policy.allowedOrgIds.includes(targetOrgId)) {
      return { permitted: false, reason: `Org ${targetOrgId} not in allowedOrgIds for ${orgId}` };
    }
    if (policy.requireApprovalForSharing) {
      return { permitted: true, reason: 'Permitted — approval required before data transfer' };
    }
    return { permitted: true, reason: 'Permitted under federation policy' };
  }

  snapshot(orgId: string): FederationOrchestrationSnapshot {
    const nodes = this.listNodes(orgId);
    return {
      snapshotId: randomUUID(),
      orgId,
      activeNodeCount: nodes.filter((n) => n.status === 'active').length,
      degradedNodeCount: nodes.filter((n) => n.status === 'degraded').length,
      totalCollectionsShared: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  _reset(): void {
    this._nodes.clear();
    this._policies.clear();
  }
}

export const globalFederationOrchestrationRegistry = new FederationOrchestrationRegistry();
