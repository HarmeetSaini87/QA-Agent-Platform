// src/api-runtime/debugger-engine/workflow-replay.ts
// Phase F — Debugger Engine: full workflow replay context builder.
// Reads snapshot and constructs an advisory replay plan for the whole run.
// ADVISORY — never auto-executes. Caller decides whether to act.

import { loadExecutionSnapshot } from '../artifact-engine/execution-store';
import type { NodeExecutionRecord } from '../../shared-core/contracts/dependency-graph.contract';

export type ReplayNodeDecision = 'replay' | 'skip-completed' | 'skip-manually';

export interface WorkflowReplayNodePlan {
  nodeId: string;
  nodeName: string;
  decision: ReplayNodeDecision;
  reason: string;
  priorStatus: NodeExecutionRecord['status'];
  variablesAtEntry: Record<string, string>;
}

export interface WorkflowReplayPlan {
  runId: string;
  collectionId: string;
  capturedAt: string;
  /** Execution order from the original snapshot graph */
  executionOrder: string[];
  nodePlans: WorkflowReplayNodePlan[];
  /** Node IDs targeted for re-execution */
  replayTargets: string[];
  /** Node IDs that will be skipped because they completed successfully */
  skipTargets: string[];
  advisoryNote: string;
}

function stringify(map: Record<string, unknown> | undefined): Record<string, string> {
  if (!map) return {};
  return Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k, String(v ?? '')])
  );
}

export async function buildWorkflowReplayPlan(
  runId: string,
  /** If provided, only these node IDs are targeted for replay; others are skipped */
  targetNodeIds?: string[]
): Promise<WorkflowReplayPlan | null> {
  const snapshot = await loadExecutionSnapshot(runId);
  if (!snapshot) return null;

  const order: string[] =
    snapshot.graph.executionOrder?.length
      ? snapshot.graph.executionOrder
      : Object.keys(snapshot.nodeRecords);

  const targetSet = targetNodeIds ? new Set(targetNodeIds) : null;

  const nodePlans: WorkflowReplayNodePlan[] = [];
  const replayTargets: string[] = [];
  const skipTargets: string[] = [];

  for (const nodeId of order) {
    const record = snapshot.nodeRecords[nodeId];
    if (!record) continue;

    let decision: ReplayNodeDecision;
    let reason: string;

    if (targetSet && !targetSet.has(nodeId)) {
      decision = 'skip-manually';
      reason = 'Not in targetNodeIds selection.';
      skipTargets.push(nodeId);
    } else if (record.status === 'completed' && !targetSet) {
      decision = 'skip-completed';
      reason = 'Node completed successfully in original run.';
      skipTargets.push(nodeId);
    } else {
      decision = 'replay';
      reason =
        record.status === 'failed'
          ? `Node failed: ${record.error ?? record.failureReason ?? 'unknown'}`
          : record.status === 'skipped'
          ? `Node was skipped: ${record.skipReason ?? 'unknown'}`
          : 'Node selected for replay.';
      replayTargets.push(nodeId);
    }

    nodePlans.push({
      nodeId,
      nodeName: record.nodeName,
      decision,
      reason,
      priorStatus: record.status,
      variablesAtEntry: stringify(record.variablesBefore),
    });
  }

  return {
    runId,
    collectionId: snapshot.collectionId,
    capturedAt: snapshot.capturedAt,
    executionOrder: order,
    nodePlans,
    replayTargets,
    skipTargets,
    advisoryNote:
      'This replay plan is advisory only. No execution has been triggered. ' +
      'Submit replayTargets to your execution coordinator to perform the actual replay.',
  };
}
