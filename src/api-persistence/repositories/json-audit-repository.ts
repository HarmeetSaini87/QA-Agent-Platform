// src/api-persistence/repositories/json-audit-repository.ts
// Phase E Step 2: JSON-backed IAuditRepository.
// Wraps data/audit.json via store.ts. Audit is append-only — no update or delete.

import { AUDIT } from '../../data/store';
import type { AuditEntry } from '../../data/types';
import type { IAuditRepository, AuditQueryOptions } from '../contracts/audit-repository.contracts';
import type { IStorageProvider } from '../contracts/storage-provider.contracts';

export class JsonAuditRepository implements IAuditRepository {
  constructor(private readonly _store: IStorageProvider) {}

  append(entry: AuditEntry): void {
    const all = this._store.readAll<AuditEntry>(AUDIT);
    all.push(entry);
    this._store.writeAll(AUDIT, all);
  }

  query(options?: AuditQueryOptions): AuditEntry[] {
    let all = this._store.readAll<AuditEntry>(AUDIT);

    if (options?.userId) all = all.filter(e => e.userId === options.userId);
    if (options?.action) all = all.filter(e => e.action === options.action);
    if (options?.since) all = all.filter(e => e.createdAt >= options.since!);

    // Sort newest-first
    all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (options?.offset) all = all.slice(options.offset);
    if (options?.limit) all = all.slice(0, options.limit);

    return all;
  }

  count(options?: AuditQueryOptions): number {
    return this.query({ ...options, limit: undefined, offset: undefined }).length;
  }
}
