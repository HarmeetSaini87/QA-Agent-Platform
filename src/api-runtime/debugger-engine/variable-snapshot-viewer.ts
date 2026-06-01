// src/api-runtime/debugger-engine/variable-snapshot-viewer.ts
// Phase F — Debugger Engine: variable mutation trace from ExecutionSnapshot.
// Pure reader — never mutates snapshot or execution state.

import { loadExecutionSnapshot } from '../artifact-engine/execution-store';
import type { NodeExecutionRecord } from '../../shared-core/contracts/dependency-graph.contract';

export interface VariableMutation {
  nodeId: string;
  nodeName: string;
  /** Variables that were set or changed by this node */
  extracted: Record<string, string>;
  /** Variable keys present before entering this node */
  before: Record<string, string>;
  /** Variable keys present after this node completed */
  after: Record<string, string>;
}

export interface VariableTrace {
  runId: string;
  collectionId: string;
  capturedAt: string;
  /** Final variable state across the whole run */
  finalState: Record<string, string>;
  /** Per-node mutation trace in execution order */
  mutations: VariableMutation[];
  advisoryNote: string;
}

function stringify(map: Record<string, unknown> | undefined): Record<string, string> {
  if (!map) return {};
  return Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k, String(v ?? '')])
  );
}

function diffMaps(
  before: Record<string, string>,
  after: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(after)) {
    if (before[k] !== v) result[k] = v;
  }
  return result;
}

export async function buildVariableTrace(runId: string): Promise<VariableTrace | null> {
  const snapshot = await loadExecutionSnapshot(runId);
  if (!snapshot) return null;

  // Execution order from snapshot graph; fall back to Object.keys order
  const order: string[] =
    snapshot.graph.executionOrder?.length
      ? snapshot.graph.executionOrder
      : Object.keys(snapshot.nodeRecords);

  const mutations: VariableMutation[] = [];

  for (const nodeId of order) {
    const record: NodeExecutionRecord | undefined = snapshot.nodeRecords[nodeId];
    if (!record) continue;

    const before = stringify(record.variablesBefore);
    const after = stringify(record.variablesAfter);
    const extracted = diffMaps(before, after);

    mutations.push({
      nodeId,
      nodeName: record.nodeName,
      extracted,
      before,
      after,
    });
  }

  return {
    runId,
    collectionId: snapshot.collectionId,
    capturedAt: snapshot.capturedAt,
    finalState: stringify(snapshot.variableState),
    mutations,
    advisoryNote:
      'Variable trace is read-only. This view shows how variables changed at each node. ' +
      'No execution state has been modified.',
  };
}
