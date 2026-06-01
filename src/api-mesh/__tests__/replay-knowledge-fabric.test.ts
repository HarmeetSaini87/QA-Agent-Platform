import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayKnowledgeFabric } from '../replay-knowledge-fabric';
import { ReplayKnowledgeEntry } from '../contracts/replay-knowledge-fabric.contracts';

function makeEntry(overrides: Partial<ReplayKnowledgeEntry> = {}): ReplayKnowledgeEntry {
  return {
    entryId: 'e1',
    memoryType: 'rca-recurring',
    collectionId: 'col1',
    signal: 'Auth timeout on step 3',
    occurrenceCount: 5,
    avgConfidence: 80,
    lastObservedAt: new Date().toISOString(),
    isAnonymized: true,
    ...overrides,
  };
}

describe('ReplayKnowledgeFabric', () => {
  let fabric: ReplayKnowledgeFabric;

  beforeEach(() => {
    fabric = new ReplayKnowledgeFabric();
    fabric._reset();
  });

  it('addEntry and getEntry', () => {
    fabric.addEntry(makeEntry());
    expect(fabric.getEntry('e1')?.entryId).toBe('e1');
  });

  it('getEntry returns null for unknown', () => {
    expect(fabric.getEntry('unknown')).toBeNull();
  });

  it('listEntries filters by collectionId', () => {
    fabric.addEntry(makeEntry({ collectionId: 'col1' }));
    fabric.addEntry(makeEntry({ entryId: 'e2', collectionId: 'col2' }));
    expect(fabric.listEntries('col1')).toHaveLength(1);
  });

  it('listEntries filters by memoryType', () => {
    fabric.addEntry(makeEntry({ memoryType: 'rca-recurring' }));
    fabric.addEntry(makeEntry({ entryId: 'e2', memoryType: 'retry-optimization' }));
    expect(fabric.listEntries('col1', 'rca-recurring')).toHaveLength(1);
  });

  it('buildIndex returns correct totalEntries', () => {
    fabric.addEntry(makeEntry({ entryId: 'e1' }));
    fabric.addEntry(makeEntry({ entryId: 'e2', memoryType: 'retry-optimization' }));
    const idx = fabric.buildIndex('col1');
    expect(idx.totalEntries).toBe(2);
  });

  it('buildIndex identifies strongest signal', () => {
    fabric.addEntry(makeEntry({ entryId: 'e1', signal: 'Weak signal', occurrenceCount: 1, avgConfidence: 50 }));
    fabric.addEntry(makeEntry({ entryId: 'e2', signal: 'Strong signal', occurrenceCount: 10, avgConfidence: 90 }));
    const idx = fabric.buildIndex('col1');
    expect(idx.strongestSignal).toBe('Strong signal');
  });

  it('buildIndex strongestSignal is null for empty', () => {
    const idx = fabric.buildIndex('empty-col');
    expect(idx.strongestSignal).toBeNull();
  });

  it('recordOptimizationMemory and listOptimizationMemory', () => {
    fabric.recordOptimizationMemory({
      collectionId: 'col1',
      stepId: 's1',
      retryPatternHash: 'abc',
      recommendedAction: 'reduce retries',
      effectivenessScore: 0.8,
      memorizedAt: new Date().toISOString(),
    });
    expect(fabric.listOptimizationMemory('col1')).toHaveLength(1);
  });

  it('buildIndex entryCountByType is correct', () => {
    fabric.addEntry(makeEntry({ entryId: 'e1', memoryType: 'rca-recurring' }));
    fabric.addEntry(makeEntry({ entryId: 'e2', memoryType: 'rca-recurring' }));
    fabric.addEntry(makeEntry({ entryId: 'e3', memoryType: 'retry-optimization' }));
    const idx = fabric.buildIndex('col1');
    expect(idx.entryCountByType['rca-recurring']).toBe(2);
    expect(idx.entryCountByType['retry-optimization']).toBe(1);
  });
});
