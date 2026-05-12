/**
 * result.contract.ts
 * SKELETON — Phase C implementation target.
 *
 * ExecutionResult and ExecutionStatus lifecycle enum.
 * Phase A: type definitions only.
 */

import type { ExecutionSnapshot } from '../../shared-core/contracts/execution.contract';

export enum ExecutionStatus {
  Queued    = 'queued',
  Running   = 'running',
  Completed = 'completed',
  Failed    = 'failed',
  Retrying  = 'retrying',
  Cancelled = 'cancelled',
}

export interface ExecutionResult {
  runId: string;
  status: ExecutionStatus;
  snapshot?: ExecutionSnapshot;
  durationMs?: number;
  error?: string;
  /** Phase C: exit code from child_process worker — undefined until worker spawning is live */
  workerExitCode?: number;
}
