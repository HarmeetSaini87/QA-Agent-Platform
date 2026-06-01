/**
 * contracts.ts — ExecutionCoordinator payload and context contracts
 * Phase C Step 5: Worker Isolation Preparation & Execution Coordinator Evolution.
 *
 * WHAT THIS ADDS:
 *   - ExecutionRequest: serialisable input to any worker (in-process or future child_process)
 *   - ExecutionContext: transferred execution context (variables, auth hints, env)
 *   - ExecutionPayload: full wire-safe bundle for future IPC transfer
 *   - WorkerCapabilityHint: what a runtime worker supports
 *   - ExecutionOwnership: which coordinator owns which run
 *   - CleanupHook: disposal safety contract
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - ApiCollection/ApiEnvironment shapes (unchanged)
 *   - Any execution semantics (unchanged)
 *   - Any retry/DAG/variable logic (unchanged)
 *
 * All types are serialisable (no Map/Set/Function) for future IPC transport.
 * Phase C Step 5 = contracts only. Transport wire is Phase C Step 6+.
 */

import type { ApiCollection, ApiEnvironment } from '../../data/types';
import type { ExecutionSnapshot } from '../../shared-core/contracts/dependency-graph.contract';

// ── Execution request ─────────────────────────────────────────────────────────

/**
 * ExecutionRequest — a self-contained, serialisable request to execute one collection.
 * Designed to be safe for future child_process.send() / IPC transfer.
 * In Phase C Step 5: used in-process only.
 */
export interface ExecutionRequest {
  /** Stable run identifier — coordinator owns generation */
  runId: string;
  /** The collection to execute — deep-cloned before transfer */
  collection: ApiCollection;
  /** The environment to execute against */
  environment: ApiEnvironment;
  /** Initial variable context — merged from env + collection vars before transfer */
  initialVariables: Record<string, string>;
  /**
   * Preferred runtime type for this request.
   * 'in-process' = current behaviour (always used today).
   * 'child-process' = future isolation target.
   */
  runtimeType: RuntimeType;
  /** Execution policy overrides (optional — defaults from collection used otherwise) */
  policy?: ExecutionPolicy;
  /** ISO timestamp when this request was enqueued */
  enqueuedAt: string;
  /** Request originator — for audit trail */
  requestedBy?: string;
}

/** Runtime type taxonomy — determines which worker handles the request */
export type RuntimeType = 'in-process' | 'child-process' | 'remote-worker';

/** Execution policy overrides injected at coordinator level */
export interface ExecutionPolicy {
  /** Override collection maxConcurrency for this run */
  maxConcurrency?: number;
  /** Override collection timeoutMs for this run */
  totalTimeoutMs?: number;
  /** If true, coordinator cancels run on first node failure regardless of collection.onFailure */
  abortOnFirstFailure?: boolean;
  /** If true, coordinator captures snapshots at every wave (not just on failure) */
  captureFullTimeline?: boolean;
}

// ── Execution context ─────────────────────────────────────────────────────────

/**
 * ExecutionContext — transferred execution context bundle.
 * Serialisable — safe for future cross-process transfer.
 * Contains everything a worker needs to execute a step outside the coordinator process.
 */
export interface ExecutionContext {
  runId: string;
  collectionId: string;
  projectId?: string;
  /** Resolved + decrypted variable map — transferred at run start, not re-fetched */
  variables: Record<string, string>;
  /** Pre-resolved auth headers — worker uses directly, no re-resolution needed */
  authHeaders: Record<string, string>;
  /** Base URL for this environment */
  baseUrl: string;
  /** Timeout per step in ms */
  stepTimeoutMs: number;
  /** ISO timestamp when context was captured (for staleness detection in future) */
  capturedAt: string;
}

// ── Execution payload ─────────────────────────────────────────────────────────

/**
 * ExecutionPayload — full bundle sent to a worker runtime.
 * Wraps ExecutionRequest + coordinator-side metadata.
 * Phase C Step 5: assembled in-process, never serialised yet.
 * Phase C Step 6+: will be JSON.stringify-safe for IPC send.
 */
export interface ExecutionPayload {
  request: ExecutionRequest;
  context: ExecutionContext;
  /** Snapshot to resume from (for future selective rerun) — null for fresh runs */
  resumeFromSnapshot?: ExecutionSnapshot;
  /** Coordinator-assigned worker ID that will handle this payload */
  assignedWorkerId: string;
  /** ISO timestamp when payload was dispatched */
  dispatchedAt: string;
}

// ── Worker capability hint ─────────────────────────────────────────────────────

/**
 * WorkerCapabilityHint — static metadata about what a runtime worker supports.
 * Coordinator uses this to route execution requests to compatible workers.
 */
export interface WorkerCapabilityHint {
  /** Worker's runtime type */
  runtimeType: RuntimeType;
  /** Max concurrent nodes this worker can handle */
  maxConcurrency: number;
  /**
   * True if worker supports full snapshot capture.
   * Future: child-process workers may not support all snapshot types initially.
   */
  supportsSnapshots: boolean;
  /** True if worker supports HAR recording */
  supportsHarCapture: boolean;
  /** True if worker supports contract drift detection */
  supportsContractDrift: boolean;
  /**
   * True if worker isolates Playwright context per node.
   * Phase C Step 5: always false (shared context today).
   */
  isolatesContextPerNode: boolean;
}

// ── Execution ownership ───────────────────────────────────────────────────────

/**
 * ExecutionOwnership — coordinator tracks which run belongs to which worker.
 * Used for future cancellation, health monitoring, and forced disposal.
 */
export interface ExecutionOwnership {
  runId: string;
  workerId: string;
  runtimeType: RuntimeType;
  startedAt: string;
  /** Run is considered orphaned if no heartbeat within this window (future health check) */
  heartbeatDeadlineMs?: number;
}

// ── Cleanup hook ──────────────────────────────────────────────────────────────

/**
 * CleanupHook — mandatory disposal interface for any execution boundary.
 *
 * NON-NEGOTIABLE: finally { await cleanup.dispose() } is mandatory.
 * Every worker runtime MUST implement this.
 * Guarantees: Playwright context disposed, open connections closed, temp files cleaned.
 */
export interface CleanupHook {
  /**
   * Dispose all resources held by this execution context.
   * MUST be called in finally — never conditional.
   * Safe to call multiple times (idempotent).
   */
  dispose(): Promise<void>;
  /** True after dispose() has been called */
  readonly isDisposed: boolean;
}

// ── Execution result envelope ─────────────────────────────────────────────────

/**
 * ExecutionResultEnvelope — coordinator-level result wrapper.
 * Wraps the engine result with coordinator metadata.
 * Future: this is what a child-process worker sends back via IPC.
 */
export interface ExecutionResultEnvelope {
  runId: string;
  workerId: string;
  /** 'completed' = engine finished; 'cancelled' = coordinator cancelled mid-run; 'worker-error' = worker crashed */
  outcome: 'completed' | 'cancelled' | 'worker-error';
  /** Final run status from engine */
  runStatus: 'passed' | 'failed' | 'error';
  /** ISO timestamp when result was produced */
  completedAt: string;
  durationMs: number;
  /** Error message if outcome = 'worker-error' */
  workerError?: string;
}
