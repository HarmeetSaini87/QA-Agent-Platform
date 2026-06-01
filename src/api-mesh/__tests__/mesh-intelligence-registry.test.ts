import { describe, it, expect, beforeEach } from 'vitest';
import { MeshIntelligenceRegistry } from '../mesh-intelligence-registry';
import { MeshIntelligenceNode } from '../contracts/mesh-intelligence.contracts';

function makeNode(overrides: Partial<MeshIntelligenceNode> = {}): MeshIntelligenceNode {
  return {
    nodeId: 'n1',
    orgId: 'org1',
    scope: 'local',
    activeSignalTypes: ['stabilization-propagation'],
    registeredAt: new Date().toISOString(),
    governanceNote: 'test',
    ...overrides,
  };
}

describe('MeshIntelligenceRegistry', () => {
  let registry: MeshIntelligenceRegistry;

  beforeEach(() => {
    registry = new MeshIntelligenceRegistry();
    registry._reset();
  });

  it('registerNode and getNode', () => {
    registry.registerNode(makeNode());
    expect(registry.getNode('n1')?.nodeId).toBe('n1');
  });

  it('getNode returns null for unknown', () => {
    expect(registry.getNode('unknown')).toBeNull();
  });

  it('listNodes returns all without filter', () => {
    registry.registerNode(makeNode({ nodeId: 'n1', orgId: 'org1' }));
    registry.registerNode(makeNode({ nodeId: 'n2', orgId: 'org2' }));
    expect(registry.listNodes()).toHaveLength(2);
  });

  it('listNodes filters by orgId', () => {
    registry.registerNode(makeNode({ nodeId: 'n1', orgId: 'org1' }));
    registry.registerNode(makeNode({ nodeId: 'n2', orgId: 'org2' }));
    expect(registry.listNodes('org1')).toHaveLength(1);
  });

  it('listNodes filters by scope', () => {
    registry.registerNode(makeNode({ nodeId: 'n1', scope: 'local' }));
    registry.registerNode(makeNode({ nodeId: 'n2', scope: 'federated' }));
    expect(registry.listNodes(undefined, 'federated')).toHaveLength(1);
  });

  it('publishPropagation and listPropagations', () => {
    const p = MeshIntelligenceRegistry.makePropagation('retry-optimization', 'n1', 'local', {}, 80);
    registry.publishPropagation(p);
    expect(registry.listPropagations()).toHaveLength(1);
  });

  it('listPropagations filters by signalType', () => {
    registry.publishPropagation(MeshIntelligenceRegistry.makePropagation('retry-optimization', 'n1', 'local', {}, 80));
    registry.publishPropagation(MeshIntelligenceRegistry.makePropagation('anomaly-propagation', 'n1', 'local', {}, 70));
    expect(registry.listPropagations('retry-optimization')).toHaveLength(1);
  });

  it('makePropagation sets advisory note', () => {
    const p = MeshIntelligenceRegistry.makePropagation('bottleneck-learning', 'n1', 'global', {}, 75);
    expect(p.advisoryNote).toBeTruthy();
  });

  it('summarize returns correct node count', () => {
    registry.registerNode(makeNode({ nodeId: 'n1', orgId: 'org1' }));
    registry.registerNode(makeNode({ nodeId: 'n2', orgId: 'org1' }));
    const summary = registry.summarize('org1');
    expect(summary.totalNodes).toBe(2);
  });

  it('summarize dominantSignalType reflects most published signal', () => {
    registry.registerNode(makeNode({ nodeId: 'n1', orgId: 'org1' }));
    registry.publishPropagation(MeshIntelligenceRegistry.makePropagation('retry-optimization', 'n1', 'local', {}, 80));
    registry.publishPropagation(MeshIntelligenceRegistry.makePropagation('retry-optimization', 'n1', 'local', {}, 80));
    registry.publishPropagation(MeshIntelligenceRegistry.makePropagation('anomaly-propagation', 'n1', 'local', {}, 70));
    const summary = registry.summarize('org1');
    expect(summary.dominantSignalType).toBe('retry-optimization');
  });
});
