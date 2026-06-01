/**
 * execution-store.ts
 * Persist and load ExecutionSnapshot to/from disk.
 *
 * Pattern mirrors run-store.ts:
 *   - data/api-snapshots/{runId}.snapshot.json
 *   - sanitizeSnapshot() called before write (secrets protection)
 *   - returns ArtifactRef with type 'execution-snapshot'
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExecutionSnapshot } from '../../shared-core/contracts/dependency-graph.contract';
import type { ArtifactRef } from '../../shared-core/contracts/artifact.contract';
import { sanitizeSnapshot } from './snapshot-sanitizer';

// SNAPSHOTS_DIR computed lazily so DATA_DIR env var changes in tests take effect
function getSnapshotsDir(): string {
  return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'api-snapshots');
}

/** Stable export for callers that need the path (e.g. engine.ts listArtifacts) */
export const SNAPSHOTS_DIR = getSnapshotsDir();

function ensureSnapshotsDir(): string {
  const dir = getSnapshotsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveExecutionSnapshot(snapshot: ExecutionSnapshot): Promise<ArtifactRef> {
  const snapshotsDir = ensureSnapshotsDir();
  const sanitized = sanitizeSnapshot(snapshot);
  const filePath = path.join(snapshotsDir, `${snapshot.runId}.snapshot.json`);
  fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2));
  const stat = fs.statSync(filePath);
  return {
    type: 'execution-snapshot',
    runId: snapshot.runId,
    collectionId: snapshot.collectionId,
    filePath,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
}

export async function loadExecutionSnapshot(runId: string): Promise<ExecutionSnapshot | undefined> {
  const filePath = path.join(getSnapshotsDir(), `${runId}.snapshot.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ExecutionSnapshot;
}

export async function deleteExecutionSnapshot(runId: string): Promise<void> {
  const filePath = path.join(getSnapshotsDir(), `${runId}.snapshot.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
