// src/api-analytics/__tests__/execution-trend-aggregator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionTrendAggregator } from '../execution-trend-aggregator';
import type { TrendSample } from '../contracts/execution-trends.contracts';

function makeSample(collectionId: string, passed: number, failed: number, retries = 0, durationMs = 1000): TrendSample {
  return {
    collectionId, runId: `run-${Math.random()}`,
    sampledAt: new Date().toISOString(),
    passed, failed, skipped: 0,
    totalSteps: passed + failed,
    durationMs, retriesTriggered: retries, teardownEvents: 0,
  };
}

describe('ExecutionTrendAggregator', () => {
  let agg: ExecutionTrendAggregator;
  beforeEach(() => { agg = new ExecutionTrendAggregator(); });

  it('aggregate: returns null for empty collection', () => {
    expect(agg.aggregate('col-1')).toBeNull();
  });

  it('aggregate: computes avgPassRate correctly', () => {
    agg.record(makeSample('col-1', 8, 2));
    agg.record(makeSample('col-1', 6, 4));
    const trend = agg.aggregate('col-1');
    expect(trend?.avgPassRate).toBeCloseTo(0.7, 1);
  });

  it('aggregate: p95DurationMs with single sample = that sample', () => {
    agg.record(makeSample('col-1', 5, 0, 0, 2000));
    const trend = agg.aggregate('col-1');
    expect(trend?.p95DurationMs).toBe(2000);
  });

  it('aggregate: flakinessScore > 0 for mixed runs', () => {
    agg.record(makeSample('col-1', 8, 2));
    agg.record(makeSample('col-1', 10, 0));
    const trend = agg.aggregate('col-1');
    expect(trend?.flakinessScore).toBeGreaterThan(0);
  });

  it('listCollectionIds: includes recorded collections', () => {
    agg.record(makeSample('col-a', 5, 0));
    agg.record(makeSample('col-b', 3, 1));
    expect(agg.listCollectionIds()).toContain('col-a');
    expect(agg.listCollectionIds()).toContain('col-b');
  });

  it('evict: removes old samples', () => {
    const oldSample: TrendSample = { ...makeSample('col-1', 5, 0), sampledAt: new Date(Date.now() - 100_000).toISOString() };
    agg.record(oldSample);
    const removed = agg.evict(50_000);
    expect(removed).toBe(1);
    expect(agg.aggregate('col-1')).toBeNull();
  });
});
