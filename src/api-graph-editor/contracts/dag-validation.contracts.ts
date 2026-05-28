// src/api-graph-editor/contracts/dag-validation.contracts.ts
// Phase E Step 5: DAG validation contracts — cycle, orphan, hierarchy consistency.

export type DagViolationType =
  | 'cycle'
  | 'orphan'
  | 'self-loop'
  | 'unknown-dependency'
  | 'teardown-before-setup'
  | 'hierarchy-inconsistency';

export interface DagViolation {
  readonly type: DagViolationType;
  readonly affectedNodeIds: readonly string[];
  readonly description: string;
}

export interface DagValidationResult {
  readonly valid: boolean;
  readonly violations: readonly DagViolation[];
  readonly topologicalOrder?: readonly string[];
  readonly validatedAt: string;
}

export interface IDagValidator {
  /** Validates a dependsOn adjacency map. Returns violations and topological order if valid. */
  validate(
    nodeIds: readonly string[],
    dependsOn: Record<string, string[]>,
  ): DagValidationResult;
  /** Quick cycle check only — cheaper than full validate. */
  hasCycle(dependsOn: Record<string, string[]>): boolean;
}
