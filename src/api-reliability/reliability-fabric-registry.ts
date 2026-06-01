import { randomUUID } from 'crypto';
import type {
  ReliabilityFabricNode,
  StabilizationGovernanceRecord,
  ReliabilityFabricSnapshot,
  IReliabilityFabricRegistry,
} from './contracts/reliability-fabric.contracts';

const GOVERNANCE_NOTE = 'Advisory only — reliability fabric nodes are observational; no execution runtime is modified.';

export class ReliabilityFabricRegistry implements IReliabilityFabricRegistry {
  private _nodes = new Map<string, ReliabilityFabricNode>();
  private _governance: StabilizationGovernanceRecord[] = [];

  _reset(): void {
    this._nodes.clear();
    this._governance = [];
  }

  registerNode(node: Omit<ReliabilityFabricNode, 'governanceNote'>): ReliabilityFabricNode {
    const full: ReliabilityFabricNode = { ...node, governanceNote: GOVERNANCE_NOTE };
    this._nodes.set(node.nodeId, full);
    return full;
  }

  getNode(nodeId: string): ReliabilityFabricNode | null {
    return this._nodes.get(nodeId) ?? null;
  }

  listNodes(orgId: string, collectionId?: string): ReliabilityFabricNode[] {
    return [...this._nodes.values()].filter(
      n => n.orgId === orgId && (collectionId == null || n.collectionId === collectionId),
    );
  }

  snapshot(orgId: string): ReliabilityFabricSnapshot {
    const nodes = this.listNodes(orgId);
    const active = nodes.filter(n => n.status === 'active').length;
    const degraded = nodes.filter(n => n.status === 'degraded').length;
    const avgReliabilityScore =
      nodes.length === 0
        ? 0
        : Math.round(nodes.reduce((s, n) => s + n.reliabilityScore, 0) / nodes.length);
    return {
      orgId,
      totalNodes: nodes.length,
      activeNodes: active,
      degradedNodes: degraded,
      avgReliabilityScore,
      snapshotAt: new Date().toISOString(),
    };
  }

  recordGovernance(
    record: Omit<StabilizationGovernanceRecord, 'recordId' | 'createdAt' | 'governanceNote'>,
  ): StabilizationGovernanceRecord {
    const full: StabilizationGovernanceRecord = {
      ...record,
      recordId: randomUUID(),
      createdAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._governance.push(full);
    return full;
  }

  listGovernance(collectionId: string): StabilizationGovernanceRecord[] {
    return this._governance.filter(r => r.collectionId === collectionId);
  }
}

export const globalReliabilityFabricRegistry = new ReliabilityFabricRegistry();
