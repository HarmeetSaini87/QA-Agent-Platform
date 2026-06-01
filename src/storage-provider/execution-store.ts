/**
 * execution-store.ts
 * Lightweight wrapper for API run result and execution snapshot persistence.
 *
 * Storage layout (all under DATA_DIR):
 *   data/api-runs/<runId>.json          → ApiCollectionRunResult (existing, unchanged)
 *   data/api-runs/<runId>.snapshot.json → ExecutionSnapshot (new — Phase C coordinator)
 *
 * Phase A: run result CRUD only (mirrors existing apiRunner.ts inline writes).
 * Phase C+: coordinator writes snapshots for selective rerun + crash recovery.
 *
 * DEPENDENCY BOUNDARY:
 *   - No Playwright, no Express, no auth
 *   - Reads/writes plain JSON files in DATA_DIR
 *   - ExecutionSnapshot imported from shared-core contracts
 */

import * as fs   from 'fs';
import * as path from 'path';
import type { ApiCollectionRunResult } from '../data/types';
import type { ExecutionSnapshot } from '../shared-core/contracts/dependency-graph.contract';

// ── Directory ─────────────────────────────────────────────────────────────────

function runsDir(): string {
  const dir = path.join(path.resolve(process.env.DATA_DIR || 'data'), 'api-runs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runResultPath(runId: string): string {
  return path.join(runsDir(), `${runId}.json`);
}

function snapshotPath(runId: string): string {
  return path.join(runsDir(), `${runId}.snapshot.json`);
}

// ── Run results (existing pattern — apiRunner.ts writes these today) ──────────

export function saveRunResult(result: ApiCollectionRunResult): void {
  fs.writeFileSync(runResultPath(result.id), JSON.stringify(result, null, 2));
}

export function loadRunResult(runId: string): ApiCollectionRunResult | undefined {
  const file = runResultPath(runId);
  if (!fs.existsSync(file)) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as ApiCollectionRunResult; }
  catch { return undefined; }
}

export function deleteRunResult(runId: string): boolean {
  const file = runResultPath(runId);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/**
 * List runIds, optionally filtered by collectionId.
 * Reads only filenames for unfiltered case — avoids parsing every JSON file.
 */
export function listRunIds(collectionId?: string): string[] {
  const dir = runsDir();
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('.snapshot') && !f.endsWith('.tmp'))
    : [];

  if (!collectionId) return files.map(f => f.replace('.json', ''));

  return files
    .map(f => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as ApiCollectionRunResult;
        return r.collectionId === collectionId ? r.id : null;
      } catch { return null; }
    })
    .filter((id): id is string => id !== null);
}

/** List full run result headers (id, status, startedAt) without loading full results */
export function listRunSummaries(collectionId?: string): Array<Pick<ApiCollectionRunResult, 'id' | 'collectionId' | 'status' | 'startedAt' | 'completedAt'>> {
  const dir = runsDir();
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('.snapshot') && !f.endsWith('.tmp'))
    : [];

  return files
    .map(f => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as ApiCollectionRunResult;
        if (collectionId && r.collectionId !== collectionId) return null;
        return { id: r.id, collectionId: r.collectionId, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt };
      } catch { return null; }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// ── Execution snapshots (Phase C — selective rerun / crash recovery) ───────────

/**
 * Save a live ExecutionSnapshot for crash recovery and selective rerun.
 * Written alongside the run result — same directory, .snapshot.json suffix.
 * Phase A: this function exists but is not called until Phase C coordinator lands.
 */
export function saveSnapshot(snapshot: ExecutionSnapshot): void {
  fs.writeFileSync(snapshotPath(snapshot.runId), JSON.stringify(snapshot, null, 2));
}

export function loadSnapshot(runId: string): ExecutionSnapshot | undefined {
  const file = snapshotPath(runId);
  if (!fs.existsSync(file)) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as ExecutionSnapshot; }
  catch { return undefined; }
}

export function deleteSnapshot(runId: string): boolean {
  const file = snapshotPath(runId);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/** Delete run result + snapshot together — used by cleanup/purge */
export function deleteRun(runId: string): { result: boolean; snapshot: boolean } {
  return {
    result:   deleteRunResult(runId),
    snapshot: deleteSnapshot(runId),
  };
}

/**
 * Purge run artifacts older than retentionDays.
 * Returns number of run IDs deleted.
 */
export function purgeOldRuns(retentionDays: number): number {
  const dir = runsDir();
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) { fs.unlinkSync(full); deleted++; }
    } catch { /* skip locked/unreadable files */ }
  }
  return deleted;
}
