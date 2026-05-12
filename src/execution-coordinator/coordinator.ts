/**
 * coordinator.ts
 * SKELETON — Phase C implementation target.
 *
 * IExecutionCoordinator interface + ExecutionCoordinatorStub.
 * Phase A–B: routes call apiRunner.ts directly — coordinator unused.
 * Phase C: routes call coordinator.dispatchRun(); coordinator spawns
 *           child_process worker per run for crash isolation.
 *
 * Singleton accessor pattern: all callers use getCoordinator().
 * Phase C live implementation injected via setCoordinator() at server boot.
 *
 * Dependency boundary:
 *   execution-coordinator/ → api-runtime/        ✓
 *   execution-coordinator/ → shared-core/         ✓
 *   execution-coordinator/ → storage-provider/    ✓
 *   execution-coordinator/ → runtime-workers/     ✓
 *   execution-coordinator/ → ui/ routes           ✗ never
 */

import type { ExecutionSnapshot } from '../shared-core/contracts/dependency-graph.contract';
import type { IRuntimeDescriptor } from './runtime-registry';
import type { ExecutionPayload } from '../runtime-workers/contracts/payload.contract';
import type { ExecutionResult } from '../runtime-workers/contracts/result.contract';
import type { IExecutionLifecycleHooks } from './lifecycle';

export interface IExecutionCoordinator {
  /** Register a runtime descriptor (UI, API, future types). */
  registerRuntime(descriptor: IRuntimeDescriptor): void;

  /** Dispatch a run. Returns runId. Phase C: spawns child_process worker. */
  dispatchRun(payload: ExecutionPayload): Promise<string>;

  /** Cancel an in-flight run. */
  cancelRun(runId: string): Promise<void>;

  /** Replay a single node from a completed run. */
  replayNode(runId: string, nodeId: string): Promise<void>;

  /** Current snapshot for a run (in-memory). */
  getRunState(runId: string): ExecutionSnapshot | undefined;

  /** Final result after run completes or fails. */
  getRunResult(runId: string): ExecutionResult | undefined;

  /** All currently active run IDs. */
  activeRunIds(): string[];

  /** Register lifecycle observer hooks. */
  setLifecycleHooks(hooks: IExecutionLifecycleHooks): void;
}

export class ExecutionCoordinatorStub implements IExecutionCoordinator {
  private readonly _runtimes = new Map<string, IRuntimeDescriptor>();
  private _hooks: IExecutionLifecycleHooks | undefined;

  registerRuntime(descriptor: IRuntimeDescriptor): void {
    this._runtimes.set(descriptor.runtimeType, descriptor);
  }

  dispatchRun(_payload: ExecutionPayload): Promise<string> {
    throw new Error('ExecutionCoordinator.dispatchRun not implemented — Phase C target');
  }

  cancelRun(_runId: string): Promise<void> {
    throw new Error('ExecutionCoordinator.cancelRun not implemented — Phase C target');
  }

  replayNode(_runId: string, _nodeId: string): Promise<void> {
    throw new Error('ExecutionCoordinator.replayNode not implemented — Phase C target');
  }

  getRunState(_runId: string): ExecutionSnapshot | undefined {
    return undefined;
  }

  getRunResult(_runId: string): ExecutionResult | undefined {
    return undefined;
  }

  activeRunIds(): string[] {
    return [];
  }

  setLifecycleHooks(hooks: IExecutionLifecycleHooks): void {
    this._hooks = hooks;
  }
}

let _instance: IExecutionCoordinator = new ExecutionCoordinatorStub();

export function getCoordinator(): IExecutionCoordinator {
  return _instance;
}

/** Phase C: call at server boot to swap in live coordinator implementation. */
export function setCoordinator(coordinator: IExecutionCoordinator): void {
  _instance = coordinator;
}
