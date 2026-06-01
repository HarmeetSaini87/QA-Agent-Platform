import { describe, it, expect, beforeEach } from 'vitest';
import { FederationOrchestrationRegistry } from '../federation-orchestration-registry';
import { OrgFederationNode, FederationPolicy } from '../contracts/federation-orchestration.contracts';

function makeNode(overrides: Partial<OrgFederationNode> = {}): OrgFederationNode {
  return {
    nodeId: 'node1',
    orgId: 'org1',
    displayName: 'Org 1 Node',
    status: 'active',
    policyTier: 'selective-share',
    registeredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePolicy(overrides: Partial<FederationPolicy> = {}): FederationPolicy {
  return {
    policyId: 'pol1',
    ownerOrgId: 'org1',
    policyTier: 'selective-share',
    allowedOrgIds: ['org2'],
    shareReplayIntelligence: true,
    shareFlakinessPattterns: true,
    shareRemediationInsights: false,
    blockSensitiveFields: [],
    requireApprovalForSharing: false,
    governanceNote: 'test',
    ...overrides,
  };
}

describe('FederationOrchestrationRegistry', () => {
  let registry: FederationOrchestrationRegistry;

  beforeEach(() => {
    registry = new FederationOrchestrationRegistry();
    registry._reset();
  });

  it('registerNode and getNode', () => {
    registry.registerNode(makeNode());
    expect(registry.getNode('node1')?.nodeId).toBe('node1');
  });

  it('listNodes returns all nodes without filter', () => {
    registry.registerNode(makeNode({ nodeId: 'n1', orgId: 'org1' }));
    registry.registerNode(makeNode({ nodeId: 'n2', orgId: 'org2' }));
    expect(registry.listNodes()).toHaveLength(2);
  });

  it('listNodes filters by orgId', () => {
    registry.registerNode(makeNode({ nodeId: 'n1', orgId: 'org1' }));
    registry.registerNode(makeNode({ nodeId: 'n2', orgId: 'org2' }));
    expect(registry.listNodes('org1')).toHaveLength(1);
  });

  it('updateNodeStatus changes status', () => {
    registry.registerNode(makeNode({ nodeId: 'n1' }));
    registry.updateNodeStatus('n1', 'degraded');
    expect(registry.getNode('n1')?.status).toBe('degraded');
  });

  it('updateNodeStatus is no-op for unknown node', () => {
    expect(() => registry.updateNodeStatus('unknown', 'offline')).not.toThrow();
  });

  it('registerPolicy and getPolicy', () => {
    registry.registerPolicy(makePolicy());
    expect(registry.getPolicy('org1')).not.toBeNull();
  });

  it('checkSharingPermission — no policy → denied', () => {
    const result = registry.checkSharingPermission('org1', 'org2');
    expect(result.permitted).toBe(false);
  });

  it('checkSharingPermission — isolated tier → denied', () => {
    registry.registerPolicy(makePolicy({ policyTier: 'isolated' }));
    expect(registry.checkSharingPermission('org1', 'org2').permitted).toBe(false);
  });

  it('checkSharingPermission — targetOrgId not in allowedOrgIds → denied', () => {
    registry.registerPolicy(makePolicy({ allowedOrgIds: ['org3'] }));
    expect(registry.checkSharingPermission('org1', 'org2').permitted).toBe(false);
  });

  it('checkSharingPermission — permitted when targetOrgId in allowedOrgIds', () => {
    registry.registerPolicy(makePolicy({ allowedOrgIds: ['org2'] }));
    expect(registry.checkSharingPermission('org1', 'org2').permitted).toBe(true);
  });

  it('snapshot returns correct active/degraded counts', () => {
    registry.registerNode(makeNode({ nodeId: 'n1', orgId: 'org1', status: 'active' }));
    registry.registerNode(makeNode({ nodeId: 'n2', orgId: 'org1', status: 'degraded' }));
    const snap = registry.snapshot('org1');
    expect(snap.activeNodeCount).toBe(1);
    expect(snap.degradedNodeCount).toBe(1);
  });
});
