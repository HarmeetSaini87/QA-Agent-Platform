// src/api-analytics/execution-trend-aggregator.ts
// Phase E Step 7: Aggregates execution trend samples. Observational only — no runtime coupling.

import type {
  IExecutionTrendAggregator,
  TrendSample,
  ExecutionTrendWindow,
} from './contracts/execution-trends.contracts';

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export class ExecutionTrendAggregator implements IExecutionTrendAggregator {
  private readonly _samples = new Map<string, TrendSample[]>();

  record(sample: TrendSample): void {
    const list = this._samples.get(sample.collectionId) ?? [];
    list.push(sample);
    this._samples.set(sample.collectionId, list);
  }

  aggregate(collectionId: string, windowMs = DEFAULT_WINDOW_MS): ExecutionTrendWindow | null {
    const all = this._samples.get(collectionId);
    if (!all || all.length === 0) return null;

    const cutoff = Date.now() - windowMs;
    const samples = all.filter(s => new Date(s.sampledAt).getTime() >= cutoff);
    if (samples.length === 0) return null;

    const totalStepsSum = samples.reduce((a, s) => a + s.totalSteps, 0);
    const passedSum = samples.reduce((a, s) => a + s.passed, 0);
    const failedSum = samples.reduce((a, s) => a + s.failed, 0);
    const retriesSum = samples.reduce((a, s) => a + s.retriesTriggered, 0);
    const durations = samples.map(s => s.durationMs).sort((a, b) => a - b);

    const avgPassRate = totalStepsSum > 0 ? passedSum / totalStepsSum : 0;
    const avgFailRate = totalStepsSum > 0 ? failedSum / totalStepsSum : 0;
    const avgRetryRate = totalStepsSum > 0 ? retriesSum / totalStepsSum : 0;
    const avgDurationMs = durations.reduce((a, b) => a + b, 0) / (durations.length || 1);
    const p95DurationMs = percentile(durations, 95);

    // Flakiness: runs with both passes and failures
    const flakyRuns = samples.filter(s => s.passed > 0 && s.failed > 0).length;
    const flakinessScore = samples.length > 0 ? (flakyRuns / samples.length) * 100 : 0;

    const timestamps = samples.map(s => s.sampledAt).sort();

    return {
      collectionId,
      windowStart: timestamps[0],
      windowEnd: timestamps[timestamps.length - 1],
      sampleCount: samples.length,
      avgPassRate,
      avgFailRate,
      avgRetryRate,
      avgDurationMs,
      p95DurationMs,
      totalRuns: samples.length,
      flakinessScore,
    };
  }

  listCollectionIds(): string[] {
    return Array.from(this._samples.keys());
  }

  evict(retentionMs: number): number {
    const cutoff = Date.now() - retentionMs;
    let removed = 0;
    for (const [id, samples] of this._samples) {
      const kept = samples.filter(s => new Date(s.sampledAt).getTime() >= cutoff);
      removed += samples.length - kept.length;
      this._samples.set(id, kept);
    }
    return removed;
  }
}

export const globalExecutionTrendAggregator = new ExecutionTrendAggregator();
