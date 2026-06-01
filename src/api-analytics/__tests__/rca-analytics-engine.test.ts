// src/api-analytics/__tests__/rca-analytics-engine.test.ts
import { describe, it, expect } from 'vitest';
import { RcaAnalyticsEngine } from '../rca-analytics-engine';

const ts = () => new Date().toISOString();

describe('RcaAnalyticsEngine', () => {
  const engine = new RcaAnalyticsEngine();

  it('computeFailureTrends: returns empty for all-passing steps', () => {
    const outcomes = [{ stepId: 's1', stepName: 'Step 1', failed: false, retries: 0, timestamp: ts() }];
    expect(engine.computeFailureTrends('col-1', outcomes)).toHaveLength(0);
  });

  it('computeFailureTrends: escalating pattern for high failure rate', () => {
    const outcomes = Array.from({ length: 10 }, (_, i) => ({
      stepId: 's1', stepName: 'S1', failed: i < 8, retries: 0, timestamp: ts(),
    }));
    const trends = engine.computeFailureTrends('col-1', outcomes);
    expect(trends[0].recurrencePattern).toBe('escalating');
    expect(trends[0].failureCount).toBe(8);
  });

  it('computeFailureTrends: sorted by instability score descending', () => {
    const outcomes = [
      { stepId: 's1', stepName: 'S1', failed: true, retries: 2, timestamp: ts() },
      { stepId: 's2', stepName: 'S2', failed: true, retries: 0, timestamp: ts() },
      { stepId: 's2', stepName: 'S2', failed: false, retries: 0, timestamp: ts() },
    ];
    const trends = engine.computeFailureTrends('col-1', outcomes);
    expect(trends[0].dependencyInstabilityScore).toBeGreaterThanOrEqual(trends[1]?.dependencyInstabilityScore ?? 0);
  });

  it('identifyRetryHotspots: storm flagged at or above threshold', () => {
    const hotspots = engine.identifyRetryHotspots('col-1', [{ stepId: 's1', retriesInWindow: 5, runsInWindow: 8 }]);
    expect(hotspots[0].isRetryStorm).toBe(true);
    expect(hotspots[0].advisoryNote).toContain('Retry storm');
  });

  it('identifyRetryHotspots: returns empty for zero retries', () => {
    expect(engine.identifyRetryHotspots('col-1', [{ stepId: 's1', retriesInWindow: 0, runsInWindow: 5 }])).toHaveLength(0);
  });

  it('identifyTeardownInstability: flags failing teardown steps', () => {
    const outcomes = [
      { stepId: 'td-1', failed: true, timestamp: ts() },
      { stepId: 'td-1', failed: false, timestamp: ts() },
      { stepId: 'td-1', failed: true, timestamp: ts() },
    ];
    const records = engine.identifyTeardownInstability('col-1', outcomes);
    expect(records[0].stepId).toBe('td-1');
    expect(records[0].teardownFailureRate).toBeCloseTo(2 / 3, 1);
  });
});
