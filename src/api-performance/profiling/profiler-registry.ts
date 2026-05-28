// src/api-performance/profiling/profiler-registry.ts
// Phase E Step 1: In-memory circular buffer for profiling spans.
// Observational only — never alters execution behavior.

import type { ProfilingSpan, ProfilingSnapshot, PhaseStats, ProfilingPhase } from '../contracts/profiling.contracts';

const BUFFER_SIZE = 1000;

class ProfilerRegistry {
  private readonly _buffer: ProfilingSpan[] = [];
  private _head = 0;
  private _count = 0;

  record(span: ProfilingSpan): void {
    if (this._buffer.length < BUFFER_SIZE) {
      this._buffer.push(span);
    } else {
      this._buffer[this._head] = span;
    }
    this._head = (this._head + 1) % BUFFER_SIZE;
    this._count++;
  }

  snapshot(): ProfilingSnapshot {
    const spans = this._getAll();
    return {
      capturedAt: new Date().toISOString(),
      recentSpans: spans.slice(-100),
      spanCount: this._count,
      phaseStats: this._computeStats(spans),
    };
  }

  clear(): void {
    this._buffer.length = 0;
    this._head = 0;
    this._count = 0;
  }

  private _getAll(): ProfilingSpan[] {
    if (this._buffer.length < BUFFER_SIZE) return [...this._buffer];
    // Reconstruct circular buffer in order
    return [
      ...this._buffer.slice(this._head),
      ...this._buffer.slice(0, this._head),
    ];
  }

  private _computeStats(spans: ProfilingSpan[]): Readonly<Record<ProfilingPhase, PhaseStats>> {
    const groups = new Map<ProfilingPhase, number[]>();

    for (const span of spans) {
      let arr = groups.get(span.phase);
      if (!arr) { arr = []; groups.set(span.phase, arr); }
      arr.push(span.durationMs);
    }

    const stats: Partial<Record<ProfilingPhase, PhaseStats>> = {};
    for (const [phase, durations] of groups) {
      const total = durations.reduce((a, b) => a + b, 0);
      stats[phase] = {
        phase,
        sampleCount: durations.length,
        avgDurationMs: Math.round(total / durations.length),
        maxDurationMs: Math.max(...durations),
        totalDurationMs: total,
      };
    }
    return stats as Readonly<Record<ProfilingPhase, PhaseStats>>;
  }
}

export const globalProfilerRegistry = new ProfilerRegistry();
