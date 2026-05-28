// src/api-persistence/repositories/json-collection-repository.ts
// Phase E Step 2: JSON-backed ICollectionRepository.
// Wraps store.ts API_COLLECTIONS — zero behavior change.

import { API_COLLECTIONS } from '../../data/store';
import type { ApiCollection } from '../../data/types';
import type { ICollectionRepository, CollectionQueryOptions } from '../contracts/collection-repository.contracts';
import type { IStorageProvider } from '../contracts/storage-provider.contracts';

export class JsonCollectionRepository implements ICollectionRepository {
  constructor(private readonly _store: IStorageProvider) {}

  findById(id: string): ApiCollection | undefined {
    return this._store.findById<ApiCollection>(API_COLLECTIONS, id);
  }

  findAll(options?: CollectionQueryOptions): ApiCollection[] {
    let all = this._store.readAll<ApiCollection>(API_COLLECTIONS);

    if (options?.projectId) all = all.filter(c => c.projectId === options.projectId);
    if (options?.tenantId) all = all.filter(c => c.tenantId === options.tenantId);
    if (options?.tag) all = all.filter(c => c.tags?.includes(options.tag!));

    if (options?.offset) all = all.slice(options.offset);
    if (options?.limit) all = all.slice(0, options.limit);

    return all;
  }

  save(collection: ApiCollection): ApiCollection {
    return this._store.upsert<ApiCollection>(API_COLLECTIONS, collection);
  }

  delete(id: string): boolean {
    return this._store.remove(API_COLLECTIONS, id);
  }

  count(options?: CollectionQueryOptions): number {
    return this.findAll(options).length;
  }
}
