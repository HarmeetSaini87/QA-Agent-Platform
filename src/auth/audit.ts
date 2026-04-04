/**
 * audit.ts — write audit log entries
 */

import { v4 as uuidv4 } from 'uuid';
import { upsert, readAll, writeAll, AUDIT } from '../data/store';
import { AuditEntry } from '../data/types';

export function logAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): void {
  const record: AuditEntry = {
    id:        uuidv4(),
    createdAt: new Date().toISOString(),
    ...entry,
  };
  upsert(AUDIT, record);

  // Keep last 10 000 entries (trim oldest)
  const all = readAll<AuditEntry>(AUDIT);
  if (all.length > 10_000) {
    writeAll(AUDIT, all.slice(all.length - 10_000));
  }
}
