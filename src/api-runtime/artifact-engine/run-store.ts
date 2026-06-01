import * as fs from 'fs';
import * as path from 'path';
import type { ApiCollectionRunResult } from '../../data/types';
import type { ArtifactRef } from '../../shared-core/contracts/artifact.contract';
import { maskRunResult } from './masking';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const RUNS_DIR = path.join(DATA_DIR, 'api-runs');

function ensureRunsDir(): void {
  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
}

export async function saveRunResult(result: ApiCollectionRunResult): Promise<ArtifactRef> {
  ensureRunsDir();
  const masked = maskRunResult(result);
  const filePath = path.join(RUNS_DIR, `${result.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(masked, null, 2));
  const stat = fs.statSync(filePath);
  return {
    type: 'run-result',
    runId: result.id,
    collectionId: result.collectionId,
    filePath,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
}

export async function savePartialRunResult(
  status: ApiCollectionRunResult['status'],
  partial: ApiCollectionRunResult
): Promise<void> {
  ensureRunsDir();
  const masked = maskRunResult(partial);
  fs.writeFileSync(
    path.join(RUNS_DIR, `${partial.id}.json`),
    JSON.stringify(masked, null, 2)
  );
}

export async function loadRunResult(runId: string): Promise<ApiCollectionRunResult | undefined> {
  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ApiCollectionRunResult;
}
