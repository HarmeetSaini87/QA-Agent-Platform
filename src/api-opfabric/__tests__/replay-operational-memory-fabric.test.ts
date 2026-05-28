import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayOperationalMemoryFabric } from '../replay-operational-memory-fabric';
import type { ReplayOperationalMemoryEntry } from '../contracts/replay-operational-memory-federation.contracts';

function makeEntry(overrides: Partial<ReplayOperationalMemoryEntry> = {}): ReplayOperationalMemoryEntry {
  return {
    entryId: 'e1', collectionId: 'col1',
    federationType: 'retry-stabilization',
    memorySignal: 'Retry storm pattern',
    reasoningTrace: ['High retry rate', 'Step A cascades'],
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

describe('ReplayOperationalMemoryFabric', () => {
  let fabric: ReplayOperationalMemoryFabric;

  beforeEach(() => {
    fabric = new ReplayOperationalMemoryFabric();
    fabric._reset();
  });

  it('addEntry and buildIndex count', () => {
    fabric.addEntry(makeEntry());
    const idx = fabric.buildIndex('org1', 'col1');
    expect(idx.totalEntries).toBe(1);
  });

  it('buildIndex filters by collectionId', () => {
    fabric.addEntry(makeEntry({ collectionId: 'col1' }));
    fabric.addEntry(makeEntry({ entryId: 'e2', collectionId: 'col2' }));
    expect(fabric.buildIndex('org1', 'col1').totalEntries).toBe(1);
  });

  it('buildIndex avgConfidence is correct', () => {
    fabric.addEntry(makeEntry({ confidence: 60 }));
    fabric.addEntry(makeEntry({ entryId: 'e2', confidence: 80 }));
    expect(fabric.buildIndex('org1', 'col1').avgConfidence).toBe(70);
  });

  it('buildIndex strongestSignal is max confidence×occurrenceCount entry', () => {
    fabric.addEntry(makeEntry({ confidence: 50, occurrenceCount: 10, memorySignal: 'Heavy' }));
    fabric.addEntry(makeEntry({ entryId: 'e2', confidence: 90, occurrenceCount: 1, memorySignal: 'Light' }));
    // 50×10=500 vs 90×1=90 → Heavy wins
    expect(fabric.buildIndex('org1', 'col1').strongestSignal).toBe('Heavy');
  });

  it('buildIndex strongestSignal is null for empty', () => {
    expect(fabric.buildIndex('org1').strongestSignal).toBeNull();
  });

  it('buildIndex entriesByFederationType aggregates', () => {
    fabric.addEntry(makeEntry({ federationType: 'retry-stabilization' }));
    fabric.addEntry(makeEntry({ entryId: 'e2', federationType: 'retry-stabilization' }));
    fabric.addEntry(makeEntry({ entryId: 'e3', federationType: 'sla-governance' }));
    const idx = fabric.buildIndex('org1', 'col1');
    expect(idx.entriesByFederationType['retry-stabilization']).toBe(2);
    expect(idx.entriesByFederationType['sla-governance']).toBe(1);
  });

  it('addRemediationMemory and listRemediationMemory', () => {
    fabric.addRemediationMemory({
      memoryId: 'm1', collectionId: 'col1', runId: 'run1',
      remediationOutcome: 'resolved', effectivenessScore: 85,
      reasoningChain: ['Detected retry storm', 'Applied backoff'], isExplainable: true,
      createdAt: new Date().toISOString(),
    });
    expect(fabric.listRemediationMemory('col1')).toHaveLength(1);
  });

  it('listRemediationMemory filters by collectionId', () => {
    fabric.addRemediationMemory({
      memoryId: 'm1', collectionId: 'col1', runId: 'r1',
      remediationOutcome: 'ok', effectivenessScore: 80,
      reasoningChain: [], isExplainable: true, createdAt: new Date().toISOString(),
    });
    expect(fabric.listRemediationMemory('col2')).toHaveLength(0);
  });

  it('addRetryStabilizationRecord and getRetryStabilizationRecord', () => {
    fabric.addRetryStabilizationRecord({
      recordId: 'r1', patternKey: 'cascade-retry',
      retrySignal: 'Cascading retries', crossOrgFrequency: 5,
      stabilizationHints: ['add-backoff'], avgEffectiveness: 0.75, isAnonymized: true,
    });
    expect(fabric.getRetryStabilizationRecord('cascade-retry')).not.toBeNull();
  });

  it('getRetryStabilizationRecord returns null for unknown', () => {
    expect(fabric.getRetryStabilizationRecord('unknown')).toBeNull();
  });

  it('evictExpired removes expired entries', () => {
    fabric.addEntry(makeEntry({ retentionExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    fabric.addEntry(makeEntry({ entryId: 'e2' }));
    const count = fabric.evictExpired();
    expect(count).toBe(1);
    expect(fabric.buildIndex('org1', 'col1').totalEntries).toBe(1);
  });
});
