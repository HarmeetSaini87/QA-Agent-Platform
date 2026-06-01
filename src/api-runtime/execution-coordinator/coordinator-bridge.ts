// src/api-runtime/execution-coordinator/coordinator-bridge.ts
// Phase C Track 1 — Live ExecutionCoordinator bridge.
//
// Feature flag: USE_COORDINATOR=true routes runCollection through the coordinator.
// When false (default), direct runCollection() path is used unchanged.
//
// This file owns singleton initialization. Import `getBridge()` from routes/server
// to get the live bridge instance.

import { v4 as uuidv4 } from 'uuid';
import { ExecutionCoordinator, setCoordinatorWorker, getExecutionCoordinator } from './coordinator';
import { createInProcessWorker } from '../runtime-workers/in-process-worker';
import { saveExecutionSnapshot } from '../artifact-engine/execution-store';
import { loadRunResult } from '../artifact-engine/run-store';
import { buildNodeReplayContext } from '../debugger-engine/node-replay';
import type { ApiCollection, ApiEnvironment } from '../../data/types';
import type { ExecutionRequest } from './contracts';

export const USE_COORDINATOR = process.env.USE_COORDINATOR === 'true';

// ── Run state registry ────────────────────────────────────────────────────────

type RunPhase = 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled' | 'error';

interface RunStateRecord {
  runId: string;
  collectionId: string;
  phase: RunPhase;
  dispatchedAt: string;
  completedAt?: string;
  workerId?: string;
  error?: string;
}

const _runStates = new Map<string, RunStateRecord>();

// ── Bridge interface ──────────────────────────────────────────────────────────

export interface CoordinatorBridge {
  /**
   * Dispatch a collection run through the ExecutionCoordinator.
   * Returns runId immediately; execution is async.
   */
  dispatchRun(
    collection: ApiCollection,
    environment: ApiEnvironment,
    runId: string,
    runFn: (collectionId: string, envId: string, runId: string, projectId?: string) => Promise<any>,
  ): string;

  /** Get the current phase/status of a run. */
  getRunState(runId: string): Promise<RunStateRecord | null>;

  /**
   * Cancel an in-flight run.
   * No-op if run has already completed.
   */
  cancelRun(runId: string, reason?: string): void;

  /**
   * Build the replay context for a single node.
   * Returns advisory context — does not trigger execution.
   */
  replayNode(runId: string, nodeId: string): Promise<import('../debugger-engine/node-replay').NodeReplayContext | null>;

  /** Coordinator health snapshot */
  health(): {
    coordinatorReady: boolean;
    useCoordinator: boolean;
    workerHealth?: ReturnType<ExecutionCoordinator['getWorkerHealth']>;
    activeRuns: number;
    totalDispatched: number;
  };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _bridge: CoordinatorBridge | null = null;

function buildBridge(): CoordinatorBridge {
  const worker = createInProcessWorker();
  const coordinator = setCoordinatorWorker(worker);

  let _totalDispatched = 0;

  return {
    dispatchRun(collection, environment, runId, runFn) {
      worker.setRunFn(runFn);

      const record: RunStateRecord = {
        runId,
        collectionId: collection.id,
        phase: 'dispatched',
        dispatchedAt: new Date().toISOString(),
      };
      _runStates.set(runId, record);
      _totalDispatched++;

      const request: ExecutionRequest = {
        runId,
        collection,
        environment,
        initialVariables: {},
        runtimeType: 'in-process',
        enqueuedAt: record.dispatchedAt,
      };

      // Fire-and-forget through coordinator
      record.phase = 'running';
      coordinator.dispatch(request).then(envelope => {
        record.workerId = envelope.workerId;
        record.completedAt = envelope.completedAt;
        record.phase =
          envelope.outcome === 'cancelled' ? 'cancelled' :
          envelope.runStatus === 'error' ? 'error' :
          envelope.runStatus === 'failed' ? 'failed' : 'completed';
        if (envelope.workerError) record.error = envelope.workerError;
      }).catch(err => {
        record.phase = 'error';
        record.error = err instanceof Error ? err.message : String(err);
        record.completedAt = new Date().toISOString();
      });

      return runId;
    },

    async getRunState(runId) {
      // In-memory first (catches in-flight runs)
      const inMem = _runStates.get(runId);
      if (inMem) return inMem;

      // Fallback: check run-store for completed runs that predate this process
      const runResult = await loadRunResult(runId);
      if (!runResult) return null;

      return {
        runId,
        collectionId: runResult.collectionId,
        phase: runResult.status === 'passed' ? 'completed' : 'failed',
        dispatchedAt: runResult.startedAt ?? new Date().toISOString(),
        completedAt: runResult.completedAt,
      };
    },

    cancelRun(runId, reason) {
      const record = _runStates.get(runId);
      if (record && record.phase === 'running') {
        coordinator.cancel(runId, reason);
        record.phase = 'cancelled';
        record.completedAt = new Date().toISOString();
      }
    },

    async replayNode(runId, nodeId) {
      return buildNodeReplayContext(runId, nodeId);
    },

    health() {
      return {
        coordinatorReady: true,
        useCoordinator: USE_COORDINATOR,
        workerHealth: coordinator.getWorkerHealth(),
        activeRuns: [..._runStates.values()].filter(r => r.phase === 'running').length,
        totalDispatched: _totalDispatched,
      };
    },
  };
}

export function getCoordinatorBridge(): CoordinatorBridge {
  if (!_bridge) _bridge = buildBridge();
  return _bridge;
}

/** Reset for testing only. */
export function _resetBridge(): void {
  _bridge = null;
  _runStates.clear();
}
