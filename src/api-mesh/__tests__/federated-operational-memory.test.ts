import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedOperationalMemory } from '../federated-operational-memory';
import { OperationalMemoryRecord, AntiPatternMemory } from '../contracts/federated-operational-memory.contracts';

function makeRecord(overrides: Partial<OperationalMemoryRecord> = {}): OperationalMemoryRecord {
  return {
    recordId: 'r1',
    orgId: 'org1',
    memoryKey: 'auth-timeout-pattern',
    signal: 'Auth step times out under load',
    occurrenceCount: 5,
    avgRemedyEffectiveness: 0.7,
    retentionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    isAnonymized: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAntiPattern(overrides: Partial<AntiPatternMemory> = {}): AntiPatternMemory {
  return {
    patternId: 'p1',
    patternKey: 'cascade-retry-storm',
    severity: 'high',
    description: 'Retry storms cascade through dependent steps',
    crossOrgOccurrences: 10,
    recommendedMitigation: 'Add circuit breaker and exponential backoff',
    knownEffectiveRemedies: ['reduce-max-retries', 'add-backoff'],
    firstObservedAt: new Date().toISOString(),
    lastObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedOperationalMemory', () => {
  let memory: FederatedOperationalMemory;

  beforeEach(() => {
    memory = new FederatedOperationalMemory();
    memory._reset();
  });

  it('addRecord and getRecord', () => {
    memory.addRecord(makeRecord());
    expect(memory.getRecord('r1')).not.toBeNull();
  });

  it('listRecords returns all without filter', () => {
    memory.addRecord(makeRecord({ recordId: 'r1' }));
    memory.addRecord(makeRecord({ recordId: 'r2' }));
    expect(memory.listRecords()).toHaveLength(2);
  });

  it('listRecords filters by orgId', () => {
    memory.addRecord(makeRecord({ orgId: 'org1' }));
    memory.addRecord(makeRecord({ recordId: 'r2', orgId: 'org2' }));
    expect(memory.listRecords('org1')).toHaveLength(1);
  });

  it('evictExpired removes expired records', () => {
    memory.addRecord(makeRecord({ retentionExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    const evicted = memory.evictExpired();
    expect(evicted).toBe(1);
    expect(memory.listRecords()).toHaveLength(0);
  });

  it('evictExpired preserves non-expired records', () => {
    memory.addRecord(makeRecord({ retentionExpiresAt: new Date(Date.now() + 86400000).toISOString() }));
    const evicted = memory.evictExpired();
    expect(evicted).toBe(0);
    expect(memory.listRecords()).toHaveLength(1);
  });

  it('addAntiPattern and getAntiPattern', () => {
    memory.addAntiPattern(makeAntiPattern());
    expect(memory.getAntiPattern('cascade-retry-storm')).not.toBeNull();
  });

  it('listAntiPatterns returns all without filter', () => {
    memory.addAntiPattern(makeAntiPattern({ severity: 'high' }));
    memory.addAntiPattern(makeAntiPattern({ patternKey: 'p2', severity: 'critical' }));
    expect(memory.listAntiPatterns()).toHaveLength(2);
  });

  it('listAntiPatterns filters by severity', () => {
    memory.addAntiPattern(makeAntiPattern({ severity: 'high' }));
    memory.addAntiPattern(makeAntiPattern({ patternKey: 'p2', severity: 'critical' }));
    expect(memory.listAntiPatterns('critical')).toHaveLength(1);
  });

  it('registerRetentionPolicy and getRetentionPolicy', () => {
    memory.registerRetentionPolicy({ policyId: 'pol1', orgId: 'org1', retentionDays: 30, anonymizeAfterDays: 7, blockSensitiveSignals: [] });
    expect(memory.getRetentionPolicy('org1')?.retentionDays).toBe(30);
  });
});
