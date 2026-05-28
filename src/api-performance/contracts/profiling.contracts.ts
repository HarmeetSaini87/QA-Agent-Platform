// src/api-performance/contracts/profiling.contracts.ts
// Phase E Step 1: Runtime profiling contracts — observational only, zero runtime behavior change.

export type ProfilingPhase =
  | 'execution'
  | 'graph-projection'
  | 'replay-synthesis'
  | 'polling'
  | 'overlay-generation'
  | 'worker-teardown'
  | 'retry-overhead';

export interface ProfilingSpan {
  readonly phase: ProfilingPhase;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface ProfilingSnapshot {
  readonly capturedAt: string;
  readonly recentSpans: readonly ProfilingSpan[];
  readonly spanCount: number;
  readonly phaseStats: Readonly<Record<ProfilingPhase, PhaseStats>>;
}

export interface PhaseStats {
  readonly phase: ProfilingPhase;
  readonly sampleCount: number;
  readonly avgDurationMs: number;
  readonly maxDurationMs: number;
  readonly totalDurationMs: number;
}
