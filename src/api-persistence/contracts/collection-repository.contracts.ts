// src/api-persistence/contracts/collection-repository.contracts.ts
// Phase E Step 2: Repository interface for ApiCollection persistence.

import type { ApiCollection } from '../../data/types';

export interface CollectionQueryOptions {
  projectId?: string;
  tenantId?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface ICollectionRepository {
  findById(id: string): ApiCollection | undefined;
  findAll(options?: CollectionQueryOptions): ApiCollection[];
  save(collection: ApiCollection): ApiCollection;
  delete(id: string): boolean;
  count(options?: CollectionQueryOptions): number;
}
