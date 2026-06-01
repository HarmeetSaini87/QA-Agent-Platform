// src/api-persistence/contracts/storage-provider.contracts.ts
// Phase E Step 2: Storage provider abstraction.
// JSON remains default. Future: SQLite, Postgres, cloud-native swap without touching callers.

export type PersistenceBackend = 'json' | 'sqlite' | 'postgres' | 'azure-blob';

export interface StorageProviderCapabilities {
  readonly backend: PersistenceBackend;
  readonly supportsAtomicWrite: boolean;
  readonly supportsTransactions: boolean;
  readonly supportsPartialUpdate: boolean;
  readonly supportsPagination: boolean;
  readonly supportsIndexedQuery: boolean;
}

/** Generic typed key-value storage over a named collection/table. */
export interface IStorageProvider {
  readonly capabilities: StorageProviderCapabilities;
  readAll<T>(collection: string): T[];
  writeAll<T>(collection: string, records: T[]): void;
  findById<T extends { id: string }>(collection: string, id: string): T | undefined;
  upsert<T extends { id: string }>(collection: string, record: T): T;
  remove(collection: string, id: string): boolean;
}

/** Provider that additionally supports atomic file-level writes. */
export interface IAtomicStorageProvider extends IStorageProvider {
  atomicWriteFile(filePath: string, data: string): void;
  readFile(filePath: string): string | null;
  fileExists(filePath: string): boolean;
  ensureDir(dirPath: string): void;
}

export interface StorageProviderHealth {
  readonly backend: PersistenceBackend;
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly detail?: string;
}
