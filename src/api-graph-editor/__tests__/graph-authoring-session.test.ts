// src/api-graph-editor/__tests__/graph-authoring-session.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphAuthoringSession } from '../graph-authoring-session';
import type { LayoutSnapshot } from '../contracts/node-position.contracts';
import type { DependencyEdit } from '../contracts/dependency-edit.contracts';

function makeLayout(collectionId: string): LayoutSnapshot {
  return {
    collectionId, snapshotVersion: 1, savedAt: new Date().toISOString(),
    positions: { a: { x: 0, y: 0, locked: false } },
    visualGroups: [], layoutLocked: false,
  };
}

function makeEdit(from: string, to: string, op: 'add' | 'remove'): DependencyEdit {
  return { collectionId: 'col-1', fromStepId: from, toStepId: to, operation: op, editedBy: 'user', editedAt: new Date().toISOString() };
}

describe('GraphAuthoringSession', () => {
  let session: GraphAuthoringSession;
  beforeEach(() => { session = new GraphAuthoringSession(); });

  it('saveLayout + loadLayout roundtrip', () => {
    session.saveLayout(makeLayout('col-1'));
    expect(session.loadLayout('col-1')?.collectionId).toBe('col-1');
  });

  it('loadLayout: returns null for unsaved collection', () => {
    expect(session.loadLayout('missing')).toBeNull();
  });

  it('applyDependencyEdit: applied edit reflected in result', () => {
    const result = session.applyDependencyEdit(['a', 'b'], {}, makeEdit('b', 'a', 'add'));
    expect(result.outcome).toBe('applied');
    expect(result.updatedDependsOn).toContain('a');
  });

  it('applyDependencyEdit: cycle rejected', () => {
    const deps = { a: ['b'], b: ['c'] };
    const result = session.applyDependencyEdit(['a', 'b', 'c'], deps, makeEdit('c', 'a', 'add'));
    expect(result.outcome).toBe('rejected-cycle');
  });

  it('validateDag: valid graph returns valid=true', () => {
    const result = session.validateDag(['a', 'b', 'c'], { b: ['a'], c: ['b'] });
    expect(result.valid).toBe(true);
  });

  it('recordEdit + snapshot: edit history increments', () => {
    session.recordEdit({ collectionId: 'col-1', editType: 'node-repositioned', actorId: 'u1', editedAt: new Date().toISOString(), metadata: {} });
    const snap = session.snapshot('col-1');
    expect(snap.editHistoryDepth).toBe(1);
  });

  it('snapshot: fresh collection has no layout and null lastValidation', () => {
    const snap = session.snapshot('brand-new');
    expect(snap.layoutSaved).toBe(false);
    expect(snap.lastValidation).toBeNull();
  });
});
