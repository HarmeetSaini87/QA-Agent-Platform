/**
 * baseline.ts
 * Phase B Step 7 extraction from apiRunner.ts.
 *
 * Moved: deepJsonDiff, diffBaseline, loadBaseline, saveBaseline.
 * apiRunner.ts retains commented-out originals per CLAUDE.md rule.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ApiResponseSnapshot, BaselineDiff, JsonDiff } from '../../data/types';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const BASELINES_DIR = path.join(DATA_DIR, 'api-baselines');

export function deepJsonDiff(expected: unknown, actual: unknown, pathPrefix = '$'): JsonDiff[] {
  const diffs: JsonDiff[] = [];
  if (
    typeof expected !== 'object' || expected === null ||
    typeof actual !== 'object' || actual === null
  ) {
    if (expected !== actual) diffs.push({ path: pathPrefix, expected, actual });
    return diffs;
  }
  const expObj = expected as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(expObj), ...Object.keys(actObj)]);
  for (const k of allKeys) {
    diffs.push(...deepJsonDiff(expObj[k], actObj[k], `${pathPrefix}.${k}`));
  }
  return diffs;
}

export function diffBaseline(baseline: ApiResponseSnapshot, current: ApiResponseSnapshot): BaselineDiff {
  const baselineHeaderKeys = new Set(Object.keys(baseline.headers).map(k => k.toLowerCase()));
  const currentHeaderKeys  = new Set(Object.keys(current.headers).map(k => k.toLowerCase()));
  return {
    statusChanged:   baseline.status !== current.status,
    headersAdded:    [...currentHeaderKeys].filter(k => !baselineHeaderKeys.has(k)),
    headersRemoved:  [...baselineHeaderKeys].filter(k => !currentHeaderKeys.has(k)),
    bodyDiff:        deepJsonDiff(baseline.body, current.body),
  };
}

export function loadBaseline(stepId: string): ApiResponseSnapshot | null {
  const p = path.join(BASELINES_DIR, `${stepId}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as ApiResponseSnapshot; } catch { return null; }
}

export function saveBaseline(stepId: string, snapshot: ApiResponseSnapshot): void {
  if (!fs.existsSync(BASELINES_DIR)) fs.mkdirSync(BASELINES_DIR, { recursive: true });
  const clean: ApiResponseSnapshot = {
    status: snapshot.status, headers: snapshot.headers,
    body: snapshot.body, durationMs: snapshot.durationMs, bodyTruncated: false,
  };
  fs.writeFileSync(path.join(BASELINES_DIR, `${stepId}.json`), JSON.stringify(clean, null, 2));
}
