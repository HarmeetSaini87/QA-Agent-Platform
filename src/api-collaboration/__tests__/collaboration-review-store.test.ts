// src/api-collaboration/__tests__/collaboration-review-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CollaborationReviewStore } from '../collaboration-review-store';
import type { ReviewComment } from '../contracts/collaboration-review.contracts';

function makeComment(id: string, collectionId = 'col-1', targetType: ReviewComment['targetType'] = 'step'): ReviewComment {
  return { commentId: id, collectionId, authorId: 'alice', targetType, targetId: 'step-1', body: 'Needs fix', status: 'open', createdAt: new Date().toISOString() };
}

describe('CollaborationReviewStore', () => {
  let store: CollaborationReviewStore;
  beforeEach(() => { store = new CollaborationReviewStore(); });

  it('addComment + listComments roundtrip', () => {
    store.addComment(makeComment('c1'));
    expect(store.listComments('col-1')).toHaveLength(1);
  });

  it('listComments: filters by targetType', () => {
    store.addComment(makeComment('c1', 'col-1', 'step'));
    store.addComment(makeComment('c2', 'col-1', 'dependency'));
    expect(store.listComments('col-1', { targetType: 'step' })).toHaveLength(1);
  });

  it('resolveComment: transitions to resolved', () => {
    store.addComment(makeComment('c1'));
    expect(store.resolveComment('c1', 'bob')).toBe(true);
    const comment = store.listComments('col-1')[0];
    expect(comment.status).toBe('resolved');
    expect(comment.resolvedAt).toBeTruthy();
  });

  it('resolveComment: returns false for unknown comment', () => {
    expect(store.resolveComment('ghost', 'bob')).toBe(false);
  });

  it('listComments: filters by status', () => {
    store.addComment(makeComment('c1'));
    store.resolveComment('c1', 'bob');
    store.addComment(makeComment('c2'));
    expect(store.listComments('col-1', { status: 'open' })).toHaveLength(1);
    expect(store.listComments('col-1', { status: 'resolved' })).toHaveLength(1);
  });

  it('createThread + getThread roundtrip', () => {
    store.createThread({ threadId: 't1', collectionId: 'col-1', title: 'Review DAG', comments: [], createdAt: new Date().toISOString() });
    expect(store.getThread('t1')?.title).toBe('Review DAG');
  });
});
