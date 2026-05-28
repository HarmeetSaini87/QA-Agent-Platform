// src/api-graph-editor/contracts/dependency-edit.contracts.ts
// Phase E Step 5: Dependency editing contracts — add/remove dependsOn with DAG safety.

export type DependencyEditOperation = 'add' | 'remove';

export interface DependencyEdit {
  readonly collectionId: string;
  readonly fromStepId: string;
  readonly toStepId: string;
  readonly operation: DependencyEditOperation;
  readonly editedBy: string;
  readonly editedAt: string;
}

export type DependencyEditOutcome =
  | 'applied'
  | 'rejected-cycle'
  | 'rejected-duplicate'
  | 'rejected-not-found'
  | 'rejected-self-loop';

export interface DependencyEditResult {
  readonly edit: DependencyEdit;
  readonly outcome: DependencyEditOutcome;
  readonly updatedDependsOn: readonly string[];
  readonly advisoryNote?: string;
}

export interface IDependencyEditor {
  /** Apply a dependency add/remove. Validates DAG safety before mutating. */
  applyEdit(
    currentDependsOn: Record<string, string[]>,
    edit: DependencyEdit,
  ): DependencyEditResult;
  /** Returns current adjacency map after applying a sequence of edits (dry-run). */
  dryRun(
    currentDependsOn: Record<string, string[]>,
    edits: DependencyEdit[],
  ): { adjacency: Record<string, string[]>; rejectedEdits: DependencyEditResult[] };
}
