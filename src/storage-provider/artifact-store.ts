/**
 * artifact-store.ts
 * Lightweight wrapper for non-run artifacts: baselines, HAR, execution timelines.
 *
 * Storage layout (all under DATA_DIR):
 *   data/api-baselines/<collectionId>__<stepId>.json   → ApiResponseSnapshot
 *   data/api-har/<runId>.har.json                      → HarArtifact
 *   data/api-timelines/<runId>.timeline.json           → ExecutionTimeline
 *
 * Phase A: thin file-I/O delegation only.
 * Phase C+: IArtifactEngine implementation replaces this with typed engine.
 *
 * DEPENDENCY BOUNDARY:
 *   - No Playwright, no Express, no auth
 *   - Plain JSON reads/writes only
 *   - Types imported from shared-core contracts and data/types
 */

import * as fs   from 'fs';
import * as path from 'path';
import type { ApiResponseSnapshot } from '../data/types';
import type { HarArtifact, ExecutionTimeline } from '../shared-core/contracts/artifact.contract';

// ── Directory helpers ─────────────────────────────────────────────────────────

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || 'data');
}

function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function baselinesDir(): string  { return ensureDir(path.join(dataDir(), 'api-baselines')); }
function harDir(): string        { return ensureDir(path.join(dataDir(), 'api-har')); }
function timelinesDir(): string  { return ensureDir(path.join(dataDir(), 'api-timelines')); }

// ── Baseline snapshots (response contract drift detection) ────────────────────

function baselineFilename(collectionId: string, stepId: string): string {
  return `${collectionId}__${stepId}.json`;
}

export function saveBaseline(
  collectionId: string,
  stepId: string,
  snapshot: ApiResponseSnapshot,
): void {
  const file = path.join(baselinesDir(), baselineFilename(collectionId, stepId));
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
}

export function loadBaseline(
  collectionId: string,
  stepId: string,
): ApiResponseSnapshot | undefined {
  const file = path.join(baselinesDir(), baselineFilename(collectionId, stepId));
  if (!fs.existsSync(file)) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as ApiResponseSnapshot; }
  catch { return undefined; }
}

export function deleteBaseline(collectionId: string, stepId: string): boolean {
  const file = path.join(baselinesDir(), baselineFilename(collectionId, stepId));
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/** List all step IDs that have a saved baseline for a collection */
export function listBaselineStepIds(collectionId: string): string[] {
  const dir = baselinesDir();
  const prefix = `${collectionId}__`;
  return fs.existsSync(dir)
    ? fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
        .map(f => f.slice(prefix.length, -5))   // remove prefix and .json
    : [];
}

// ── HAR artifacts ─────────────────────────────────────────────────────────────

function harPath(runId: string): string {
  return path.join(harDir(), `${runId}.har.json`);
}

export function saveHar(har: HarArtifact): void {
  fs.writeFileSync(harPath(har.runId), JSON.stringify(har, null, 2));
}

export function loadHar(runId: string): HarArtifact | undefined {
  const file = harPath(runId);
  if (!fs.existsSync(file)) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as HarArtifact; }
  catch { return undefined; }
}

export function deleteHar(runId: string): boolean {
  const file = harPath(runId);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

// ── Execution timelines (debugger feed) ───────────────────────────────────────

function timelinePath(runId: string): string {
  return path.join(timelinesDir(), `${runId}.timeline.json`);
}

export function saveTimeline(timeline: ExecutionTimeline): void {
  fs.writeFileSync(timelinePath(timeline.runId), JSON.stringify(timeline, null, 2));
}

export function loadTimeline(runId: string): ExecutionTimeline | undefined {
  const file = timelinePath(runId);
  if (!fs.existsSync(file)) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as ExecutionTimeline; }
  catch { return undefined; }
}

export function deleteTimeline(runId: string): boolean {
  const file = timelinePath(runId);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

// ── Unified delete for a complete run's artifacts ─────────────────────────────

/**
 * Delete all artifacts associated with a run (HAR + timeline).
 * Run result and snapshot deletion is in execution-store.ts.
 */
export function deleteRunArtifacts(runId: string): { har: boolean; timeline: boolean } {
  return {
    har:      deleteHar(runId),
    timeline: deleteTimeline(runId),
  };
}

// ── Purge ─────────────────────────────────────────────────────────────────────

/**
 * Delete artifacts older than retentionDays across all artifact directories.
 * Returns total files deleted.
 */
export function purgeOldArtifacts(retentionDays: number): number {
  const dirs = [baselinesDir(), harDir(), timelinesDir()];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      try {
        const full = path.join(dir, file);
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); deleted++; }
      } catch { /* skip */ }
    }
  }
  return deleted;
}
