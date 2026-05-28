// src/api-graph-editor/graph-authoring-session.ts
// Phase E Step 5: Composes layout store + dependency editor + DAG validator.
// WorkflowEnvelope remains authoritative — this session authors visualization metadata only.

import { randomUUID } from 'crypto';
import type { IGraphAuthoringSession, GraphAuthoringSessionSnapshot, GraphEditRecord } from './contracts/graph-authoring.contracts';
import type { LayoutSnapshot } from './contracts/node-position.contracts';
import type { DependencyEdit, DependencyEditResult } from './contracts/dependency-edit.contracts';
import type { DagValidationResult } from './contracts/dag-validation.contracts';
import { InMemoryLayoutSnapshotStore } from './layout-snapshot-store';
import { DependencyEditor } from './dependency-editor';
import { DagValidator } from './dag-validator';

const ADVISORY = 'Graph authoring is visualization metadata only. WorkflowEnvelope remains authoritative for execution.';

export class GraphAuthoringSession implements IGraphAuthoringSession {
  private readonly _layoutStore = new InMemoryLayoutSnapshotStore();
  private readonly _depEditor = new DependencyEditor();
  private readonly _dagValidator = new DagValidator();
  private readonly _editHistory = new Map<string, GraphEditRecord[]>();
  private readonly _lastValidation = new Map<string, DagValidationResult>();

  saveLayout(snapshot: LayoutSnapshot): void {
    this._layoutStore.save(snapshot);
    this.recordEdit({
      collectionId: snapshot.collectionId,
      editType: 'node-repositioned',
      actorId: 'system',
      editedAt: new Date().toISOString(),
      metadata: { nodeCount: Object.keys(snapshot.positions).length, layoutLocked: snapshot.layoutLocked },
    });
  }

  loadLayout(collectionId: string): LayoutSnapshot | null {
    return this._layoutStore.load(collectionId);
  }

  applyDependencyEdit(
    nodeIds: string[],
    currentDependsOn: Record<string, string[]>,
    edit: DependencyEdit,
  ): DependencyEditResult {
    const result = this._depEditor.applyEdit(currentDependsOn, edit);
    if (result.outcome === 'applied') {
      // Re-validate full DAG after applying edit
      const updatedAdj = { ...currentDependsOn, [edit.fromStepId]: [...result.updatedDependsOn] };
      const validation = this._dagValidator.validate(nodeIds, updatedAdj);
      this._lastValidation.set(edit.collectionId, validation);
      this.recordEdit({
        collectionId: edit.collectionId,
        editType: edit.operation === 'add' ? 'dependency-added' : 'dependency-removed',
        actorId: edit.editedBy,
        editedAt: edit.editedAt,
        metadata: { fromStepId: edit.fromStepId, toStepId: edit.toStepId, advisory: ADVISORY },
      });
    }
    return result;
  }

  validateDag(nodeIds: string[], dependsOn: Record<string, string[]>): DagValidationResult {
    const result = this._dagValidator.validate(nodeIds, dependsOn);
    // Cache by first nodeId as a proxy (fine for single-collection validation)
    if (nodeIds.length > 0) {
      this._lastValidation.set(nodeIds[0], result);
    }
    return result;
  }

  recordEdit(edit: Omit<GraphEditRecord, 'editId'>): GraphEditRecord {
    const full: GraphEditRecord = { editId: randomUUID(), ...edit };
    const history = this._editHistory.get(edit.collectionId) ?? [];
    history.push(full);
    this._editHistory.set(edit.collectionId, history);
    return full;
  }

  snapshot(collectionId: string): GraphAuthoringSessionSnapshot {
    const history = this._editHistory.get(collectionId) ?? [];
    const layout = this._layoutStore.load(collectionId);
    return {
      collectionId,
      snapshotAt: new Date().toISOString(),
      layoutSaved: layout !== null,
      editHistoryDepth: history.length,
      lastValidation: this._lastValidation.get(collectionId) ?? null,
    };
  }
}

export const globalGraphAuthoringSession = new GraphAuthoringSession();
