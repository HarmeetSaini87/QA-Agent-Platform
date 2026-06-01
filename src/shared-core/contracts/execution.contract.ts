/**
 * execution.contract.ts
 * Coordinator-level contracts: RunHandle, RunOptions, IExecutionCoordinator.
 *
 * ExecutionSnapshot lives in dependency-graph.contract.ts (shared with debugger,
 * storage-provider, and dag-builder) — imported here, not re-defined.
 */

import type { ApiStepResult, ApiCollectionRunResult } from '../../data/types';
import type { ExecutionSnapshot } from './dependency-graph.contract';

export type { ExecutionSnapshot };   // re-export for single-import convenience

// ── Run handle ────────────────────────────────────────────────────────────────

export interface RunHandle {
  runId: string;
  collectionId: string;
  startedAt: string;
  /** Poll this for live status — Phase C: SSE stream, Phase A–B: HTTP polling */
  statusUrl?: string;
}

// ── Run options ───────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Override collection-level execution mode for this run */
  mode?: 'sequential' | 'dag' | 'parallel';
  /** Resume from a prior snapshot — enables selective rerun (Phase C) */
  fromSnapshot?: ExecutionSnapshot;
  /** Skip these node IDs — manual override from debugger */
  skipNodeIds?: string[];
  /** Only execute these node IDs and their upstream dependencies */
  targetNodeIds?: string[];
  logLevel?: 'minimal' | 'standard' | 'verbose';
  /** Tag this run for analytics grouping */
  runLabel?: string;
}

// ── Coordinator contract ──────────────────────────────────────────────────────

/**
 * IExecutionCoordinator — Phase C implementation target.
 *
 * Phase A–B: routes call apiRunner.runCollection() directly.
 * Phase C: routes call coordinator.scheduleRun() → coordinator wraps apiRunner,
 *          then incrementally delegates to api-runtime/* as Phase B extractions land.
 */
export interface IExecutionCoordinator {
  /** Schedule and start a collection run. Returns immediately with a RunHandle. */
  scheduleRun(
    collectionId: string,
    environmentId: string,
    options?: RunOptions,
  ): Promise<RunHandle>;

  /** Get current live snapshot of a run (undefined if runId unknown) */
  getRunState(runId: string): ExecutionSnapshot | undefined;

  /** Get final persisted result (undefined if run still active or not found) */
  getRunResult(runId: string): ApiCollectionRunResult | undefined;

  /** Replay a single node using variable state from a saved snapshot */
  replayNode(runId: string, nodeId: string): Promise<ApiStepResult>;

  /** Cancel an in-flight run. No-op if already completed. */
  cancelRun(runId: string): Promise<void>;

  /** List all active runIds managed by this coordinator */
  activeRunIds(): string[];
}
