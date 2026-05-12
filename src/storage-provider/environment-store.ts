/**
 * environment-store.ts
 * Lightweight wrapper over existing store.ts for API environments.
 *
 * Phase A: thin delegation only.
 */

import { readAll, findById, upsert, remove, API_ENVS } from '../data/store';
import type { ApiEnvironment } from '../data/types';

export function listEnvironments(projectId?: string): ApiEnvironment[] {
  const all = readAll<ApiEnvironment>(API_ENVS);
  if (!projectId) return all;
  return all.filter(e => e.projectId === projectId);
}

export function getEnvironment(id: string): ApiEnvironment | undefined {
  return findById<ApiEnvironment>(API_ENVS, id);
}

export function saveEnvironment(env: ApiEnvironment): ApiEnvironment {
  return upsert(API_ENVS, env);
}

export function deleteEnvironment(id: string): boolean {
  return remove(API_ENVS, id);
}
