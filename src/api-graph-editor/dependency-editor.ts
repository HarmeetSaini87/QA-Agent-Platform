// src/api-graph-editor/dependency-editor.ts
// Phase E Step 5: Dependency editing — add/remove dependsOn with cycle prevention.
// Never touches WorkflowEnvelope directly — returns updated adjacency for caller to apply.

import type {
  IDependencyEditor,
  DependencyEdit,
  DependencyEditResult,
} from './contracts/dependency-edit.contracts';
import { DagValidator } from './dag-validator';

export class DependencyEditor implements IDependencyEditor {
  private readonly _validator = new DagValidator();

  applyEdit(
    currentDependsOn: Record<string, string[]>,
    edit: DependencyEdit,
  ): DependencyEditResult {
    const { fromStepId, toStepId, operation } = edit;
    const deps = currentDependsOn[fromStepId] ?? [];

    // Self-loop guard
    if (fromStepId === toStepId) {
      return { edit, outcome: 'rejected-self-loop', updatedDependsOn: deps, advisoryNote: 'A step cannot depend on itself.' };
    }

    if (operation === 'add') {
      if (deps.includes(toStepId)) {
        return { edit, outcome: 'rejected-duplicate', updatedDependsOn: deps, advisoryNote: `Dependency "${fromStepId} → ${toStepId}" already exists.` };
      }
      // Tentative adjacency
      const tentative = { ...currentDependsOn, [fromStepId]: [...deps, toStepId] };
      if (this._validator.hasCycle(tentative)) {
        return { edit, outcome: 'rejected-cycle', updatedDependsOn: deps, advisoryNote: `Adding "${fromStepId} → ${toStepId}" would create a cyclic dependency.` };
      }
      return { edit, outcome: 'applied', updatedDependsOn: [...deps, toStepId] };
    }

    // remove
    if (!deps.includes(toStepId)) {
      return { edit, outcome: 'rejected-not-found', updatedDependsOn: deps, advisoryNote: `Dependency "${fromStepId} → ${toStepId}" does not exist.` };
    }
    return { edit, outcome: 'applied', updatedDependsOn: deps.filter(d => d !== toStepId) };
  }

  dryRun(
    currentDependsOn: Record<string, string[]>,
    edits: DependencyEdit[],
  ): { adjacency: Record<string, string[]>; rejectedEdits: DependencyEditResult[] } {
    let adjacency = { ...currentDependsOn };
    const rejectedEdits: DependencyEditResult[] = [];

    for (const edit of edits) {
      const result = this.applyEdit(adjacency, edit);
      if (result.outcome === 'applied') {
        adjacency = { ...adjacency, [edit.fromStepId]: [...result.updatedDependsOn] };
      } else {
        rejectedEdits.push(result);
      }
    }

    return { adjacency, rejectedEdits };
  }
}

export const globalDependencyEditor = new DependencyEditor();
