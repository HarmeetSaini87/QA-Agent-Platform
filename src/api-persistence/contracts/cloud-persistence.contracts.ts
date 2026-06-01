// src/api-persistence/contracts/cloud-persistence.contracts.ts
// Phase E Step 2: Future SQL / cloud-native persistence extension point interfaces.
// All are stubs today — Phase E Steps 7+ will wire real implementations.

import type { PersistenceBackend, IStorageProvider } from './storage-provider.contracts';

/** SQL-capable provider — future SQLite or Postgres. */
export interface ISqlStorageProvider extends IStorageProvider {
  readonly backend: 'sqlite' | 'postgres';
  executeRaw(sql: string, params?: unknown[]): unknown[];
  beginTransaction(): ISqlTransaction;
}

export interface ISqlTransaction {
  commit(): void;
  rollback(): void;
}

/** Cloud blob / object storage provider — future Azure Blob, S3, GCS. */
export interface ICloudStorageProvider {
  readonly backend: PersistenceBackend;
  putObject(key: string, data: Buffer | string): Promise<void>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<boolean>;
  listObjects(prefix: string): Promise<string[]>;
}

/** Tenant-partitioned storage — future multi-tenant shard routing. */
export interface ITenantPartitionedProvider<TProvider extends IStorageProvider> {
  forTenant(tenantId: string): TProvider;
}

/** Archive tier for cold replay storage — future long-term retention. */
export interface IReplayArchiveTier {
  archiveRun(runId: string): Promise<void>;
  restoreRun(runId: string): Promise<void>;
  isArchived(runId: string): Promise<boolean>;
}

/** No-op stubs for all cloud extension points. */
export class NoOpSqlProvider implements Partial<ISqlStorageProvider> {
  readonly backend = 'sqlite' as const;
  executeRaw(_sql: string, _params?: unknown[]): unknown[] { return []; }
}

export class NoOpReplayArchiveTier implements IReplayArchiveTier {
  async archiveRun(_runId: string): Promise<void> {}
  async restoreRun(_runId: string): Promise<void> {}
  async isArchived(_runId: string): Promise<boolean> { return false; }
}
