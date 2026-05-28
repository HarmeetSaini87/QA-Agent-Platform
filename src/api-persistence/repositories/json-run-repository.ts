// src/api-persistence/repositories/json-run-repository.ts
// Phase E Step 2: JSON-backed IApiRunRepository.
// Wraps data/api-runs/*.json directory — atomic write per run, same as existing routes.

import * as fs from 'fs';
import * as path from 'path';
import type { ApiCollectionRunResult } from '../../data/types';
import type { IApiRunRepository, RunQueryOptions, RunSummary } from '../contracts/run-repository.contracts';
import type { IAtomicStorageProvider } from '../contracts/storage-provider.contracts';

export class JsonApiRunRepository implements IApiRunRepository {
  constructor(private readonly _store: IAtomicStorageProvider) {}

  private _runsDir(): string {
    return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'api-runs');
  }

  private _runPath(runId: string): string {
    return path.join(this._runsDir(), `${runId}.json`);
  }

  findById(runId: string): ApiCollectionRunResult | null {
    const raw = this._store.readFile(this._runPath(runId));
    if (!raw) return null;
    try { return JSON.parse(raw) as ApiCollectionRunResult; }
    catch { return null; }
  }

  findAll(options?: RunQueryOptions): RunSummary[] {
    const dir = this._runsDir();
    if (!this._store.fileExists(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
    const summaries: RunSummary[] = [];

    for (const f of files) {
      const raw = this._store.readFile(path.join(dir, f));
      if (!raw) continue;
      try {
        const run = JSON.parse(raw) as ApiCollectionRunResult;
        if (options?.collectionId && run.collectionId !== options.collectionId) continue;
        if (options?.projectId && run.projectId !== options.projectId) continue;
        if (options?.status && run.status !== options.status) continue;
        if (options?.startedAfter && run.startedAt <= options.startedAfter) continue;
        summaries.push({
          id: run.id,
          collectionId: run.collectionId,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          stepCount: run.stepResults.length,
        });
      } catch { /* skip corrupt */ }
    }

    summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    const start = options?.offset ?? 0;
    const sliced = options?.limit ? summaries.slice(start, start + options.limit) : summaries.slice(start);
    return sliced;
  }

  save(run: ApiCollectionRunResult): void {
    this._store.ensureDir(this._runsDir());
    this._store.atomicWriteFile(this._runPath(run.id), JSON.stringify(run, null, 2));
  }

  delete(runId: string): boolean {
    const p = this._runPath(runId);
    if (!this._store.fileExists(p)) return false;
    fs.unlinkSync(p);
    return true;
  }

  exists(runId: string): boolean {
    return this._store.fileExists(this._runPath(runId));
  }

  count(options?: RunQueryOptions): number {
    return this.findAll(options).length;
  }
}
