// src/api-graph-editor/contracts/graph-authoring.contracts.ts
// Phase E Step 5: Graph authoring session — composes editing + validation + persistence.
// WorkflowEnvelope remains authoritative. This layer authors visualization metadata only.

import type { LayoutSnapshot } from './node-position.contracts';
import type { DependencyEdit, DependencyEditResult } from './dependency-edit.contracts';
import type { DagValidationResult } from './dag-validation.contracts';

export type GraphEditType =
  | 'node-repositioned'
  | 'dependency-added'
  | 'dependency-removed'
  | 'group-created'
  | 'group-modified'
  | 'layout-locked'
  | 'layout-unlocked'
  | 'layout-reset';

export interface GraphEditRecord {
  readonly editId: string;
  readonly collectionId: string;
  readonly editType: GraphEditType;
  readonly actorId: string;
  readonly editedAt: string;
  readonly metadata: Record<string, unknown>;
}

export interface GraphAuthoringSessionSnapshot {
  readonly collectionId: string;
  readonly snapshotAt: string;
  readonly layoutSaved: boolean;
  readonly editHistoryDepth: number;
  readonly lastValidation: DagValidationResult | null;
}

export interface IGraphAuthoringSession {
  /** Persist a layout snapshot. Validates positions — does NOT touch WorkflowEnvelope. */
  saveLayout(snapshot: LayoutSnapshot): void;
  loadLayout(collectionId: string): LayoutSnapshot | null;
  /** Apply a dependency edit after DAG validation. Returns edit result. */
  applyDependencyEdit(
    nodeIds: string[],
    currentDependsOn: Record<string, string[]>,
    edit: DependencyEdit,
  ): DependencyEditResult;
  /** Validate current adjacency map without applying edits. */
  validateDag(
    nodeIds: string[],
    dependsOn: Record<string, string[]>,
  ): DagValidationResult;
  /** Record a graph edit for audit trail. */
  recordEdit(edit: Omit<GraphEditRecord, 'editId'>): GraphEditRecord;
  snapshot(collectionId: string): GraphAuthoringSessionSnapshot;
}
