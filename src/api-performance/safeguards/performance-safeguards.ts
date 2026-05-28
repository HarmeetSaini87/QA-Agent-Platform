// src/api-performance/safeguards/performance-safeguards.ts
// Phase E Step 1: Configurable performance safeguard checks — warnings only, zero auto-throttling.

import type {
  SafeguardViolation,
  SafeguardCheckResult,
  SafeguardThresholds,
  SafeguardCode,
  SafeguardSeverity,
} from '../contracts/safeguard.contracts';
import { DEFAULT_SAFEGUARD_THRESHOLDS } from './safeguard-config';
import type { ProjectionCacheStats } from '../optimization/graph-projection-cache';

const ADVISORY = 'Platform does not auto-throttle. This is an advisory warning only.';

export class PerformanceSafeguards {
  constructor(
    private readonly _thresholds: SafeguardThresholds = DEFAULT_SAFEGUARD_THRESHOLDS
  ) {}

  checkGraphSize(nodeCount: number): SafeguardViolation | null {
    if (nodeCount >= this._thresholds.maxGraphNodeCountCritical) {
      return _violation('LARGE_GRAPH_NODE_COUNT', 'critical', nodeCount, this._thresholds.maxGraphNodeCountCritical,
        `Graph has ${nodeCount} nodes — exceeds critical threshold ${this._thresholds.maxGraphNodeCountCritical}. Consider lazy hierarchy rendering.`);
    }
    if (nodeCount >= this._thresholds.maxGraphNodeCountWarning) {
      return _violation('LARGE_GRAPH_NODE_COUNT', 'warning', nodeCount, this._thresholds.maxGraphNodeCountWarning,
        `Graph has ${nodeCount} nodes — approaching rendering limits. Consider enabling virtualization.`);
    }
    return null;
  }

  checkReplayEventGrowth(eventCount: number): SafeguardViolation | null {
    if (eventCount >= this._thresholds.maxReplayEventsCritical) {
      return _violation('REPLAY_EVENT_GROWTH', 'critical', eventCount, this._thresholds.maxReplayEventsCritical,
        `Replay session has ${eventCount} events — exceeds critical threshold. Enable event compaction.`);
    }
    if (eventCount >= this._thresholds.maxReplayEventsWarning) {
      return _violation('REPLAY_EVENT_GROWTH', 'warning', eventCount, this._thresholds.maxReplayEventsWarning,
        `Replay session has ${eventCount} events — consider compaction for timeline rendering.`);
    }
    return null;
  }

  checkPollingOverload(pollsPerMinute: number): SafeguardViolation | null {
    if (pollsPerMinute >= this._thresholds.maxPollsPerMinuteWarning) {
      return _violation('POLLING_OVERLOAD', 'warning', pollsPerMinute, this._thresholds.maxPollsPerMinuteWarning,
        `Polling rate ${pollsPerMinute}/min exceeds threshold. Incremental overlay diffing recommended.`);
    }
    return null;
  }

  checkRetryStorm(retryRatePerMinute: number): SafeguardViolation | null {
    if (retryRatePerMinute >= this._thresholds.maxRetryRatePerMinuteWarning) {
      return _violation('RETRY_STORM_DETECTED', 'warning', retryRatePerMinute, this._thresholds.maxRetryRatePerMinuteWarning,
        `Retry rate ${retryRatePerMinute}/min — possible retry storm. Review retry configuration.`);
    }
    return null;
  }

  checkMemoryPressure(heapUsedMb: number): SafeguardViolation | null {
    if (heapUsedMb >= this._thresholds.maxHeapUsedMbWarning) {
      return _violation('MEMORY_PRESSURE', 'warning', heapUsedMb, this._thresholds.maxHeapUsedMbWarning,
        `Heap usage ${heapUsedMb}MB — approaching warning threshold. Review in-memory stores.`);
    }
    return null;
  }

  checkProjectionCacheMissRate(stats: ProjectionCacheStats): SafeguardViolation | null {
    const missRatePct = 100 - stats.hitRatePct;
    if (stats.hits + stats.misses < 10) return null; // insufficient sample
    if (missRatePct >= this._thresholds.projectionCacheMissRateWarningPct) {
      return _violation('PROJECTION_CACHE_MISS_RATE', 'info', missRatePct, this._thresholds.projectionCacheMissRateWarningPct,
        `Projection cache miss rate ${missRatePct}% — cache may be invalidated too frequently.`);
    }
    return null;
  }

  runAll(input: SafeguardInput): SafeguardCheckResult {
    const violations: SafeguardViolation[] = [];
    const push = (v: SafeguardViolation | null) => { if (v) violations.push(v); };

    push(this.checkGraphSize(input.graphNodeCount));
    push(this.checkReplayEventGrowth(input.replayEventCount));
    push(this.checkPollingOverload(input.pollsPerMinute));
    push(this.checkRetryStorm(input.retryRatePerMinute));
    push(this.checkMemoryPressure(input.heapUsedMb));
    if (input.cacheStats) push(this.checkProjectionCacheMissRate(input.cacheStats));

    return {
      checkedAt: new Date().toISOString(),
      violations,
      healthy: violations.filter(v => v.severity !== 'info').length === 0,
    };
  }
}

export interface SafeguardInput {
  graphNodeCount: number;
  replayEventCount: number;
  pollsPerMinute: number;
  retryRatePerMinute: number;
  heapUsedMb: number;
  cacheStats?: ProjectionCacheStats;
}

function _violation(
  code: SafeguardCode,
  severity: SafeguardSeverity,
  measuredValue: number,
  threshold: number,
  message: string
): SafeguardViolation {
  return { code, severity, message, measuredValue, threshold, advisoryNote: ADVISORY };
}

export const globalPerformanceSafeguards = new PerformanceSafeguards();
