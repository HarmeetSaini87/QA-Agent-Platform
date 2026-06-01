// src/api-persistence/providers/json-storage-provider.ts
// Phase E Step 2: JSON storage provider — wraps existing store.ts.
// Zero behavior change — all existing persistence continues to work identically.

import * as fs from 'fs';
import * as path from 'path';
import { readAll, writeAll, findById, upsert, remove } from '../../data/store';
import type {
  IAtomicStorageProvider,
  StorageProviderCapabilities,
} from '../contracts/storage-provider.contracts';

export class JsonStorageProvider implements IAtomicStorageProvider {
  readonly capabilities: StorageProviderCapabilities = {
    backend: 'json',
    supportsAtomicWrite: true,
    supportsTransactions: false,
    supportsPartialUpdate: false,
    supportsPagination: false,
    supportsIndexedQuery: false,
  };

  readAll<T>(collection: string): T[] {
    return readAll<T>(collection);
  }

  writeAll<T>(collection: string, records: T[]): void {
    writeAll(collection, records);
  }

  findById<T extends { id: string }>(collection: string, id: string): T | undefined {
    return findById<T>(collection, id);
  }

  upsert<T extends { id: string }>(collection: string, record: T): T {
    return upsert(collection, record);
  }

  remove(collection: string, id: string): boolean {
    return remove(collection, id);
  }

  atomicWriteFile(filePath: string, data: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, filePath);
  }

  readFile(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    try { return fs.readFileSync(filePath, 'utf8'); }
    catch { return null; }
  }

  fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  }
}

export const globalJsonStorageProvider = new JsonStorageProvider();
