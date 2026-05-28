// src/api-persistence/__tests__/json-collection-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { JsonCollectionRepository } from '../repositories/json-collection-repository';
import type { IStorageProvider, StorageProviderCapabilities } from '../contracts/storage-provider.contracts';
import type { ApiCollection } from '../../data/types';

function makeCollection(id: string, overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id,
    name: `Collection ${id}`,
    environmentId: 'env1',
    steps: [],
    variables: [],
    onFailure: 'stop',
    executionMode: 'sequential',
    ...overrides,
  };
}

class InMemoryProvider implements IStorageProvider {
  readonly capabilities: StorageProviderCapabilities = {
    backend: 'json', supportsAtomicWrite: false, supportsTransactions: false,
    supportsPartialUpdate: false, supportsPagination: false, supportsIndexedQuery: false,
  };
  private readonly _store = new Map<string, unknown[]>();

  readAll<T>(collection: string): T[] { return (this._store.get(collection) ?? []) as T[]; }
  writeAll<T>(collection: string, records: T[]): void { this._store.set(collection, records as unknown[]); }
  findById<T extends { id: string }>(collection: string, id: string): T | undefined {
    return this.readAll<T>(collection).find(r => r.id === id);
  }
  upsert<T extends { id: string }>(collection: string, record: T): T {
    const all = this.readAll<T>(collection);
    const idx = all.findIndex(r => r.id === record.id);
    if (idx >= 0) all[idx] = record; else all.push(record);
    this.writeAll(collection, all);
    return record;
  }
  remove(collection: string, id: string): boolean {
    const all = this.readAll<{ id: string }>(collection);
    const filtered = all.filter(r => r.id !== id);
    if (filtered.length === all.length) return false;
    this.writeAll(collection, filtered);
    return true;
  }
}

describe('JsonCollectionRepository', () => {
  let repo: JsonCollectionRepository;
  beforeEach(() => { repo = new JsonCollectionRepository(new InMemoryProvider()); });

  it('findById returns undefined for missing', () => {
    expect(repo.findById('x')).toBeUndefined();
  });

  it('save and findById roundtrip', () => {
    const c = makeCollection('c1');
    repo.save(c);
    expect(repo.findById('c1')).toEqual(c);
  });

  it('findAll filters by projectId', () => {
    repo.save(makeCollection('c1', { projectId: 'p1' }));
    repo.save(makeCollection('c2', { projectId: 'p2' }));
    expect(repo.findAll({ projectId: 'p1' })).toHaveLength(1);
  });

  it('findAll filters by tag', () => {
    repo.save(makeCollection('c1', { tags: ['smoke'] }));
    repo.save(makeCollection('c2', { tags: ['regression'] }));
    expect(repo.findAll({ tag: 'smoke' })).toHaveLength(1);
  });

  it('delete removes collection', () => {
    repo.save(makeCollection('c1'));
    expect(repo.delete('c1')).toBe(true);
    expect(repo.findById('c1')).toBeUndefined();
  });

  it('count returns total', () => {
    repo.save(makeCollection('c1'));
    repo.save(makeCollection('c2'));
    expect(repo.count()).toBe(2);
  });
});
