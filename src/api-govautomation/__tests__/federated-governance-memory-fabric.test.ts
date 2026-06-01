import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedGovernanceMemoryFabric } from '../federated-governance-memory-fabric';
import type { GovernanceMemoryRecord, ComplianceAntiPatternRecord, GovernanceRetentionPolicy } from '../contracts/federated-governance-memory.contracts';

function makeRecord(overrides: Partial<GovernanceMemoryRecord> = {}): GovernanceMemoryRecord {
  return {
    recordId: 'rec-1',
    orgId: 'org-1',
    collectionId: 'col-1',
    memoryType: 'policy-decision',
    governanceSignal: 'policy-signal',
    policyReasoning: 'reasoning',
    confidence: 0.8,
    occurrenceCount: 2,
    isAnonymized: true,
    isExplainable: true,
    retentionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    governanceNote: 'note',
    ...overrides,
  };
}

function makeAntiPattern(overrides: Partial<ComplianceAntiPatternRecord> = {}): ComplianceAntiPatternRecord {
  return {
    patternId: 'p1',
    patternKey: 'retry-storm',
    complianceSignal: 'excessive-retries',
    policyViolationChain: ['step-1', 'step-2'],
    crossOrgFrequency: 3,
    severity: 'high',
    knownRemediations: ['reduce-max-retries'],
    confidenceScore: 0.85,
    isAnonymized: true,
    firstObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedGovernanceMemoryFabric', () => {
  let fabric: FederatedGovernanceMemoryFabric;

  beforeEach(() => {
    fabric = new FederatedGovernanceMemoryFabric();
    fabric._reset();
  });

  it('adds and indexes records', () => {
    fabric.addRecord(makeRecord());
    const index = fabric.buildIndex('org-1');
    expect(index.totalRecords).toBe(1);
  });

  it('filters index by orgId', () => {
    fabric.addRecord(makeRecord({ orgId: 'org-1' }));
    fabric.addRecord(makeRecord({ recordId: 'rec-2', orgId: 'org-2' }));
    expect(fabric.buildIndex('org-1').totalRecords).toBe(1);
    expect(fabric.buildIndex('org-2').totalRecords).toBe(1);
  });

  it('filters index by collectionId', () => {
    fabric.addRecord(makeRecord({ collectionId: 'col-A' }));
    fabric.addRecord(makeRecord({ recordId: 'rec-2', collectionId: 'col-B' }));
    expect(fabric.buildIndex('org-1', 'col-A').totalRecords).toBe(1);
  });

  it('dominantMemoryType is type with most records', () => {
    fabric.addRecord(makeRecord({ recordId: 'r1', memoryType: 'audit-record' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', memoryType: 'audit-record' }));
    fabric.addRecord(makeRecord({ recordId: 'r3', memoryType: 'trust-signal' }));
    const index = fabric.buildIndex('org-1');
    expect(index.dominantMemoryType).toBe('audit-record');
  });

  it('strongestSignal is max confidence × occurrenceCount', () => {
    fabric.addRecord(makeRecord({ recordId: 'r1', governanceSignal: 'weak', confidence: 0.5, occurrenceCount: 1 }));
    fabric.addRecord(makeRecord({ recordId: 'r2', governanceSignal: 'strong', confidence: 0.9, occurrenceCount: 5 }));
    const index = fabric.buildIndex('org-1');
    expect(index.strongestSignal).toBe('strong');
  });

  it('complianceHealthScore is 100 for non-anomaly records', () => {
    fabric.addRecord(makeRecord({ memoryType: 'policy-decision' }));
    const index = fabric.buildIndex('org-1');
    expect(index.complianceHealthScore).toBe(100);
  });

  it('complianceHealthScore reduces for anomaly records', () => {
    fabric.addRecord(makeRecord({ recordId: 'r1', memoryType: 'governance-anomaly' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', memoryType: 'policy-decision' }));
    const index = fabric.buildIndex('org-1');
    expect(index.complianceHealthScore).toBe(50);
  });

  it('evictExpired removes past records', () => {
    fabric.addRecord(makeRecord({ retentionExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    const evicted = fabric.evictExpired();
    expect(evicted).toBe(1);
    expect(fabric.buildIndex('org-1').totalRecords).toBe(0);
  });

  it('evictExpired preserves future records', () => {
    fabric.addRecord(makeRecord({ retentionExpiresAt: new Date(Date.now() + 86400000).toISOString() }));
    const evicted = fabric.evictExpired();
    expect(evicted).toBe(0);
  });

  it('addComplianceAntiPattern and getComplianceAntiPattern', () => {
    fabric.addComplianceAntiPattern(makeAntiPattern());
    const found = fabric.getComplianceAntiPattern('retry-storm');
    expect(found?.severity).toBe('high');
  });

  it('getComplianceAntiPattern returns null for unknown', () => {
    expect(fabric.getComplianceAntiPattern('unknown')).toBeNull();
  });

  it('listComplianceAntiPatterns', () => {
    fabric.addComplianceAntiPattern(makeAntiPattern({ patternKey: 'p1' }));
    fabric.addComplianceAntiPattern(makeAntiPattern({ patternKey: 'p2', patternId: 'id2' }));
    expect(fabric.listComplianceAntiPatterns()).toHaveLength(2);
  });

  it('registerRetentionPolicy and getRetentionPolicy', () => {
    const policy: GovernanceRetentionPolicy = {
      policyId: 'pol-1', orgId: 'org-1', retentionDays: 30,
      anonymizeAfterDays: 7, requireExplainability: true, auditAllRecords: true,
    };
    fabric.registerRetentionPolicy(policy);
    expect(fabric.getRetentionPolicy('org-1')?.retentionDays).toBe(30);
  });

  it('getRetentionPolicy returns null for unknown org', () => {
    expect(fabric.getRetentionPolicy('unknown')).toBeNull();
  });
});
