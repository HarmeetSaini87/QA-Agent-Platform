import { describe, it, expect, beforeEach } from 'vitest';
import { ReliabilityFabricRegistry } from '../reliability-fabric-registry';

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    nodeId: 'n1', orgId: 'org1', collectionId: 'col1',
    status: 'active' as const, governanceMode: 'advisory' as const,
    reliabilityScore: 80, lastAssessedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ReliabilityFabricRegistry', () => {
  let registry: ReliabilityFabricRegistry;

  beforeEach(() => {
    registry = new ReliabilityFabricRegistry();
    registry._reset();
  });

  it('registerNode returns node with governanceNote', () => {
    const node = registry.registerNode(makeNode());
    expect(node.governanceNote).toBeTruthy();
    expect(node.nodeId).toBe('n1');
  });

  it('getNode returns registered node', () => {
    registry.registerNode(makeNode());
    expect(registry.getNode('n1')).not.toBeNull();
  });

  it('getNode returns null for unknown', () => {
    expect(registry.getNode('unknown')).toBeNull();
  });

  it('listNodes filters by orgId', () => {
    registry.registerNode(makeNode({ orgId: 'org1' }));
    registry.registerNode(makeNode({ nodeId: 'n2', orgId: 'org2' }));
    expect(registry.listNodes('org1')).toHaveLength(1);
  });

  it('listNodes filters by collectionId', () => {
    registry.registerNode(makeNode({ collectionId: 'col1' }));
    registry.registerNode(makeNode({ nodeId: 'n2', collectionId: 'col2' }));
    expect(registry.listNodes('org1', 'col1')).toHaveLength(1);
  });

  it('snapshot returns correct counts', () => {
    registry.registerNode(makeNode({ status: 'active' }));
    registry.registerNode(makeNode({ nodeId: 'n2', status: 'degraded' }));
    const snap = registry.snapshot('org1');
    expect(snap.totalNodes).toBe(2);
    expect(snap.activeNodes).toBe(1);
    expect(snap.degradedNodes).toBe(1);
  });

  it('snapshot avgReliabilityScore is correct', () => {
    registry.registerNode(makeNode({ reliabilityScore: 60 }));
    registry.registerNode(makeNode({ nodeId: 'n2', reliabilityScore: 80 }));
    expect(registry.snapshot('org1').avgReliabilityScore).toBe(70);
  });

  it('snapshot empty org returns zeros', () => {
    const snap = registry.snapshot('org-empty');
    expect(snap.totalNodes).toBe(0);
    expect(snap.avgReliabilityScore).toBe(0);
  });

  it('recordGovernance assigns recordId and governanceNote', () => {
    const rec = registry.recordGovernance({
      collectionId: 'col1', governanceMode: 'advisory', stabilizationTarget: 'retry-cap', rationale: 'test',
    });
    expect(rec.recordId).toBeTruthy();
    expect(rec.governanceNote).toBeTruthy();
  });

  it('listGovernance filters by collectionId', () => {
    registry.recordGovernance({ collectionId: 'col1', governanceMode: 'advisory', stabilizationTarget: 't', rationale: 'r' });
    registry.recordGovernance({ collectionId: 'col2', governanceMode: 'advisory', stabilizationTarget: 't', rationale: 'r' });
    expect(registry.listGovernance('col1')).toHaveLength(1);
  });
});
