import { randomUUID } from 'crypto';
import type {
  KnowledgeNodeType,
  KnowledgeRelationType,
  ExecutionKnowledgeNode,
  ExecutionKnowledgeEdge,
  ExecutionKnowledgeGraphSnapshot,
  IExecutionKnowledgeGraphRegistry,
} from './contracts/execution-knowledge-graph.contracts';

const GOVERNANCE_NOTE = 'Advisory only — execution knowledge graph is observational; WorkflowEnvelope and DAG remain authoritative.';

export class ExecutionKnowledgeGraphRegistry implements IExecutionKnowledgeGraphRegistry {
  private _nodes = new Map<string, ExecutionKnowledgeNode>();
  private _edges: ExecutionKnowledgeEdge[] = [];

  _reset(): void {
    this._nodes.clear();
    this._edges = [];
  }

  addNode(
    node: Omit<ExecutionKnowledgeNode, 'nodeId' | 'createdAt' | 'governanceNote'>,
  ): ExecutionKnowledgeNode {
    const full: ExecutionKnowledgeNode = {
      ...node,
      nodeId: randomUUID(),
      createdAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._nodes.set(full.nodeId, full);
    return full;
  }

  getNode(nodeId: string): ExecutionKnowledgeNode | null {
    return this._nodes.get(nodeId) ?? null;
  }

  listNodes(collectionId: string, nodeType?: KnowledgeNodeType): ExecutionKnowledgeNode[] {
    return [...this._nodes.values()].filter(
      n => n.collectionId === collectionId && (nodeType == null || n.nodeType === nodeType),
    );
  }

  addEdge(edge: Omit<ExecutionKnowledgeEdge, 'edgeId' | 'createdAt'>): ExecutionKnowledgeEdge {
    const full: ExecutionKnowledgeEdge = {
      ...edge,
      edgeId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this._edges.push(full);
    return full;
  }

  listEdges(collectionId: string, relationType?: KnowledgeRelationType): ExecutionKnowledgeEdge[] {
    const nodeIds = new Set(this.listNodes(collectionId).map(n => n.nodeId));
    return this._edges.filter(
      e =>
        (nodeIds.has(e.sourceNodeId) || nodeIds.has(e.targetNodeId)) &&
        (relationType == null || e.relationType === relationType),
    );
  }

  snapshot(collectionId: string): ExecutionKnowledgeGraphSnapshot {
    const nodes = this.listNodes(collectionId);
    const edges = this.listEdges(collectionId);

    const nodeTypeBreakdown: Record<string, number> = {};
    for (const n of nodes) {
      nodeTypeBreakdown[n.nodeType] = (nodeTypeBreakdown[n.nodeType] ?? 0) + 1;
    }

    const relCounts = new Map<string, number>();
    for (const e of edges) {
      relCounts.set(e.relationType, (relCounts.get(e.relationType) ?? 0) + 1);
    }
    let dominantRelationType: KnowledgeRelationType | null = null;
    let maxRel = 0;
    for (const [rel, count] of relCounts) {
      if (count > maxRel) { maxRel = count; dominantRelationType = rel as KnowledgeRelationType; }
    }

    const avgNodeConfidence =
      nodes.length === 0
        ? 0
        : Math.round(nodes.reduce((s, n) => s + n.confidence, 0) / nodes.length);

    return {
      snapshotId: randomUUID(),
      collectionId,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodeTypeBreakdown,
      dominantRelationType,
      avgNodeConfidence,
      snapshotAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalExecutionKnowledgeGraphRegistry = new ExecutionKnowledgeGraphRegistry();
