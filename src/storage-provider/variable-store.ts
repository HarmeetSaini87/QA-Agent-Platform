/**
 * variable-store.ts
 * Lightweight wrapper for variable persistence.
 *
 * Variables live in three separate locations today:
 *
 *   A. ApiEnvironment.variables  → api-envs.json   (ApiVariable[] on env record)
 *   B. ApiCollection.variables   → api-collections.json (ApiVariable[] on collection record)
 *   C. CommonData records        → common_data.json (COMMON_DATA collection, module-scoped)
 *
 * This store provides named accessors for each so callers don't scatter
 * raw readAll(API_ENVS) calls across the codebase.
 *
 * Phase A: thin delegation only.
 * Phase B+: variable-engine/ will call this store instead of reading envs/collections directly.
 *
 * IMPORTANT:
 *   - Sensitive ApiVariables are stored encrypted (enc:<base64> prefix) by apiSecrets.ts.
 *   - This store does NOT decrypt — callers use decryptSensitiveVars() from apiSecrets.ts.
 *   - CommonData.value is also conditionally encrypted when sensitive=true.
 *   - This store is read-only for variables — mutations go through the env/collection stores.
 *
 * DEPENDENCY BOUNDARY:
 *   - No Playwright, no Express, no auth
 *   - Reads env/collection records via environment-store and collection-store
 *   - Reads CommonData via store.ts directly (no wrapper exists yet — acceptable for Phase A)
 */

import { readAll, COMMON_DATA } from '../data/store';
import type { ApiVariable, CommonData } from '../data/types';
import { getEnvironment } from './environment-store';
import { getCollection } from './collection-store';

// ── Environment variables ─────────────────────────────────────────────────────

/**
 * Get raw (potentially encrypted) variables for an environment.
 * Pass result through decryptSensitiveVars() before use in execution.
 */
export function getEnvironmentVariables(environmentId: string): ApiVariable[] {
  return getEnvironment(environmentId)?.variables ?? [];
}

// ── Collection variables ──────────────────────────────────────────────────────

/**
 * Get raw (potentially encrypted) variables for a collection.
 * Pass result through decryptSensitiveVars() before use in execution.
 */
export function getCollectionVariables(collectionId: string): ApiVariable[] {
  return getCollection(collectionId)?.variables ?? [];
}

// ── CommonData (platform-wide shared variables by environment) ─────────────────

/**
 * List all CommonData records for a project + environment.
 * Filter by moduleType to get api-specific or shared variables.
 */
export function listCommonData(
  projectId: string,
  environment: string,
  moduleType?: CommonData['moduleType'],
): CommonData[] {
  const all = readAll<CommonData>(COMMON_DATA);
  return all.filter(d =>
    d.projectId === projectId &&
    d.environment === environment &&
    (moduleType === undefined || d.moduleType === moduleType),
  );
}

/**
 * Resolve CommonData to a flat key→value map.
 * Sensitive values are returned as-is (encrypted) — caller decrypts.
 */
export function resolveCommonDataMap(
  projectId: string,
  environment: string,
  moduleType?: CommonData['moduleType'],
): Record<string, string> {
  const records = listCommonData(projectId, environment, moduleType);
  const map: Record<string, string> = {};
  for (const record of records) {
    map[record.dataName] = record.value;
  }
  return map;
}

/**
 * Build the full variable scope layer for a collection run.
 * Returns raw (unresolved) values — variable-engine merges and resolves scope priority.
 *
 * Layer order (lowest → highest priority, matches shared-core VariableScope):
 *   commonData (project+env shared) → collection.variables → environment.variables
 *
 * NOTE: global and runtime scopes are not persisted — injected at execution time.
 */
export function buildScopeLayers(opts: {
  projectId: string;
  environmentId: string;
  collectionId: string;
  environment: string;   // environment name e.g. "QA" — for CommonData lookup
}): {
  commonData: Record<string, string>;
  collection:  ApiVariable[];
  environment: ApiVariable[];
} {
  return {
    commonData:  resolveCommonDataMap(opts.projectId, opts.environment, 'api'),
    collection:  getCollectionVariables(opts.collectionId),
    environment: getEnvironmentVariables(opts.environmentId),
  };
}
