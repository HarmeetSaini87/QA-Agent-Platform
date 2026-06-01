// src/api-performance/contracts/compaction.contracts.ts
// Phase E Step 1: Event compaction contracts — view-only, never mutates stored replay sessions.

export type CompactionStrategy = 'retry-fold' | 'polling-merge' | 'none';

export interface CompactionConfig {
  readonly strategy: CompactionStrategy;
  /** Max consecutive same-phase events to fold into one summary. Default: 10 */
  readonly foldThreshold: number;
  /** Preserve all step-completed and failure-propagated events — never fold these. */
  readonly preserveTerminalEvents: boolean;
}

export interface CompactedEventSummary {
  readonly kind: 'compacted-summary';
  readonly originalKind: string;
  readonly stepId: string;
  readonly stepName: string;
  readonly foldedCount: number;
  readonly firstTimestamp: string;
  readonly lastTimestamp: string;
  readonly totalDurationMs?: number;
}

export interface CompactionResult {
  readonly strategy: CompactionStrategy;
  readonly originalEventCount: number;
  readonly compactedEventCount: number;
  readonly foldedGroups: number;
  readonly compressionRatio: number;
  /** Determinism guard: compaction never changes the observable execution order. */
  readonly deterministicGuarantee: true;
}
