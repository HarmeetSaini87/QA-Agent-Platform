// src/api-persistence/__tests__/json-audit-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { JsonAuditRepository } from '../repositories/json-audit-repository';
import type { IStorageProvider, StorageProviderCapabilities } from '../contracts/storage-provider.contracts';
import type { AuditEntry } from '../../data/types';

class InMemoryProvider implements IStorageProvider {
  readonly capabilities: StorageProviderCapabilities = {
    backend: 'json', supportsAtomicWrite: false, supportsTransactions: false,
    supportsPartialUpdate: false, supportsPagination: false, supportsIndexedQuery: false,
  };
  private readonly _store = new Map<string, unknown[]>();
  readAll<T>(col: string): T[] { return (this._store.get(col) ?? []) as T[]; }
  writeAll<T>(col: string, r: T[]): void { this._store.set(col, r as unknown[]); }
  findById<T extends { id: string }>(col: string, id: string): T | undefined {
    return this.readAll<T>(col).find(r => r.id === id);
  }
  upsert<T extends { id: string }>(col: string, r: T): T {
    const all = this.readAll<T>(col);
    const idx = all.findIndex(x => x.id === r.id);
    if (idx >= 0) all[idx] = r; else all.push(r);
    this.writeAll(col, all); return r;
  }
  remove(col: string, id: string): boolean {
    const all = this.readAll<{ id: string }>(col);
    const f = all.filter(r => r.id !== id);
    if (f.length === all.length) return false;
    this.writeAll(col, f); return true;
  }
}

function makeEntry(id: string, userId: string, action: string, ts: string): AuditEntry {
  return {
    id, userId, username: userId, action, resourceType: null,
    resourceId: null, details: null, ip: '127.0.0.1', createdAt: ts,
  };
}

describe('JsonAuditRepository', () => {
  let repo: JsonAuditRepository;
  beforeEach(() => { repo = new JsonAuditRepository(new InMemoryProvider()); });

  it('append and query roundtrip', () => {
    repo.append(makeEntry('e1', 'u1', 'login', '2026-01-01T00:00:00Z'));
    expect(repo.query()).toHaveLength(1);
  });

  it('query filters by userId', () => {
    repo.append(makeEntry('e1', 'u1', 'login', '2026-01-01T00:00:00Z'));
    repo.append(makeEntry('e2', 'u2', 'login', '2026-01-02T00:00:00Z'));
    expect(repo.query({ userId: 'u1' })).toHaveLength(1);
  });

  it('query filters by action', () => {
    repo.append(makeEntry('e1', 'u1', 'login', '2026-01-01T00:00:00Z'));
    repo.append(makeEntry('e2', 'u1', 'logout', '2026-01-02T00:00:00Z'));
    expect(repo.query({ action: 'login' })).toHaveLength(1);
  });

  it('query returns newest first', () => {
    repo.append(makeEntry('e1', 'u1', 'login', '2026-01-01T00:00:00Z'));
    repo.append(makeEntry('e2', 'u1', 'login', '2026-01-03T00:00:00Z'));
    const results = repo.query();
    expect(results[0].createdAt > results[1].createdAt).toBe(true);
  });

  it('count matches query length', () => {
    repo.append(makeEntry('e1', 'u1', 'login', '2026-01-01T00:00:00Z'));
    repo.append(makeEntry('e2', 'u2', 'login', '2026-01-02T00:00:00Z'));
    expect(repo.count()).toBe(2);
    expect(repo.count({ userId: 'u1' })).toBe(1);
  });
});
