// src/api-graph-editor/__tests__/layout-snapshot-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryLayoutSnapshotStore } from '../layout-snapshot-store';
import type { LayoutSnapshot } from '../contracts/node-position.contracts';

function makeSnapshot(collectionId: string): LayoutSnapshot {
  return {
    collectionId,
    snapshotVersion: 1,
    savedAt: new Date().toISOString(),
    positions: { 'step-1': { x: 100, y: 200, locked: false } },
    visualGroups: [],
    layoutLocked: false,
  };
}

describe('InMemoryLayoutSnapshotStore', () => {
  let store: InMemoryLayoutSnapshotStore;
  beforeEach(() => { store = new InMemoryLayoutSnapshotStore(); });

  it('load: returns null for unknown collection', () => {
    expect(store.load('unknown')).toBeNull();
  });

  it('save + load roundtrip', () => {
    store.save(makeSnapshot('col-1'));
    const loaded = store.load('col-1');
    expect(loaded?.collectionId).toBe('col-1');
    expect(loaded?.positions['step-1'].x).toBe(100);
  });

  it('save: overwrites existing snapshot', () => {
    store.save(makeSnapshot('col-1'));
    const updated: LayoutSnapshot = { ...makeSnapshot('col-1'), snapshotVersion: 2, layoutLocked: true };
    store.save(updated);
    expect(store.load('col-1')?.snapshotVersion).toBe(2);
    expect(store.load('col-1')?.layoutLocked).toBe(true);
  });

  it('delete: removes snapshot', () => {
    store.save(makeSnapshot('col-1'));
    store.delete('col-1');
    expect(store.load('col-1')).toBeNull();
  });

  it('listCollectionIds: lists all saved collections', () => {
    store.save(makeSnapshot('col-1'));
    store.save(makeSnapshot('col-2'));
    expect(store.listCollectionIds()).toContain('col-1');
    expect(store.listCollectionIds()).toContain('col-2');
  });
});
