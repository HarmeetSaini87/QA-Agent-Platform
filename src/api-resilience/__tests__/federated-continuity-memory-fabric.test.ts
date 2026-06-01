import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedContinuityMemoryFabric } from '../federated-continuity-memory-fabric';
import type { ContinuityMemoryRecord, OutagePatternRecord } from '../contracts/federated-continuity-memory.contracts';

function makeRecord(overrides: Partial<ContinuityMemoryRecord> = {}): ContinuityMemoryRecord {
  return {
    recordId: 'r1', orgId: 'org1', collectionId: 'col1',
    memoryType: 'failover-event',
    continuitySignal: 'Region failover triggered',
    recoveryReasoning: 'Primary region degraded, advisory failover initiated',
    confidence: 75,
    occurrenceCount: 3,
    isAnonymized: true,
    isExplainable: true,
    retentionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    governanceNote: 'Advisory',
    ...overrides,
  };
}

function makeOutagePattern(overrides: Partial<OutagePatternRecord> = {}): OutagePatternRecord {
  return {
    patternId: 'p1', patternKey: 'region-cascade-outage',
    outageSignal: 'Primary region failure cascades to replica',
    recoveryChain: ['Detect degradation', 'Advisory failover', 'Restore primary'],
    crossOrgFrequency: 4, severity: 'high',
    knownRecoveryStrategies: ['warm-standby-promotion'],
    confidenceScore: 82, isAnonymized: true,
    firstObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedContinuityMemoryFabric', () => {
  let fabric: FederatedContinuityMemoryFabric;

  beforeEach(() => {
    fabric = new FederatedContinuityMemoryFabric();
    fabric._reset();
  });

  it('addRecord and buildIndex count', () => {
    fabric.addRecord(makeRecord());
    expect(fabric.buildIndex('org1', 'col1').totalRecords).toBe(1);
  });

  it('buildIndex filters by orgId', () => {
    fabric.addRecord(makeRecord({ orgId: 'org1' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', orgId: 'org2' }));
    expect(fabric.buildIndex('org1').totalRecords).toBe(1);
  });

  it('buildIndex filters by collectionId', () => {
    fabric.addRecord(makeRecord({ collectionId: 'col1' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', collectionId: 'col2' }));
    expect(fabric.buildIndex('org1', 'col1').totalRecords).toBe(1);
  });

  it('buildIndex avgConfidence is correct', () => {
    fabric.addRecord(makeRecord({ confidence: 60 }));
    fabric.addRecord(makeRecord({ recordId: 'r2', confidence: 80 }));
    expect(fabric.buildIndex('org1', 'col1').avgConfidence).toBe(70);
  });

  it('buildIndex strongestSignal is max confidence×occurrence', () => {
    fabric.addRecord(makeRecord({ confidence: 50, occurrenceCount: 10, continuitySignal: 'Heavy' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', confidence: 90, occurrenceCount: 1, continuitySignal: 'Light' }));
    expect(fabric.buildIndex('org1', 'col1').strongestSignal).toBe('Heavy');
  });

  it('buildIndex strongestSignal is null for empty', () => {
    expect(fabric.buildIndex('org1').strongestSignal).toBeNull();
  });

  it('buildIndex dominantMemoryType by count', () => {
    fabric.addRecord(makeRecord({ memoryType: 'failover-event' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', memoryType: 'failover-event' }));
    fabric.addRecord(makeRecord({ recordId: 'r3', memoryType: 'outage-pattern' }));
    expect(fabric.buildIndex('org1', 'col1').dominantMemoryType).toBe('failover-event');
  });

  it('addOutagePattern and getOutagePattern', () => {
    fabric.addOutagePattern(makeOutagePattern());
    expect(fabric.getOutagePattern('region-cascade-outage')).not.toBeNull();
  });

  it('getOutagePattern returns null for unknown', () => {
    expect(fabric.getOutagePattern('unknown')).toBeNull();
  });

  it('listOutagePatterns returns all', () => {
    fabric.addOutagePattern(makeOutagePattern({ patternKey: 'p1' }));
    fabric.addOutagePattern(makeOutagePattern({ patternKey: 'p2' }));
    expect(fabric.listOutagePatterns()).toHaveLength(2);
  });

  it('registerRetentionPolicy and getRetentionPolicy', () => {
    fabric.registerRetentionPolicy({ policyId: 'pol1', orgId: 'org1', retentionDays: 30, anonymizeAfterDays: 7, requireExplainability: true });
    expect(fabric.getRetentionPolicy('org1')?.retentionDays).toBe(30);
  });

  it('evictExpired removes expired records', () => {
    fabric.addRecord(makeRecord({ retentionExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    fabric.addRecord(makeRecord({ recordId: 'r2' }));
    expect(fabric.evictExpired()).toBe(1);
    expect(fabric.buildIndex('org1', 'col1').totalRecords).toBe(1);
  });
});
