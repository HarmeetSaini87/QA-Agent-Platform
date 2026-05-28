// src/api-collaboration/__tests__/replay-knowledge-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayKnowledgeStore } from '../replay-knowledge-store';

describe('ReplayKnowledgeStore', () => {
  let store: ReplayKnowledgeStore;
  beforeEach(() => { store = new ReplayKnowledgeStore(); });

  it('addAnnotation + listAnnotations roundtrip', () => {
    store.addAnnotation({ annotationId: 'a1', runId: 'r1', collectionId: 'col-1', authorId: 'alice', body: 'Looks flaky', createdAt: new Date().toISOString() });
    expect(store.listAnnotations('r1')).toHaveLength(1);
  });

  it('listAnnotations: empty for unknown runId', () => {
    expect(store.listAnnotations('ghost')).toHaveLength(0);
  });

  it('listAnnotations: sorted chronologically', () => {
    store.addAnnotation({ annotationId: 'a1', runId: 'r1', collectionId: 'col-1', authorId: 'alice', body: 'First', createdAt: '2026-01-01T00:00:00.000Z' });
    store.addAnnotation({ annotationId: 'a2', runId: 'r1', collectionId: 'col-1', authorId: 'bob', body: 'Second', createdAt: '2026-01-02T00:00:00.000Z' });
    const list = store.listAnnotations('r1');
    expect(list[0].body).toBe('First');
  });

  it('addKnowledgeEntry + getKnowledgeEntry roundtrip', () => {
    store.addKnowledgeEntry({ entryId: 'e1', collectionId: 'col-1', entryType: 'rca-finding', title: 'Root cause', body: 'Auth timeout', linkedRunIds: [], linkedStepIds: [], authorId: 'alice', createdAt: new Date().toISOString() });
    expect(store.getKnowledgeEntry('e1')?.title).toBe('Root cause');
  });

  it('listKnowledgeEntries: filters by entryType', () => {
    store.addKnowledgeEntry({ entryId: 'e1', collectionId: 'col-1', entryType: 'rca-finding', title: 'RCA', body: '', linkedRunIds: [], linkedStepIds: [], authorId: 'alice', createdAt: new Date().toISOString() });
    store.addKnowledgeEntry({ entryId: 'e2', collectionId: 'col-1', entryType: 'flakiness-note', title: 'Flaky', body: '', linkedRunIds: [], linkedStepIds: [], authorId: 'bob', createdAt: new Date().toISOString() });
    expect(store.listKnowledgeEntries('col-1', { entryType: 'rca-finding' })).toHaveLength(1);
  });

  it('getKnowledgeEntry: null for unknown entry', () => {
    expect(store.getKnowledgeEntry('ghost')).toBeNull();
  });
});
