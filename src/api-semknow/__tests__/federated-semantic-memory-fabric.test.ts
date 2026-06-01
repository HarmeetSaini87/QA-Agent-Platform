import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedSemanticMemoryFabric } from '../federated-semantic-memory-fabric';
import type { SemanticMemoryRecord } from '../contracts/federated-semantic-memory.contracts';
import type { OrchestrationAntiPatternSemantics } from '../contracts/federated-semantic-memory.contracts';

function makeRecord(overrides: Partial<SemanticMemoryRecord> = {}): SemanticMemoryRecord {
  return {
    recordId: 'r1', collectionId: 'col1',
    memoryType: 'retry-semantic',
    semanticSignal: 'Retry cascade semantics',
    contextualReasoning: 'Cascade dependency failure semantic pattern detected',
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

function makeAntiPattern(overrides: Partial<OrchestrationAntiPatternSemantics> = {}): OrchestrationAntiPatternSemantics {
  return {
    patternId: 'p1', patternKey: 'cascade-semantic',
    semanticDescription: 'Retry cascade with semantic propagation',
    contextualReasoningChain: ['Step A fails', 'Semantic dependency triggers Step B'],
    crossOrgFrequency: 6,
    semanticSeverity: 'high',
    knownSemanticRemedies: ['semantic-circuit-breaker'],
    confidenceScore: 82,
    isAnonymized: true,
    firstObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedSemanticMemoryFabric', () => {
  let fabric: FederatedSemanticMemoryFabric;

  beforeEach(() => {
    fabric = new FederatedSemanticMemoryFabric();
    fabric._reset();
  });

  it('addRecord and buildIndex count', () => {
    fabric.addRecord(makeRecord());
    expect(fabric.buildIndex('org1', 'col1').totalRecords).toBe(1);
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

  it('buildIndex strongestSemanticSignal is max confidence×occurrence entry', () => {
    fabric.addRecord(makeRecord({ confidence: 50, occurrenceCount: 10, semanticSignal: 'Heavy' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', confidence: 90, occurrenceCount: 1, semanticSignal: 'Light' }));
    expect(fabric.buildIndex('org1', 'col1').strongestSemanticSignal).toBe('Heavy');
  });

  it('buildIndex strongestSemanticSignal is null for empty', () => {
    expect(fabric.buildIndex('org1').strongestSemanticSignal).toBeNull();
  });

  it('buildIndex dominantMemoryType by count', () => {
    fabric.addRecord(makeRecord({ memoryType: 'retry-semantic' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', memoryType: 'retry-semantic' }));
    fabric.addRecord(makeRecord({ recordId: 'r3', memoryType: 'sla-semantic' }));
    expect(fabric.buildIndex('org1', 'col1').dominantMemoryType).toBe('retry-semantic');
  });

  it('buildIndex recordsByMemoryType aggregates', () => {
    fabric.addRecord(makeRecord({ memoryType: 'retry-semantic' }));
    fabric.addRecord(makeRecord({ recordId: 'r2', memoryType: 'sla-semantic' }));
    const idx = fabric.buildIndex('org1', 'col1');
    expect(idx.recordsByMemoryType['retry-semantic']).toBe(1);
    expect(idx.recordsByMemoryType['sla-semantic']).toBe(1);
  });

  it('addAntiPatternSemantics and getAntiPatternSemantics', () => {
    fabric.addAntiPatternSemantics(makeAntiPattern());
    expect(fabric.getAntiPatternSemantics('cascade-semantic')).not.toBeNull();
  });

  it('getAntiPatternSemantics returns null for unknown', () => {
    expect(fabric.getAntiPatternSemantics('unknown')).toBeNull();
  });

  it('listAntiPatternSemantics returns all', () => {
    fabric.addAntiPatternSemantics(makeAntiPattern({ patternKey: 'p1' }));
    fabric.addAntiPatternSemantics(makeAntiPattern({ patternKey: 'p2' }));
    expect(fabric.listAntiPatternSemantics()).toHaveLength(2);
  });

  it('registerRetentionPolicy and getRetentionPolicy', () => {
    fabric.registerRetentionPolicy({ policyId: 'pol1', orgId: 'org1', retentionDays: 30, requireExplainability: true, anonymizeAfterDays: 7 });
    expect(fabric.getRetentionPolicy('org1')?.retentionDays).toBe(30);
  });

  it('evictExpired removes expired records', () => {
    fabric.addRecord(makeRecord({ retentionExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    fabric.addRecord(makeRecord({ recordId: 'r2' }));
    const count = fabric.evictExpired();
    expect(count).toBe(1);
    expect(fabric.buildIndex('org1', 'col1').totalRecords).toBe(1);
  });
});
