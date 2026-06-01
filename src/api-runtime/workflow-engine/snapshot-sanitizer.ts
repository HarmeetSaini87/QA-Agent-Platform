/**
 * snapshot-sanitizer.ts — Phase C Step 2
 * Masks secrets from ExecutionSnapshot before persistence or hook delivery.
 *
 * Aligns with artifact-engine/masking.ts SENSITIVE_VAR_RE pattern.
 * Never mutates input — always returns new objects.
 */

import type { ExecutionSnapshot, NodeExecutionRecord } from '../../shared-core/contracts/dependency-graph.contract';
import type { VariableMap } from '../../shared-core/contracts/variable.contract';

// Matches artifact-engine/masking.ts SENSITIVE_VAR_RE — aligned intentionally
const SENSITIVE_VAR_RE = /(?:password|token|secret|key|credential|api[_-]?key|auth)/i;

const REDACTED = '***';

export function sanitizeVariableMap(vars: VariableMap): VariableMap {
  const out: VariableMap = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = SENSITIVE_VAR_RE.test(k) ? REDACTED : v;
  }
  return out;
}

export function sanitizeNodeRecord(record: NodeExecutionRecord): NodeExecutionRecord {
  return {
    ...record,
    variablesBefore: record.variablesBefore ? sanitizeVariableMap(record.variablesBefore) : undefined,
    variablesAfter:  record.variablesAfter  ? sanitizeVariableMap(record.variablesAfter)  : undefined,
  };
}

/**
 * Sanitize a full ExecutionSnapshot before persistence or hook delivery.
 * Returns a new snapshot — does NOT mutate the input.
 */
export function sanitizeSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  const nodeRecords: Record<string, NodeExecutionRecord> = {};
  for (const [id, rec] of Object.entries(snapshot.nodeRecords)) {
    nodeRecords[id] = sanitizeNodeRecord(rec);
  }
  return {
    ...snapshot,
    variableState: sanitizeVariableMap(snapshot.variableState),
    nodeRecords,
  };
}
