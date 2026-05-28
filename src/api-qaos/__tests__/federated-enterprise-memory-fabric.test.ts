import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedEnterpriseMemoryFabric } from '../federated-enterprise-memory-fabric';
import type { EnterpriseMemoryRecord, OrchestrationAntiPatternRecord, EnterpriseRetentionPolicy } from '../contracts/federated-enterprise-memory.contracts';

function makeRecord(overrides: Partial<EnterpriseMemoryRecord> = {}): EnterpriseMemoryRecord {
  return {
    recordId: 'rec-1',
    orgId: 'org-1',
    collectionId: 'col-1',
    memoryType: 'orchestration-federation-memory',
    operationalSignal: 'platform-signal',
    platformReasoning: 'reasoning',
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

function makeAntiPattern(overrides: Partial<OrchestrationAntiPatternRecord> = {}): OrchestrationAntiPatternRecord {
  return {
    patternId: 'p1',
    patternKey: 'retry-fragmentation',
    platformSignal: 'retry-overload',
    governanceViolationChain: ['step-1', 'step-2'],
    crossOrgFrequency: 3,
    severity: 'high',
    knownUnificationStrategies: ['harmonize-retries'],
    confidenceScore: 0.85,
    isAnonymized: true,
    firstObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedEnterpriseMemoryFabric', () => {
  let fabric: FederatedEnterpriseMemoryFabric;

  beforeEach(() => {
    fabric = new FederatedEnterpriseMemoryFabric();
    fabric._reset();
  });

  it('adds and indexes records', () => {
    fabric.addRecord(makeRecord());
    expect(fabric.buildIndex('org-1').totalRecords).toBe(1);
  });

  it('filters index by orgId', () => {
    fabric.addRecord(makeRecord({ orgId: 'org-1' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', orgId: 'org-2' }));
    expect(fabric.buildIndex('org-1').totalRecords).toBe(1);
  });

  it('filters index by collectionId', () => {
    fabric.addRecord(makeRecord({ collectionId: 'col-A' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', collectionId: 'col-B' }));
    expect(fabric.buildIndex('org-1', 'col-A').totalRecords).toBe(1);
  });

  it('dominantMemoryType is most frequent type', () => {
    fabric.addRecord(makeRecord({ recordId: 'r1', memoryType: 'reliability-coordination-memory' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', memoryType: 'reliability-coordination-memory' }));
    fabric.addRecord(makeRecord({ recordId: 'r3', memoryType: 'operational-trust-signal' }));
    expect(fabric.buildIndex('org-1').dominantMemoryType).toBe('reliability-coordination-memory');
  });

  it('strongestSignal is max confidence × occurrenceCount', () => {
    fabric.addRecord(makeRecord({ recordId: 'r1', operationalSignal: 'weak', confidence: 0.5, occurrenceCount: 1 }));
    fabric.addRecord(makeRecord({ recordId: 'r2', operationalSignal: 'strong', confidence: 0.9, occurrenceCount: 5 }));
    expect(fabric.buildIndex('org-1').strongestSignal).toBe('strong');
  });

  it('operationalHealthScore 100 for non-anomaly records', () => {
    fabric.addRecord(makeRecord({ memoryType: 'orchestration-federation-memory' }));
    expect(fabric.buildIndex('org-1').operationalHealthScore).toBe(100);
  });

  it('operationalHealthScore reduces for anomaly records', () => {
    fabric.addRecord(makeRecord({ recordId: 'r1', memoryType: 'platform-anomaly' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', memoryType: 'replay-continuity-memory' }));
    expect(fabric.buildIndex('org-1').operationalHealthScore).toBe(50);
  });

  it('evictExpired removes past records', () => {
    fabric.addRecord(makeRecord({ retentionExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(fabric.evictExpired()).toBe(1);
    expect(fabric.buildIndex('org-1').totalRecords).toBe(0);
  });

  it('evictExpired preserves future records', () => {
    fabric.addRecord(makeRecord());
    expect(fabric.evictExpired()).toBe(0);
  });

  it('addOrchestrationAntiPattern and getOrchestrationAntiPattern', () => {
    fabric.addOrchestrationAntiPattern(makeAntiPattern());
    expect(fabric.getOrchestrationAntiPattern('retry-fragmentation')?.severity).toBe('high');
  });

  it('getOrchestrationAntiPattern returns null for unknown', () => {
    expect(fabric.getOrchestrationAntiPattern('unknown')).toBeNull();
  });

  it('listOrchestrationAntiPatterns', () => {
    fabric.addOrchestrationAntiPattern(makeAntiPattern({ patternKey: 'p1' }));
    fabric.addOrchestrationAntiPattern(makeAntiPattern({ patternKey: 'p2', patternId: 'id2' }));
    expect(fabric.listOrchestrationAntiPatterns()).toHaveLength(2);
  });

  it('registerRetentionPolicy and getRetentionPolicy', () => {
    const policy: EnterpriseRetentionPolicy = { policyId: 'pol-1', orgId: 'org-1', retentionDays: 30, anonymizeAfterDays: 7, requireExplainability: true, auditAllRecords: true };
    fabric.registerRetentionPolicy(policy);
    expect(fabric.getRetentionPolicy('org-1')?.retentionDays).toBe(30);
  });

  it('getRetentionPolicy returns null for unknown org', () => {
    expect(fabric.getRetentionPolicy('unknown')).toBeNull();
  });
});
