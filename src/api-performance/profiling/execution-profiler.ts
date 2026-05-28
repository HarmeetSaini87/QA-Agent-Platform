// src/api-performance/profiling/execution-profiler.ts
// Phase E Step 1: Wraps synchronous/async operations to record timing spans.
// Pure observation — zero side effects on wrapped function.

import type { ProfilingPhase } from '../contracts/profiling.contracts';
import { globalProfilerRegistry } from './profiler-registry';

export function withProfilingSync<T>(
  phase: ProfilingPhase,
  label: string,
  fn: () => T,
  metadata?: Record<string, string | number | boolean>
): T {
  const startMs = Date.now();
  try {
    return fn();
  } finally {
    const endMs = Date.now();
    globalProfilerRegistry.record({
      phase,
      label,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      metadata,
    });
  }
}

export async function withProfilingAsync<T>(
  phase: ProfilingPhase,
  label: string,
  fn: () => Promise<T>,
  metadata?: Record<string, string | number | boolean>
): Promise<T> {
  const startMs = Date.now();
  try {
    return await fn();
  } finally {
    const endMs = Date.now();
    globalProfilerRegistry.record({
      phase,
      label,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      metadata,
    });
  }
}

export function recordSpan(
  phase: ProfilingPhase,
  label: string,
  durationMs: number,
  metadata?: Record<string, string | number | boolean>
): void {
  const endMs = Date.now();
  globalProfilerRegistry.record({
    phase,
    label,
    startMs: endMs - durationMs,
    endMs,
    durationMs,
    metadata,
  });
}
