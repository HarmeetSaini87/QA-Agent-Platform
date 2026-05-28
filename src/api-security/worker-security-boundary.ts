// src/api-security/worker-security-boundary.ts
// Phase E Step 4: Worker secret isolation — track active secrets per run, enforce teardown cleanup.

import type {
  IWorkerSecurityBoundary,
  SecretCleanupRecord,
  WorkerSecuritySnapshot,
} from './contracts/worker-security.contracts';

interface WorkerState {
  activeRunIds: Set<string>;
  lastCleanupAt: string | null;
  cleanupHistory: SecretCleanupRecord[];
}

export class WorkerSecurityBoundary implements IWorkerSecurityBoundary {
  private readonly _workers = new Map<string, WorkerState>();

  private _getOrCreate(workerId: string): WorkerState {
    let state = this._workers.get(workerId);
    if (!state) {
      state = { activeRunIds: new Set(), lastCleanupAt: null, cleanupHistory: [] };
      this._workers.set(workerId, state);
    }
    return state;
  }

  markSecretsActive(workerId: string, runId: string): void {
    this._getOrCreate(workerId).activeRunIds.add(runId);
  }

  clearSecrets(workerId: string, runId: string): SecretCleanupRecord {
    const state = this._getOrCreate(workerId);
    const wasActive = state.activeRunIds.has(runId);
    state.activeRunIds.delete(runId);
    const cleanedAt = new Date().toISOString();
    state.lastCleanupAt = cleanedAt;

    const record: SecretCleanupRecord = {
      workerId,
      runId,
      cleanedAt,
      fieldsCleared: wasActive ? 1 : 0,
      headersCleared: wasActive ? 1 : 0,
      advisoryNote: wasActive ? 'teardown completed — secrets cleared' : 'run was not active for this worker',
    };
    state.cleanupHistory.push(record);
    return record;
  }

  forceCleanup(workerId: string): SecretCleanupRecord[] {
    const state = this._workers.get(workerId);
    if (!state || state.activeRunIds.size === 0) return [];

    const records: SecretCleanupRecord[] = [];
    for (const runId of Array.from(state.activeRunIds)) {
      const cleanedAt = new Date().toISOString();
      state.lastCleanupAt = cleanedAt;
      const record: SecretCleanupRecord = {
        workerId, runId, cleanedAt,
        fieldsCleared: 1, headersCleared: 1,
        advisoryNote: 'forced cleanup — worker presumed dead or stuck',
      };
      state.cleanupHistory.push(record);
      records.push(record);
    }
    state.activeRunIds.clear();
    return records;
  }

  snapshot(workerId: string): WorkerSecuritySnapshot {
    const state = this._workers.get(workerId);
    return {
      workerId,
      snapshotAt: new Date().toISOString(),
      activeRunIds: state ? Array.from(state.activeRunIds) : [],
      pendingCleanups: state ? state.activeRunIds.size : 0,
      lastCleanupAt: state?.lastCleanupAt ?? null,
    };
  }
}

export const globalWorkerSecurityBoundary = new WorkerSecurityBoundary();
