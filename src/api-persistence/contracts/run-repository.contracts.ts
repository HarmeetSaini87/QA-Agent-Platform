// src/api-persistence/contracts/run-repository.contracts.ts
// Phase E Step 2: Repository interface for ApiCollectionRunResult persistence.

import type { ApiCollectionRunResult } from '../../data/types';

export interface RunQueryOptions {
  collectionId?: string;
  projectId?: string;
  status?: ApiCollectionRunResult['status'];
  limit?: number;
  offset?: number;
  /** ISO string — only return runs started after this date */
  startedAfter?: string;
}

export interface RunSummary {
  readonly id: string;
  readonly collectionId: string;
  readonly status: ApiCollectionRunResult['status'];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly stepCount: number;
}

export interface IApiRunRepository {
  findById(runId: string): ApiCollectionRunResult | null;
  findAll(options?: RunQueryOptions): RunSummary[];
  save(run: ApiCollectionRunResult): void;
  delete(runId: string): boolean;
  exists(runId: string): boolean;
  count(options?: RunQueryOptions): number;
}
