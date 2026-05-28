// src/api-performance/__tests__/execution-profiler.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { withProfilingSync, withProfilingAsync, recordSpan } from '../profiling/execution-profiler';
import { globalProfilerRegistry } from '../profiling/profiler-registry';

describe('execution-profiler', () => {
  beforeEach(() => globalProfilerRegistry.clear());

  it('withProfilingSync: records span and returns fn result', () => {
    const result = withProfilingSync('graph-projection', 'test-label', () => 42);
    expect(result).toBe(42);

    const snapshot = globalProfilerRegistry.snapshot();
    expect(snapshot.spanCount).toBe(1);
    expect(snapshot.recentSpans[0].phase).toBe('graph-projection');
    expect(snapshot.recentSpans[0].label).toBe('test-label');
    expect(snapshot.recentSpans[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('withProfilingSync: records span even when fn throws', () => {
    expect(() =>
      withProfilingSync('execution', 'throwing', () => { throw new Error('boom'); })
    ).toThrow('boom');

    expect(globalProfilerRegistry.snapshot().spanCount).toBe(1);
  });

  it('withProfilingAsync: records span for async fn', async () => {
    const result = await withProfilingAsync('replay-synthesis', 'async-label', async () => 'done');
    expect(result).toBe('done');

    const snapshot = globalProfilerRegistry.snapshot();
    expect(snapshot.spanCount).toBe(1);
    expect(snapshot.recentSpans[0].phase).toBe('replay-synthesis');
  });

  it('recordSpan: manually recorded span appears in registry', () => {
    recordSpan('polling', 'manual', 50, { collectionId: 'col1' });
    const snapshot = globalProfilerRegistry.snapshot();
    expect(snapshot.spanCount).toBe(1);
    expect(snapshot.recentSpans[0].durationMs).toBe(50);
    expect(snapshot.recentSpans[0].metadata?.collectionId).toBe('col1');
  });

  it('phaseStats: aggregates correctly across multiple spans', () => {
    withProfilingSync('polling', 'p1', () => {});
    withProfilingSync('polling', 'p2', () => {});
    withProfilingSync('graph-projection', 'g1', () => {});

    const { phaseStats } = globalProfilerRegistry.snapshot();
    expect(phaseStats['polling'].sampleCount).toBe(2);
    expect(phaseStats['graph-projection'].sampleCount).toBe(1);
  });
});
