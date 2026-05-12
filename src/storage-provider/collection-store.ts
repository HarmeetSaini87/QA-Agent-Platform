/**
 * collection-store.ts
 * Lightweight wrapper over existing store.ts for API collections.
 *
 * Phase A: thin delegation only — NO new storage logic.
 * Phase B+: swap internals here without touching callers.
 */

import { readAll, findById, upsert, remove, API_COLLECTIONS } from '../data/store';
import type { ApiCollection } from '../data/types';

export function listCollections(projectId?: string): ApiCollection[] {
  const all = readAll<ApiCollection>(API_COLLECTIONS);
  if (!projectId) return all;
  return all.filter(c => c.projectId === projectId);
}

export function getCollection(id: string): ApiCollection | undefined {
  return findById<ApiCollection>(API_COLLECTIONS, id);
}

export function saveCollection(collection: ApiCollection): ApiCollection {
  return upsert(API_COLLECTIONS, collection);
}

export function deleteCollection(id: string): boolean {
  return remove(API_COLLECTIONS, id);
}
