/**
 * spec-loader.ts
 * OpenAPI spec file loading + AJV compiled validator cache.
 *
 * Centralises all schema I/O and compilation so ContractEngine never
 * touches fs or AJV directly — keeps those concerns replaceable in Phase C+.
 *
 * Cache key: specId — evicted only on process restart (singleton lifetime).
 * DATA_DIR is resolved per-call so tests can override process.env.DATA_DIR.
 */

import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';

// Shared AJV instance — one per process, compiled validators cached below
const _ajv = new Ajv();

// Compiled validator cache: `${specId}:${statusCode}` → ValidateFunction
const _compiled = new Map<string, ValidateFunction>();

export interface LoadedSchema {
  validate: ValidateFunction;
  cacheKey: string;
}

function getOaSpecsDir(): string {
  return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'openapi-specs');
}

/** Stable export for callers that need the directory path */
export function getSpecsDir(): string {
  return getOaSpecsDir();
}

/**
 * Load an OpenAPI spec from disk and return the compiled AJV validator
 * for the `application/json` response schema matching `statusCode`.
 * Returns undefined if spec not found, status not defined, or schema absent.
 */
export function loadResponseSchema(
  specId: string,
  statusCode: number
): LoadedSchema | undefined {
  const cacheKey = `${specId}:${statusCode}`;
  const cached = _compiled.get(cacheKey);
  if (cached) return { validate: cached, cacheKey };

  const specPath = path.join(getOaSpecsDir(), `${specId}.json`);
  if (!fs.existsSync(specPath)) return undefined;

  let spec: Record<string, unknown>;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as Record<string, unknown>;
  } catch { return undefined; }

  const paths = spec['paths'] as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return undefined;

  for (const pathItem of Object.values(paths)) {
    for (const op of Object.values(pathItem)) {
      const responses = (op as Record<string, unknown>)?.['responses'] as
        Record<string, unknown> | undefined;
      if (!responses) continue;
      const resp = responses[String(statusCode)] as Record<string, unknown> | undefined;
      if (!resp) continue;
      const content = resp['content'] as Record<string, Record<string, unknown>> | undefined;
      const schema = content?.['application/json']?.['schema'];
      if (!schema) continue;
      try {
        const validate = _ajv.compile(schema);
        _compiled.set(cacheKey, validate);
        return { validate, cacheKey };
      } catch { return undefined; }
    }
  }
  return undefined;
}

/** Invalidate cached validator — useful in tests when spec files change */
export function evictSchema(specId: string, statusCode: number): void {
  _compiled.delete(`${specId}:${statusCode}`);
}

/** True if spec file exists on disk */
export function specExists(specId: string): boolean {
  return fs.existsSync(path.join(getOaSpecsDir(), `${specId}.json`));
}

/** @deprecated Use getSpecsDir() — kept for backward compat */
export const OA_SPECS_DIR = path.join(path.resolve(process.env.DATA_DIR || 'data'), 'openapi-specs');
