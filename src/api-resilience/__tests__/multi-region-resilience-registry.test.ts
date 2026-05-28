import { describe, it, expect, beforeEach } from 'vitest';
import { MultiRegionResilienceRegistry } from '../multi-region-resilience-registry';

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    nodeId: 'n1', regionId: 'us-east-1', orgId: 'org1',
    status: 'healthy' as const, continuityMode: 'active-passive' as const,
    resilienceScore: 85, primaryRegion: true,
    lastHeartbeatAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('MultiRegionResilienceRegistry', () => {
  let registry: MultiRegionResilienceRegistry;

  beforeEach(() => {
    registry = new MultiRegionResilienceRegistry();
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

  it('updateNodeStatus changes status', () => {
    registry.registerNode(makeNode({ status: 'healthy' }));
    const updated = registry.updateNodeStatus('n1', 'degraded');
    expect(updated.status).toBe('degraded');
  });

  it('updateNodeStatus throws for unknown node', () => {
    expect(() => registry.updateNodeStatus('unknown', 'degraded')).toThrow();
  });

  it('listNodes filters by orgId', () => {
    registry.registerNode(makeNode({ orgId: 'org1' }));
    registry.registerNode(makeNode({ nodeId: 'n2', orgId: 'org2' }));
    expect(registry.listNodes('org1')).toHaveLength(1);
  });

  it('listNodes filters by status', () => {
    registry.registerNode(makeNode({ status: 'healthy' }));
    registry.registerNode(makeNode({ nodeId: 'n2', status: 'degraded' }));
    expect(registry.listNodes('org1', 'healthy')).toHaveLength(1);
  });

  it('snapshot counts healthy and degraded nodes', () => {
    registry.registerNode(makeNode({ status: 'healthy' }));
    registry.registerNode(makeNode({ nodeId: 'n2', status: 'degraded' }));
    registry.registerNode(makeNode({ nodeId: 'n3', status: 'failover' }));
    const snap = registry.snapshot('org1');
    expect(snap.healthyNodes).toBe(1);
    expect(snap.degradedNodes).toBe(1);
    expect(snap.failoverNodes).toBe(1);
    expect(snap.totalNodes).toBe(3);
  });

  it('snapshot avgResilienceScore is correct', () => {
    registry.registerNode(makeNode({ resilienceScore: 60 }));
    registry.registerNode(makeNode({ nodeId: 'n2', resilienceScore: 80 }));
    expect(registry.snapshot('org1').avgResilienceScore).toBe(70);
  });

  it('snapshot has governanceNote', () => {
    expect(registry.snapshot('org1').governanceNote).toBeTruthy();
  });

  it('recordFailover assigns failoverId', () => {
    const f = registry.recordFailover({
      orgId: 'org1', fromRegionId: 'us-east-1', toRegionId: 'eu-west-1',
      triggerReason: 'region degraded', isApproved: true, approvedBy: 'admin',
      isExplainable: true,
    });
    expect(f.failoverId).toBeTruthy();
    expect(f.governanceNote).toBeTruthy();
  });

  it('listFailovers filters by orgId', () => {
    registry.recordFailover({ orgId: 'org1', fromRegionId: 'r1', toRegionId: 'r2', triggerReason: 't', isApproved: true, isExplainable: true });
    registry.recordFailover({ orgId: 'org2', fromRegionId: 'r1', toRegionId: 'r2', triggerReason: 't', isApproved: true, isExplainable: true });
    expect(registry.listFailovers('org1')).toHaveLength(1);
  });

  it('getPolicy returns default policyId when none registered', () => {
    expect(registry.getPolicy().policyId).toBe('default');
  });

  it('registerPolicy and retrieve by orgId', () => {
    registry.registerPolicy({
      policyId: 'pol-org1', orgId: 'org1',
      primaryRegionId: 'us-east-1', failoverRegionIds: ['eu-west-1'],
      continuityMode: 'active-active', minResilienceScore: 70,
      requireApprovalForFailover: true, auditAllFailovers: true,
    });
    expect(registry.getPolicy('org1')?.policyId).toBe('pol-org1');
  });
});
