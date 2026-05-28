import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedCognitionMemory } from '../federated-cognition-memory';
import { CognitionMemoryRecord } from '../contracts/cognition-layer.contracts';
import { AntiPatternCognitionRecord } from '../contracts/federated-cognition-memory.contracts';

function makeRecord(overrides: Partial<CognitionMemoryRecord> = {}): CognitionMemoryRecord {
  return {
    recordId: 'r1', collectionId: 'col1',
    memoryType: 'orchestration-cognition',
    signal: 'Auth timeout', reasoning: 'Environment instability detected.',
    confidence: 75, confidenceLevel: 'high',
    evidenceSources: [], isExplainable: true,
    createdAt: new Date().toISOString(), governanceNote: 'Advisory',
    ...overrides,
  };
}

function makeAntiPattern(overrides: Partial<AntiPatternCognitionRecord> = {}): AntiPatternCognitionRecord {
  return {
    patternId: 'p1', patternKey: 'cascade-retry',
    cognitionSignal: 'Retries cascade across dependent steps',
    reasoningChain: ['Step A fails', 'Step B depends on A', 'Step B also retries'],
    crossOrgFrequency: 8,
    recommendedCognitionAction: 'Add circuit breaker',
    knownEffectiveReasonings: ['reduce-retries', 'add-backoff'],
    confidenceScore: 85,
    firstObservedAt: new Date().toISOString(),
    lastObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedCognitionMemory', () => {
  let memory: FederatedCognitionMemory;

  beforeEach(() => {
    memory = new FederatedCognitionMemory();
    memory._reset();
  });

  it('addCognitionRecord and buildIndex count', () => {
    memory.addCognitionRecord(makeRecord());
    const idx = memory.buildIndex('org1', 'col1');
    expect(idx.totalRecords).toBe(1);
  });

  it('buildIndex strongestReasoning is top confidence reasoning', () => {
    memory.addCognitionRecord(makeRecord({ confidence: 60, reasoning: 'Weak' }));
    memory.addCognitionRecord(makeRecord({ recordId: 'r2', confidence: 90, reasoning: 'Strong' }));
    const idx = memory.buildIndex('org1', 'col1');
    expect(idx.strongestReasoning).toBe('Strong');
  });

  it('buildIndex strongestReasoning is null for empty', () => {
    expect(memory.buildIndex('org1').strongestReasoning).toBeNull();
  });

  it('buildIndex filters by collectionId', () => {
    memory.addCognitionRecord(makeRecord({ collectionId: 'col1' }));
    memory.addCognitionRecord(makeRecord({ recordId: 'r2', collectionId: 'col2' }));
    expect(memory.buildIndex('org1', 'col1').totalRecords).toBe(1);
  });

  it('buildIndex avgConfidence is correct', () => {
    memory.addCognitionRecord(makeRecord({ confidence: 60 }));
    memory.addCognitionRecord(makeRecord({ recordId: 'r2', confidence: 80 }));
    expect(memory.buildIndex('org1', 'col1').avgConfidence).toBe(70);
  });

  it('addAntiPatternCognition and getAntiPatternCognition', () => {
    memory.addAntiPatternCognition(makeAntiPattern());
    expect(memory.getAntiPatternCognition('cascade-retry')).not.toBeNull();
  });

  it('getAntiPatternCognition returns null for unknown', () => {
    expect(memory.getAntiPatternCognition('unknown')).toBeNull();
  });

  it('listAntiPatternCognitions returns all', () => {
    memory.addAntiPatternCognition(makeAntiPattern({ patternKey: 'p1' }));
    memory.addAntiPatternCognition(makeAntiPattern({ patternKey: 'p2' }));
    expect(memory.listAntiPatternCognitions()).toHaveLength(2);
  });

  it('registerRetentionPolicy and getRetentionPolicy', () => {
    memory.registerRetentionPolicy({ policyId: 'pol1', orgId: 'org1', retentionDays: 30, anonymizeAfterDays: 7, requireExplainability: true });
    expect(memory.getRetentionPolicy('org1')?.retentionDays).toBe(30);
  });
});
