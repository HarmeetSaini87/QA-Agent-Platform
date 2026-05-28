import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedReliabilityMemory } from '../federated-reliability-memory';
import type { ReliabilityMemoryRecord } from '../contracts/federated-reliability-memory.contracts';
import type { ResilienceAntiPatternRecord } from '../contracts/federated-reliability-memory.contracts';

function makeRecord(overrides: Partial<ReliabilityMemoryRecord> = {}): ReliabilityMemoryRecord {
  const future = new Date(Date.now() + 86400000).toISOString();
  return {
    recordId: 'r1', collectionId: 'col1',
    memoryType: 'retry-pattern',
    signal: 'Retry storm', reasoning: 'Retry cascade detected',
    confidence: 75, isExplainable: true,
    createdAt: new Date().toISOString(),
    retentionExpiresAt: future,
    governanceNote: 'Advisory',
    ...overrides,
  };
}

function makeAntiPattern(overrides: Partial<ResilienceAntiPatternRecord> = {}): ResilienceAntiPatternRecord {
  return {
    patternId: 'p1', patternKey: 'cascade-retry',
    resilienceSignal: 'Retries cascade across dependent steps',
    reasoningChain: ['Step A fails', 'Step B retries'],
    crossOrgFrequency: 5,
    severity: 'high',
    knownEffectiveRemedies: ['circuit-breaker', 'backoff'],
    confidenceScore: 80,
    firstObservedAt: new Date().toISOString(),
    lastObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedReliabilityMemory', () => {
  let memory: FederatedReliabilityMemory;

  beforeEach(() => {
    memory = new FederatedReliabilityMemory();
    memory._reset();
  });

  it('addMemoryRecord and buildIndex count', () => {
    memory.addMemoryRecord(makeRecord());
    const idx = memory.buildIndex('org1', 'col1');
    expect(idx.totalRecords).toBe(1);
  });

  it('buildIndex strongestReasoning is top confidence record', () => {
    memory.addMemoryRecord(makeRecord({ confidence: 60, reasoning: 'Weak' }));
    memory.addMemoryRecord(makeRecord({ recordId: 'r2', confidence: 90, reasoning: 'Strong' }));
    expect(memory.buildIndex('org1', 'col1').strongestReasoning).toBe('Strong');
  });

  it('buildIndex strongestReasoning is null for empty', () => {
    expect(memory.buildIndex('org1').strongestReasoning).toBeNull();
  });

  it('buildIndex filters by collectionId', () => {
    memory.addMemoryRecord(makeRecord({ collectionId: 'col1' }));
    memory.addMemoryRecord(makeRecord({ recordId: 'r2', collectionId: 'col2' }));
    expect(memory.buildIndex('org1', 'col1').totalRecords).toBe(1);
  });

  it('buildIndex avgConfidence is correct', () => {
    memory.addMemoryRecord(makeRecord({ confidence: 60 }));
    memory.addMemoryRecord(makeRecord({ recordId: 'r2', confidence: 80 }));
    expect(memory.buildIndex('org1', 'col1').avgConfidence).toBe(70);
  });

  it('buildIndex recordsByMemoryType aggregates correctly', () => {
    memory.addMemoryRecord(makeRecord({ memoryType: 'retry-pattern' }));
    memory.addMemoryRecord(makeRecord({ recordId: 'r2', memoryType: 'retry-pattern' }));
    memory.addMemoryRecord(makeRecord({ recordId: 'r3', memoryType: 'sla-breach' }));
    const idx = memory.buildIndex('org1', 'col1');
    expect(idx.recordsByMemoryType['retry-pattern']).toBe(2);
    expect(idx.recordsByMemoryType['sla-breach']).toBe(1);
  });

  it('addAntiPattern and getAntiPattern', () => {
    memory.addAntiPattern(makeAntiPattern());
    expect(memory.getAntiPattern('cascade-retry')).not.toBeNull();
  });

  it('getAntiPattern returns null for unknown', () => {
    expect(memory.getAntiPattern('unknown')).toBeNull();
  });

  it('listAntiPatterns returns all', () => {
    memory.addAntiPattern(makeAntiPattern({ patternKey: 'p1' }));
    memory.addAntiPattern(makeAntiPattern({ patternKey: 'p2' }));
    expect(memory.listAntiPatterns()).toHaveLength(2);
  });

  it('registerRetentionPolicy and getRetentionPolicy', () => {
    memory.registerRetentionPolicy({ policyId: 'pol1', orgId: 'org1', retentionDays: 30, anonymizeAfterDays: 7, requireExplainability: true });
    expect(memory.getRetentionPolicy('org1')?.retentionDays).toBe(30);
  });

  it('evictExpired removes expired records', () => {
    const expired = makeRecord({ retentionExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const valid = makeRecord({ recordId: 'r2' });
    memory.addMemoryRecord(expired);
    memory.addMemoryRecord(valid);
    const count = memory.evictExpired();
    expect(count).toBe(1);
    expect(memory.buildIndex('org1', 'col1').totalRecords).toBe(1);
  });
});
