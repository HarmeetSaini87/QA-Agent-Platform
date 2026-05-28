// src/api-persistence/contracts/audit-repository.contracts.ts
// Phase E Step 2: Repository interface for immutable audit trail persistence.
// Audit records are append-only — no update or delete operations exposed.

import type { AuditEntry } from '../../data/types';

export interface AuditQueryOptions {
  userId?: string;
  action?: string;
  tenantId?: string;
  since?: string;
  limit?: number;
  offset?: number;
}

export interface IAuditRepository {
  /** Append a single audit record. Immutable — no updates. */
  append(entry: AuditEntry): void;
  /** Query audit log with optional filters. */
  query(options?: AuditQueryOptions): AuditEntry[];
  count(options?: AuditQueryOptions): number;
}
