import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedGovernanceRegistry } from '../federated-governance-registry';
import { FederatedGovernancePolicy } from '../contracts/federated-governance.contracts';

function makePolicy(overrides: Partial<FederatedGovernancePolicy> = {}): FederatedGovernancePolicy {
  return {
    federationPolicyId: 'fp1',
    ownerOrgId: 'org1',
    propagationMode: 'advisory',
    rbacRequirements: ['admin'],
    requiredApproverRoles: ['admin'],
    auditAllFederatedActions: true,
    sensitiveFieldMasks: ['apiKey'],
    governanceNote: 'test',
    ...overrides,
  };
}

describe('FederatedGovernanceRegistry', () => {
  let registry: FederatedGovernanceRegistry;

  beforeEach(() => {
    registry = new FederatedGovernanceRegistry();
    registry._reset();
  });

  it('registerPolicy and getPolicy', () => {
    registry.registerPolicy(makePolicy());
    expect(registry.getPolicy('fp1')).not.toBeNull();
  });

  it('listPolicies returns org-filtered policies', () => {
    registry.registerPolicy(makePolicy({ federationPolicyId: 'fp1', ownerOrgId: 'org1' }));
    registry.registerPolicy(makePolicy({ federationPolicyId: 'fp2', ownerOrgId: 'org2' }));
    expect(registry.listPolicies('org1')).toHaveLength(1);
  });

  it('createApprovalChain returns pending status', () => {
    const chain = registry.createApprovalChain({
      initiatingOrgId: 'org1',
      participatingOrgIds: ['org1', 'org2'],
      actionDescription: 'share flakiness data',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      governanceNote: 'test',
    });
    expect(chain.status).toBe('pending');
    expect(chain.approvals).toHaveLength(0);
  });

  it('recordApproval adds approval', () => {
    const chain = registry.createApprovalChain({
      initiatingOrgId: 'org1',
      participatingOrgIds: ['org1', 'org2'],
      actionDescription: 'test',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      governanceNote: 'test',
    });
    const updated = registry.recordApproval(chain.chainId, 'org1', 'admin@org1');
    expect(updated.approvals).toHaveLength(1);
  });

  it('chain becomes approved when all orgs approve', () => {
    const chain = registry.createApprovalChain({
      initiatingOrgId: 'org1',
      participatingOrgIds: ['org1'],
      actionDescription: 'test',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      governanceNote: 'test',
    });
    const approved = registry.recordApproval(chain.chainId, 'org1', 'admin');
    expect(approved.status).toBe('approved');
  });

  it('recordApproval throws for non-pending chain', () => {
    const chain = registry.createApprovalChain({
      initiatingOrgId: 'org1',
      participatingOrgIds: ['org1'],
      actionDescription: 'test',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      governanceNote: 'test',
    });
    registry.recordApproval(chain.chainId, 'org1', 'admin');
    expect(() => registry.recordApproval(chain.chainId, 'org1', 'admin')).toThrow();
  });

  it('appendAuditEntry and listAuditEntries', () => {
    registry.appendAuditEntry({
      entryId: 'e1', orgId: 'org1', federationPolicyId: 'fp1',
      action: 'share-intelligence', actorId: 'user1',
      outcome: 'permitted', timestamp: new Date().toISOString(),
    });
    expect(registry.listAuditEntries('org1')).toHaveLength(1);
    expect(registry.listAuditEntries('org2')).toHaveLength(0);
  });

  it('getChain returns null for unknown', () => {
    expect(registry.getChain('unknown')).toBeNull();
  });
});
