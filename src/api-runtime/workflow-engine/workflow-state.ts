/**
 * workflow-state.ts
 * Internal mutable run state for WorkflowEngine.
 * Opaque to callers — not part of the public API surface.
 *
 * Phase C Step 1: added `scheduler` field — SchedulerStateTracker instance
 * for explicit node lifecycle tracking. Replaces ad-hoc nodeStatuses Map
 * with structured NodeExecutionRecord writes.
 */

import type { ApiStepResult } from '../../data/types';
import type { WorkflowNodeStatus } from '../../shared-core/contracts/workflow.contract';
import type { VariableContext } from '../../utils/apiVariables';
import { SchedulerStateTracker } from './scheduler-state';

export type { SchedulerStateTracker };

export interface WorkflowRunState {
  waveIndex: number;
  /** Per-node lifecycle status — fast lookup mirror of scheduler.getStatus() */
  nodeStatuses: Map<string, WorkflowNodeStatus>;
  /** Phase C Step 1: structured scheduler state tracker with full NodeExecutionRecords */
  scheduler: SchedulerStateTracker;
  /** Node IDs that have been aborted (stop/skipDependents propagation) */
  abortedIds: Set<string>;
  /** True once any test-step node fails or errors */
  collectionFailed: boolean;
  /** Accumulated results from all waves including teardown */
  stepResults: ApiStepResult[];
  /** Shared variable context — mutated after each wave merge */
  sharedContext: VariableContext;
}

export function createWorkflowRunState(initialContext: VariableContext): WorkflowRunState {
  return {
    waveIndex: 0,
    nodeStatuses: new Map(),
    scheduler: new SchedulerStateTracker(),
    abortedIds: new Set(),
    collectionFailed: false,
    stepResults: [],
    sharedContext: { ...initialContext },
  };
}
