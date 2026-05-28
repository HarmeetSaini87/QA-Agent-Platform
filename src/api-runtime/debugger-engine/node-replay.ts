// src/api-runtime/debugger-engine/node-replay.ts
// Phase F — Debugger Engine: single-node replay context builder.
// Reads snapshot and produces the context needed to replay one node.
// ADVISORY — never auto-executes. Caller decides whether to act.

import { loadExecutionSnapshot } from '../artifact-engine/execution-store';
import { loadRunResult } from '../artifact-engine/run-store';
import type { NodeExecutionRecord } from '../../shared-core/contracts/dependency-graph.contract';

export interface NodeReplayContext {
  runId: string;
  collectionId: string;
  nodeId: string;
  nodeName: string;
  /** Variable state injected at node entry — suitable as initialVariables for re-execution */
  variablesAtEntry: Record<string, string>;
  /** Prior node record — status, duration, error, retryState */
  priorRecord: NodeExecutionRecord;
  /** Node IDs that must be completed before this node can run */
  dependsOn: string[];
  /** Whether all dependencies completed successfully in the original run */
  dependenciesSatisfied: boolean;
  /** Step request snapshot (from run result) if available */
  stepRequest?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  advisoryNote: string;
}

function stringify(map: Record<string, unknown> | undefined): Record<string, string> {
  if (!map) return {};
  return Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k, String(v ?? '')])
  );
}

export async function buildNodeReplayContext(
  runId: string,
  nodeId: string
): Promise<NodeReplayContext | null> {
  const snapshot = await loadExecutionSnapshot(runId);
  if (!snapshot) return null;

  const record = snapshot.nodeRecords[nodeId];
  if (!record) return null;

  const nodeMeta = snapshot.graph.nodes[nodeId];
  const dependsOn: string[] = nodeMeta?.dependsOn ?? [];

  const dependenciesSatisfied = dependsOn.every(depId => {
    const dep = snapshot.nodeRecords[depId];
    return dep?.status === 'completed';
  });

  // Try to locate the original step request from the run result
  let stepRequest: NodeReplayContext['stepRequest'] | undefined;
  try {
    const runResult = await loadRunResult(runId);
    const stepResult = runResult?.stepResults?.find(s => s.stepId === nodeId);
    if (stepResult?.request) {
      const req = stepResult.request as any;
      stepRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers ?? {},
        body: req.body,
      };
    }
  } catch { /* non-fatal */ }

  return {
    runId,
    collectionId: snapshot.collectionId,
    nodeId,
    nodeName: record.nodeName,
    variablesAtEntry: stringify(record.variablesBefore),
    priorRecord: record,
    dependsOn,
    dependenciesSatisfied,
    stepRequest,
    advisoryNote:
      'This context is advisory only. The caller is responsible for executing the replay. ' +
      'No request has been sent and no state has been modified.',
  };
}
