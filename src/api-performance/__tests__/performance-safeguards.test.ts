// src/api-performance/__tests__/performance-safeguards.test.ts
import { describe, it, expect } from 'vitest';
import { PerformanceSafeguards } from '../safeguards/performance-safeguards';
import type { SafeguardThresholds } from '../contracts/safeguard.contracts';

const TEST_THRESHOLDS: SafeguardThresholds = {
  maxGraphNodeCountWarning: 10,
  maxGraphNodeCountCritical: 50,
  maxReplayEventsWarning: 100,
  maxReplayEventsCritical: 500,
  maxPollsPerMinuteWarning: 60,
  maxRetryRatePerMinuteWarning: 20,
  maxHeapUsedMbWarning: 256,
  projectionCacheMissRateWarningPct: 80,
};

describe('PerformanceSafeguards', () => {
  const sg = new PerformanceSafeguards(TEST_THRESHOLDS);

  it('no violation below thresholds', () => {
    expect(sg.checkGraphSize(5)).toBeNull();
    expect(sg.checkReplayEventGrowth(50)).toBeNull();
    expect(sg.checkPollingOverload(30)).toBeNull();
    expect(sg.checkRetryStorm(10)).toBeNull();
    expect(sg.checkMemoryPressure(100)).toBeNull();
  });

  it('warning at warning threshold', () => {
    const v = sg.checkGraphSize(10);
    expect(v?.severity).toBe('warning');
    expect(v?.code).toBe('LARGE_GRAPH_NODE_COUNT');
  });

  it('critical above critical threshold', () => {
    const v = sg.checkGraphSize(60);
    expect(v?.severity).toBe('critical');
  });

  it('all violations include advisoryNote', () => {
    const v = sg.checkPollingOverload(999)!;
    expect(v.advisoryNote).toBeTruthy();
  });

  it('runAll: healthy=true when only info violations', () => {
    const result = sg.runAll({
      graphNodeCount: 5,
      replayEventCount: 50,
      pollsPerMinute: 10,
      retryRatePerMinute: 5,
      heapUsedMb: 100,
      cacheStats: { hits: 2, misses: 0, evictions: 0, size: 1, hitRatePct: 100 },
    });
    expect(result.healthy).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('runAll: healthy=false when warning-level violation present', () => {
    const result = sg.runAll({
      graphNodeCount: 60,
      replayEventCount: 0,
      pollsPerMinute: 0,
      retryRatePerMinute: 0,
      heapUsedMb: 0,
    });
    expect(result.healthy).toBe(false);
    expect(result.violations.some(v => v.code === 'LARGE_GRAPH_NODE_COUNT')).toBe(true);
  });
});
