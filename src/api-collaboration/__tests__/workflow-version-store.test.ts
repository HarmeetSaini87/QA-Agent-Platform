// src/api-collaboration/__tests__/workflow-version-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowVersionStore } from '../workflow-version-store';
import type { WorkflowRevision } from '../contracts/workflow-version.contracts';

function makeRevision(collectionId: string, revNum: number, status: WorkflowRevision['status'] = 'draft'): WorkflowRevision {
  return {
    revisionId: `rev-${collectionId}-${revNum}`,
    collectionId, revisionNumber: revNum, status,
    authorId: 'alice', createdAt: new Date().toISOString(),
    description: `Rev ${revNum}`,
    stepSnapshot: [{ stepId: 's1', dependsOn: [] }, { stepId: 's2', dependsOn: ['s1'] }],
    linkedRunIds: [],
  };
}

describe('WorkflowVersionStore', () => {
  let store: WorkflowVersionStore;
  beforeEach(() => { store = new WorkflowVersionStore(); });

  it('saveRevision + getRevision roundtrip', () => {
    const rev = makeRevision('col-1', 1);
    store.saveRevision(rev);
    expect(store.getRevision(rev.revisionId)?.revisionNumber).toBe(1);
  });

  it('listRevisions: sorted newest first', () => {
    store.saveRevision(makeRevision('col-1', 1));
    store.saveRevision(makeRevision('col-1', 2));
    store.saveRevision(makeRevision('col-1', 3));
    const list = store.listRevisions('col-1');
    expect(list[0].revisionNumber).toBe(3);
  });

  it('getLatestPublished: returns published revision', () => {
    store.saveRevision(makeRevision('col-1', 1, 'draft'));
    store.saveRevision(makeRevision('col-1', 2, 'published'));
    expect(store.getLatestPublished('col-1')?.revisionNumber).toBe(2);
  });

  it('getLatestPublished: null when none published', () => {
    store.saveRevision(makeRevision('col-1', 1, 'draft'));
    expect(store.getLatestPublished('col-1')).toBeNull();
  });

  it('diff: detects added/removed steps and dependency changes', () => {
    const rev1 = { ...makeRevision('col-1', 1), stepSnapshot: [{ stepId: 's1', dependsOn: [] }] };
    const rev2 = { ...makeRevision('col-1', 2), revisionId: 'rev-col-1-2', stepSnapshot: [{ stepId: 's1', dependsOn: [] }, { stepId: 's2', dependsOn: ['s1'] }] };
    store.saveRevision(rev1);
    store.saveRevision(rev2);
    const diff = store.diff(rev1.revisionId, rev2.revisionId);
    expect(diff?.stepsAdded).toContain('s2');
    expect(diff?.stepsRemoved).toHaveLength(0);
  });

  it('rollback: creates new revision as rollback copy', () => {
    const rev1 = makeRevision('col-1', 1, 'published');
    store.saveRevision(rev1);
    store.saveRevision(makeRevision('col-1', 2, 'published'));
    const rollback = store.rollback('col-1', rev1.revisionId, 'bob');
    expect(rollback?.description).toContain('Rollback');
    expect(rollback?.status).toBe('published');
    expect(store.listRevisions('col-1')).toHaveLength(3);
  });
});
