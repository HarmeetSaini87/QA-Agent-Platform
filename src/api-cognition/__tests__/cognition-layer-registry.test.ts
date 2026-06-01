import { describe, it, expect, beforeEach } from 'vitest';
import { CognitionLayerRegistry } from '../cognition-layer-registry';
import { CognitionMemoryRecord } from '../contracts/cognition-layer.contracts';

function makeRecord(overrides: Partial<CognitionMemoryRecord> = {}): CognitionMemoryRecord {
  return {
    recordId: 'r1',
    collectionId: 'col1',
    memoryType: 'orchestration-cognition',
    signal: 'High retry rate on auth step',
    reasoning: 'Auth step retries exceed 3x threshold — likely environment instability.',
    confidence: 80,
    confidenceLevel: 'high',
    evidenceSources: ['run-1', 'run-2'],
    isExplainable: true,
    createdAt: new Date().toISOString(),
    governanceNote: 'Advisory only',
    ...overrides,
  };
}

describe('CognitionLayerRegistry', () => {
  let registry: CognitionLayerRegistry;

  beforeEach(() => {
    registry = new CognitionLayerRegistry();
    registry._reset();
  });

  it('addRecord and getRecord', () => {
    registry.addRecord(makeRecord());
    expect(registry.getRecord('r1')?.recordId).toBe('r1');
  });

  it('getRecord returns null for unknown', () => {
    expect(registry.getRecord('unknown')).toBeNull();
  });

  it('listRecords filters by collectionId', () => {
    registry.addRecord(makeRecord({ collectionId: 'col1' }));
    registry.addRecord(makeRecord({ recordId: 'r2', collectionId: 'col2' }));
    expect(registry.listRecords('col1')).toHaveLength(1);
  });

  it('listRecords filters by memoryType', () => {
    registry.addRecord(makeRecord({ memoryType: 'orchestration-cognition' }));
    registry.addRecord(makeRecord({ recordId: 'r2', memoryType: 'replay-reasoning' }));
    expect(registry.listRecords('col1', 'orchestration-cognition')).toHaveLength(1);
  });

  it('summarize returns zero values for empty collection', () => {
    const s = registry.summarize('empty');
    expect(s.totalCognitionRecords).toBe(0);
    expect(s.dominantMemoryType).toBeNull();
    expect(s.avgConfidence).toBe(0);
  });

  it('summarize returns correct totalCognitionRecords', () => {
    registry.addRecord(makeRecord({ recordId: 'r1' }));
    registry.addRecord(makeRecord({ recordId: 'r2' }));
    expect(registry.summarize('col1').totalCognitionRecords).toBe(2);
  });

  it('summarize dominantMemoryType reflects most common type', () => {
    registry.addRecord(makeRecord({ recordId: 'r1', memoryType: 'replay-reasoning' }));
    registry.addRecord(makeRecord({ recordId: 'r2', memoryType: 'replay-reasoning' }));
    registry.addRecord(makeRecord({ recordId: 'r3', memoryType: 'orchestration-cognition' }));
    expect(registry.summarize('col1').dominantMemoryType).toBe('replay-reasoning');
  });

  it('summarize avgConfidence is 0–100', () => {
    registry.addRecord(makeRecord({ confidence: 60 }));
    registry.addRecord(makeRecord({ recordId: 'r2', confidence: 80 }));
    const s = registry.summarize('col1');
    expect(s.avgConfidence).toBe(70);
  });

  it('summarize topSignals contains up to 3 entries', () => {
    for (let i = 0; i < 5; i++) {
      registry.addRecord(makeRecord({ recordId: `r${i}`, signal: `Signal ${i}`, confidence: 50 + i }));
    }
    expect(registry.summarize('col1').topSignals.length).toBeLessThanOrEqual(3);
  });
});
