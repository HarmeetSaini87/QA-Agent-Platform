/**
 * lifecycle.ts
 * SKELETON — Phase C implementation target.
 *
 * Execution lifecycle hook interface for coordinator event observation.
 * Hooks are optional — coordinator calls them if set, skips if not.
 * Phase A: interface + no-op default implementation only.
 */

import type { ExecutionPayload } from '../runtime-workers/contracts/payload.contract';
import type { ExecutionResult } from '../runtime-workers/contracts/result.contract';

export interface IExecutionLifecycleHooks {
  /** Called before dispatch. Return false to abort the run. */
  onBeforeDispatch?(payload: ExecutionPayload): boolean | Promise<boolean>;

  /** Called immediately after run is accepted and queued. */
  onDispatched?(runId: string, runtimeType: string): void;

  /** Called on each worker progress IPC message. */
  onProgress?(runId: string, completedCount: number, totalCount: number): void;

  /** Called when run finishes successfully. */
  onCompleted?(result: ExecutionResult): void;

  /** Called when run terminates with an error. */
  onFailed?(runId: string, error: string): void;

  /** Called when run is cancelled by user or coordinator. */
  onCancelled?(runId: string): void;
}

/** Safe default — all hooks are no-ops. Used as fallback when no hooks are registered. */
export class NoOpLifecycleHooks implements IExecutionLifecycleHooks {
  onBeforeDispatch(_payload: ExecutionPayload): boolean {
    return true;
  }
}
