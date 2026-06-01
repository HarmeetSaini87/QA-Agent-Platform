import { randomUUID } from 'crypto';
import type {
  RegionStatus,
  RegionalOrchestrationNode,
  OrchestrationFailoverRecord,
  RegionalResiliencePolicy,
  MultiRegionResilienceSnapshot,
  IMultiRegionResilienceRegistry,
} from './contracts/multi-region-resilience.contracts';

const GOVERNANCE_NOTE = 'Advisory only — regional orchestration nodes are observational; execution runtime is never modified.';

const DEFAULT_POLICY: RegionalResiliencePolicy = {
  policyId: 'default',
  primaryRegionId: 'region-primary',
  failoverRegionIds: ['region-secondary'],
  continuityMode: 'active-passive',
  minResilienceScore: 60,
  requireApprovalForFailover: true,
  auditAllFailovers: true,
};

export class MultiRegionResilienceRegistry implements IMultiRegionResilienceRegistry {
  private _nodes = new Map<string, RegionalOrchestrationNode>();
  private _failovers: OrchestrationFailoverRecord[] = [];
  private _policies = new Map<string, RegionalResiliencePolicy>();

  _reset(): void {
    this._nodes.clear();
    this._failovers = [];
    this._policies.clear();
  }

  registerNode(node: Omit<RegionalOrchestrationNode, 'governanceNote'>): RegionalOrchestrationNode {
    const full: RegionalOrchestrationNode = { ...node, governanceNote: GOVERNANCE_NOTE };
    this._nodes.set(node.nodeId, full);
    return full;
  }

  updateNodeStatus(nodeId: string, status: RegionStatus): RegionalOrchestrationNode {
    const node = this._nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const updated: RegionalOrchestrationNode = { ...node, status };
    this._nodes.set(nodeId, updated);
    return updated;
  }

  getNode(nodeId: string): RegionalOrchestrationNode | null {
    return this._nodes.get(nodeId) ?? null;
  }

  listNodes(orgId: string, status?: RegionStatus): RegionalOrchestrationNode[] {
    return [...this._nodes.values()].filter(
      n => n.orgId === orgId && (status == null || n.status === status),
    );
  }

  recordFailover(
    record: Omit<OrchestrationFailoverRecord, 'failoverId' | 'failoverAt' | 'governanceNote'>,
  ): OrchestrationFailoverRecord {
    const full: OrchestrationFailoverRecord = {
      ...record,
      failoverId: randomUUID(),
      failoverAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._failovers.push(full);
    return full;
  }

  listFailovers(orgId: string): OrchestrationFailoverRecord[] {
    return this._failovers.filter(f => f.orgId === orgId);
  }

  snapshot(orgId: string): MultiRegionResilienceSnapshot {
    const nodes = this.listNodes(orgId);
    const healthy = nodes.filter(n => n.status === 'healthy').length;
    const degraded = nodes.filter(n => n.status === 'degraded').length;
    const failover = nodes.filter(n => n.status === 'failover').length;
    const avgResilienceScore =
      nodes.length === 0
        ? 0
        : Math.round(nodes.reduce((s, n) => s + n.resilienceScore, 0) / nodes.length);
    return {
      orgId,
      totalNodes: nodes.length,
      healthyNodes: healthy,
      degradedNodes: degraded,
      failoverNodes: failover,
      avgResilienceScore,
      snapshotAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  registerPolicy(policy: RegionalResiliencePolicy): void {
    this._policies.set(policy.orgId ?? '__global__', policy);
  }

  getPolicy(orgId?: string): RegionalResiliencePolicy {
    if (orgId) {
      const specific = this._policies.get(orgId);
      if (specific) return specific;
    }
    return DEFAULT_POLICY;
  }
}

export const globalMultiRegionResilienceRegistry = new MultiRegionResilienceRegistry();
