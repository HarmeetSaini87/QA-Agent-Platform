import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionKnowledgeGraphRegistry } from '../execution-knowledge-graph-registry';

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    collectionId: 'col1',
    nodeType: 'orchestration-step' as const,
    semanticLabel: 'Auth step',
    contextAttributes: { stepIndex: 1 },
    confidence: 80,
    isExplainable: true as const,
    ...overrides,
  };
}

describe('ExecutionKnowledgeGraphRegistry', () => {
  let registry: ExecutionKnowledgeGraphRegistry;

  beforeEach(() => {
    registry = new ExecutionKnowledgeGraphRegistry();
    registry._reset();
  });

  it('addNode assigns nodeId and governanceNote', () => {
    const node = registry.addNode(makeNode());
    expect(node.nodeId).toBeTruthy();
    expect(node.governanceNote).toBeTruthy();
  });

  it('addNode sets isExplainable true', () => {
    expect(registry.addNode(makeNode()).isExplainable).toBe(true);
  });

  it('getNode returns registered node', () => {
    const node = registry.addNode(makeNode());
    expect(registry.getNode(node.nodeId)).not.toBeNull();
  });

  it('getNode returns null for unknown', () => {
    expect(registry.getNode('unknown')).toBeNull();
  });

  it('listNodes filters by collectionId', () => {
    registry.addNode(makeNode({ collectionId: 'col1' }));
    registry.addNode(makeNode({ collectionId: 'col2' }));
    expect(registry.listNodes('col1')).toHaveLength(1);
  });

  it('listNodes filters by nodeType', () => {
    registry.addNode(makeNode({ nodeType: 'orchestration-step' }));
    registry.addNode(makeNode({ nodeType: 'dependency' }));
    expect(registry.listNodes('col1', 'orchestration-step')).toHaveLength(1);
  });

  it('addEdge assigns edgeId', () => {
    const n1 = registry.addNode(makeNode());
    const n2 = registry.addNode(makeNode({ semanticLabel: 'Auth2' }));
    const edge = registry.addEdge({
      sourceNodeId: n1.nodeId, targetNodeId: n2.nodeId,
      relationType: 'depends-on', weight: 0.9,
      reasoningSummary: 'Direct dependency', isExplainable: true,
    });
    expect(edge.edgeId).toBeTruthy();
  });

  it('listEdges returns edges for collectionId nodes', () => {
    const n1 = registry.addNode(makeNode());
    const n2 = registry.addNode(makeNode({ semanticLabel: 'B' }));
    registry.addEdge({ sourceNodeId: n1.nodeId, targetNodeId: n2.nodeId, relationType: 'triggers', weight: 0.8, reasoningSummary: 'r', isExplainable: true });
    expect(registry.listEdges('col1')).toHaveLength(1);
  });

  it('listEdges filters by relationType', () => {
    const n1 = registry.addNode(makeNode());
    const n2 = registry.addNode(makeNode({ semanticLabel: 'B' }));
    registry.addEdge({ sourceNodeId: n1.nodeId, targetNodeId: n2.nodeId, relationType: 'triggers', weight: 0.8, reasoningSummary: 'r', isExplainable: true });
    registry.addEdge({ sourceNodeId: n1.nodeId, targetNodeId: n2.nodeId, relationType: 'remediates', weight: 0.7, reasoningSummary: 'r', isExplainable: true });
    expect(registry.listEdges('col1', 'triggers')).toHaveLength(1);
  });

  it('snapshot returns correct totalNodes and totalEdges', () => {
    const n1 = registry.addNode(makeNode());
    const n2 = registry.addNode(makeNode({ semanticLabel: 'B' }));
    registry.addEdge({ sourceNodeId: n1.nodeId, targetNodeId: n2.nodeId, relationType: 'depends-on', weight: 0.5, reasoningSummary: 'r', isExplainable: true });
    const snap = registry.snapshot('col1');
    expect(snap.totalNodes).toBe(2);
    expect(snap.totalEdges).toBe(1);
  });

  it('snapshot avgNodeConfidence is average', () => {
    registry.addNode(makeNode({ confidence: 60 }));
    registry.addNode(makeNode({ confidence: 80 }));
    expect(registry.snapshot('col1').avgNodeConfidence).toBe(70);
  });

  it('snapshot dominantRelationType reflects most common edge type', () => {
    const n1 = registry.addNode(makeNode());
    const n2 = registry.addNode(makeNode({ semanticLabel: 'B' }));
    registry.addEdge({ sourceNodeId: n1.nodeId, targetNodeId: n2.nodeId, relationType: 'depends-on', weight: 0.5, reasoningSummary: 'r', isExplainable: true });
    registry.addEdge({ sourceNodeId: n1.nodeId, targetNodeId: n2.nodeId, relationType: 'depends-on', weight: 0.6, reasoningSummary: 'r', isExplainable: true });
    registry.addEdge({ sourceNodeId: n1.nodeId, targetNodeId: n2.nodeId, relationType: 'triggers', weight: 0.4, reasoningSummary: 'r', isExplainable: true });
    expect(registry.snapshot('col1').dominantRelationType).toBe('depends-on');
  });

  it('snapshot dominantRelationType is null for empty graph', () => {
    expect(registry.snapshot('col1').dominantRelationType).toBeNull();
  });

  it('snapshot has governanceNote', () => {
    expect(registry.snapshot('col1').governanceNote).toBeTruthy();
  });
});
