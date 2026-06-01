/**
 * snapshot-hooks.ts
 * Lightweight hook interfaces for replay, debugger, and analytics.
 *
 * Phase B: onWaveStart / onNodeStart / onNodeComplete / onRunComplete.
 * Phase C Step 1: extended with lifecycle transition hooks for scheduler
 *   visibility â€” onNodeTransition, onNodeRetry, onNodeSkip, onSchedulerSnapshot.
 *
 * All hooks are optional. WorkflowEngine defaults to NO_OP_HOOKS.
 * Hook implementations MUST NOT mutate engine state or block execution.
 * Hooks are fire-and-forget â€” errors inside hooks are swallowed silently.
 */

import type { ApiStepResult } from '../../data/types';
import type { WorkflowNodeStatus } from '../../shared-core/contracts/workflow.contract';
import type {
  RetryState,
  SkipReason,
  FailureReason,
  ExecutionSnapshot,
} from '../../shared-core/contracts/dependency-graph.contract';
import type { ConcurrencyReadinessReport } from './parallel-eligibility';

// â”€â”€ Existing types (Phase B â€” unchanged) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WorkflowRunSummary {
  runId: string;
  totalNodes: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

// â”€â”€ Phase C Step 1: new transition event payloads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface NodeTransitionEvent {
  nodeId: string;
  nodeName: string;
  from: WorkflowNodeStatus;
  to: WorkflowNodeStatus;
  at: string;            // ISO timestamp
  attempt?: number;
  waveIndex?: number;
}

export interface NodeRetryEvent {
  nodeId: string;
  nodeName: string;
  attempt: number;
  maxRetries: number;
  delayMs: number;
  lastStatus: number | undefined;   // HTTP status that triggered retry, or undefined for transport error
  retriedOnStatuses: number[];
  nextAttemptAt: string;            // ISO timestamp
}

export interface NodeSkipEvent {
  nodeId: string;
  nodeName: string;
  reason: SkipReason;
  at: string;
  waveIndex: number;
  /** For dependency-failed / dependency-skipped: the dependency that caused the skip */
  causedByNodeId?: string;
}

export interface NodeFailureEvent {
  nodeId: string;
  nodeName: string;
  reason: FailureReason;
  error?: string;
  retryState?: RetryState;
  waveIndex: number;
}

// â”€â”€ WorkflowSnapshotHook â€” extended for Phase C Step 1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WorkflowSnapshotHook {
  // â”€â”€ Phase B hooks (unchanged) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  onWaveStart?(waveIndex: number, nodeIds: string[]): void;
  onNodeStart?(nodeId: string, attempt: number): void;
  onNodeComplete?(nodeId: string, result: ApiStepResult): void;
  onRunComplete?(summary: WorkflowRunSummary): void;

  // â”€â”€ Phase C Step 1: lifecycle transition hooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Fires on every node status transition.
   * Covers: pendingâ†’running, runningâ†’completed, runningâ†’retrying, etc.
   * Use for debugger visualisation and execution timeline rendering.
   */
  onNodeTransition?(event: NodeTransitionEvent): void;

  /**
   * Fires when a node is about to be retried (before the delay sleep).
   * Contains full retry state for timeline annotation.
   */
  onNodeRetry?(event: NodeRetryEvent): void;

  /**
   * Fires when a node is skipped (condition-false, dependency-failed, etc.)
   * Includes the SkipReason for diagnostic display.
   */
  onNodeSkip?(event: NodeSkipEvent): void;

  /**
   * Fires when a node fails terminally (exhausted retries or critical assertion).
   * Includes FailureReason for run report annotation.
   */
  onNodeFail?(event: NodeFailureEvent): void;

  /**
   * Fires at the end of each wave with a full serialisable ExecutionSnapshot.
   * For replay system, crash recovery, and selective rerun (Phase C+).
   * NOT called by default â€” only if consumer provides this hook.
   */
  onSchedulerSnapshot?(snapshot: ExecutionSnapshot): void;

  // Phase C Step 3: concurrency analysis hook
  /**
   * Fires once after DAG is built with the full concurrency readiness report.
   * Metadata only — does not alter execution behaviour.
   */
  onConcurrencyAnalysis?(report: import('./parallel-eligibility').ConcurrencyReadinessReport): void;

  // Phase C Step 4: failure propagation hook
  /**
   * Fires at run completion when any node failed.
   * Delivers the full failure propagation record for analytics, alerting, and
   * future rerun engine input. NOT called if all nodes passed.
   * NOT called by default -- only if consumer provides this hook.
   */
  onFailurePropagation?(record: import('./failure-propagation').FailurePropagationRecord): void;
}

export const NO_OP_HOOKS: WorkflowSnapshotHook = {};


