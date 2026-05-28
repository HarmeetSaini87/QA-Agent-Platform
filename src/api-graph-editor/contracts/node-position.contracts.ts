// src/api-graph-editor/contracts/node-position.contracts.ts
// Phase E Step 5: Node position persistence contracts.
// WorkflowEnvelope remains authoritative — positions are visualization metadata only.

export interface NodePosition {
  readonly x: number;
  readonly y: number;
  readonly locked: boolean;
}

export interface VisualGroupEntry {
  readonly groupId: string;
  readonly label: string;
  readonly nodeIds: readonly string[];
  readonly color?: string;
}

export interface LayoutSnapshot {
  readonly collectionId: string;
  readonly snapshotVersion: number;
  readonly savedAt: string;
  /** stepId → position */
  readonly positions: Record<string, NodePosition>;
  readonly visualGroups: VisualGroupEntry[];
  /** When true, this layout was explicitly locked by the user and won't be auto-overwritten. */
  readonly layoutLocked: boolean;
}

export interface ILayoutSnapshotStore {
  load(collectionId: string): LayoutSnapshot | null;
  save(snapshot: LayoutSnapshot): void;
  delete(collectionId: string): void;
  listCollectionIds(): string[];
}
