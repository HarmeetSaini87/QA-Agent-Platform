/**
 * snapshot-sanitizer.ts
 * Masks secrets in NodeExecutionRecord.variablesBefore / variablesAfter
 * before ExecutionSnapshot is written to disk.
 *
 * Uses the same SENSITIVE_VAR_RE pattern as masking.ts to keep masking
 * behaviour consistent across run-results and execution-snapshots.
 */

import type { ExecutionSnapshot, NodeExecutionRecord } from '../../shared-core/contracts/dependency-graph.contract';
import type { VariableMap } from '../../shared-core/contracts/variable.contract';

const SENSITIVE_VAR_RE = /(?:password|token|secret|key|credential|api[_-]?key|auth)/i;
const MASK = '***';

function maskVariableMap(vars: VariableMap | undefined): VariableMap | undefined {
  if (!vars) return undefined;
  const out: VariableMap = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = SENSITIVE_VAR_RE.test(k) ? MASK : v;
  }
  return out;
}

function sanitizeRecord(record: NodeExecutionRecord): NodeExecutionRecord {
  return {
    ...record,
    variablesBefore: maskVariableMap(record.variablesBefore),
    variablesAfter: maskVariableMap(record.variablesAfter),
  };
}

export function sanitizeSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  const sanitizedRecords: Record<string, NodeExecutionRecord> = {};
  for (const [id, record] of Object.entries(snapshot.nodeRecords)) {
    sanitizedRecords[id] = sanitizeRecord(record);
  }
  return {
    ...snapshot,
    nodeRecords: sanitizedRecords,
    variableState: maskVariableMap(snapshot.variableState) ?? {},
  };
}
