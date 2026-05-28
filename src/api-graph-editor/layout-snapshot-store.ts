// src/api-graph-editor/layout-snapshot-store.ts
// Phase E Step 5: In-memory layout snapshot store. Positions are visualization metadata only.
// Swap to JSON persistence via Phase E Step 2 provider when durable storage is needed.

import type { ILayoutSnapshotStore, LayoutSnapshot } from './contracts/node-position.contracts';

export class InMemoryLayoutSnapshotStore implements ILayoutSnapshotStore {
  private readonly _snapshots = new Map<string, LayoutSnapshot>();

  load(collectionId: string): LayoutSnapshot | null {
    return this._snapshots.get(collectionId) ?? null;
  }

  save(snapshot: LayoutSnapshot): void {
    this._snapshots.set(snapshot.collectionId, snapshot);
  }

  delete(collectionId: string): void {
    this._snapshots.delete(collectionId);
  }

  listCollectionIds(): string[] {
    return Array.from(this._snapshots.keys());
  }
}

export const globalLayoutSnapshotStore = new InMemoryLayoutSnapshotStore();
