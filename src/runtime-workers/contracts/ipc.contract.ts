/**
 * ipc.contract.ts
 * SKELETON — Phase C implementation target.
 *
 * IPC message shapes for future child_process worker communication.
 * Messages flow over process.send() / process.on('message') channel.
 * Phase A: contract definitions only — no actual IPC in use yet.
 */

import type { ExecutionResult } from './result.contract';

export type IpcMessageType =
  | 'worker:ready'
  | 'worker:progress'
  | 'worker:completed'
  | 'worker:failed'
  | 'coordinator:cancel';

export interface IpcMessageBase {
  type: IpcMessageType;
  runId: string;
  timestamp: number;
}

/** Worker → Coordinator: worker process booted and ready to receive payload */
export interface WorkerReadyMessage extends IpcMessageBase {
  type: 'worker:ready';
  workerId: string;
}

/** Worker → Coordinator: in-flight progress update for SSE forwarding to browser */
export interface WorkerProgressMessage extends IpcMessageBase {
  type: 'worker:progress';
  completedNodeIds: string[];
  runningNodeIds: string[];
  failedNodeIds: string[];
}

/** Worker → Coordinator: run finished cleanly */
export interface WorkerCompletedMessage extends IpcMessageBase {
  type: 'worker:completed';
  result: ExecutionResult;
}

/** Worker → Coordinator: run terminated with error */
export interface WorkerFailedMessage extends IpcMessageBase {
  type: 'worker:failed';
  error: string;
  exitCode?: number;
}

/** Coordinator → Worker: abort the current run */
export interface CoordinatorCancelMessage extends IpcMessageBase {
  type: 'coordinator:cancel';
}

export type IpcMessage =
  | WorkerReadyMessage
  | WorkerProgressMessage
  | WorkerCompletedMessage
  | WorkerFailedMessage
  | CoordinatorCancelMessage;
