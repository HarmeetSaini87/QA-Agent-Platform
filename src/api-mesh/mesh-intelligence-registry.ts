// src/api-mesh/mesh-intelligence-registry.ts
// Phase E Step 13: Mesh intelligence registry. Governed propagation — advisory signals only.

import { randomUUID } from 'crypto';
import {
  MeshIntelligenceNode,
  MeshIntelligenceScope,
  OrchestrationIntelligencePropagation,
  OrchestrationSignalType,
  MeshIntelligenceSummary,
  IMeshIntelligenceRegistry,
} from './contracts/mesh-intelligence.contracts';

const GOVERNANCE_NOTE = 'All mesh intelligence propagation is advisory. No runtime execution is altered.';

export class MeshIntelligenceRegistry implements IMeshIntelligenceRegistry {
  private readonly _nodes = new Map<string, MeshIntelligenceNode>();
  private readonly _propagations: OrchestrationIntelligencePropagation[] = [];

  registerNode(node: MeshIntelligenceNode): void {
    this._nodes.set(node.nodeId, node);
  }

  getNode(nodeId: string): MeshIntelligenceNode | null {
    return this._nodes.get(nodeId) ?? null;
  }

  listNodes(orgId?: string, scope?: MeshIntelligenceScope): MeshIntelligenceNode[] {
    let nodes = [...this._nodes.values()];
    if (orgId) nodes = nodes.filter((n) => n.orgId === orgId);
    if (scope) nodes = nodes.filter((n) => n.scope === scope);
    return nodes;
  }

  publishPropagation(propagation: OrchestrationIntelligencePropagation): void {
    this._propagations.push(propagation);
  }

  listPropagations(signalType?: OrchestrationSignalType): OrchestrationIntelligencePropagation[] {
    return signalType
      ? this._propagations.filter((p) => p.signalType === signalType)
      : [...this._propagations];
  }

  summarize(orgId: string): MeshIntelligenceSummary {
    const nodes = this.listNodes(orgId);
    const orgPropagations = this._propagations.filter((p) =>
      nodes.some((n) => n.nodeId === p.sourceNodeId)
    );

    const signalCounts = new Map<OrchestrationSignalType, number>();
    for (const p of orgPropagations) {
      signalCounts.set(p.signalType, (signalCounts.get(p.signalType) ?? 0) + 1);
    }
    let dominant: OrchestrationSignalType | null = null;
    let maxCount = 0;
    for (const [type, count] of signalCounts) {
      if (count > maxCount) { maxCount = count; dominant = type; }
    }

    return {
      orgId,
      scope: nodes[0]?.scope ?? 'local',
      totalNodes: nodes.length,
      activePropagations: orgPropagations.length,
      dominantSignalType: dominant,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Factory helper — builds a propagation record with a new UUID. */
  static makePropagation(
    signalType: OrchestrationSignalType,
    sourceNodeId: string,
    targetScope: MeshIntelligenceScope,
    payload: Record<string, unknown>,
    confidence: number
  ): OrchestrationIntelligencePropagation {
    return {
      propagationId: randomUUID(),
      signalType,
      sourceNodeId,
      targetScope,
      payload,
      confidence,
      propagatedAt: new Date().toISOString(),
      advisoryNote: GOVERNANCE_NOTE,
    };
  }

  _reset(): void {
    this._nodes.clear();
    this._propagations.length = 0;
  }
}

export const globalMeshIntelligenceRegistry = new MeshIntelligenceRegistry();
