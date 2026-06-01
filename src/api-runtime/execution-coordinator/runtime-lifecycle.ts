/**
 * runtime-lifecycle.ts — RuntimeLifecycle state machine
 * Phase C Step 5: Worker Isolation Preparation & Execution Coordinator Evolution.
 *
 * WHAT THIS ADDS:
 *   - Formal runtime lifecycle states: idle → starting → running → stopping → stopped | error
 *   - RuntimeLifecycleTracker: tracks state transitions, emits events
 *   - Cancellation token: safe mid-run cancellation signal (no forced kill yet)
 *   - ExecutionSlot: tracks one in-flight execution (run ownership within a worker)
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Any execution semantics (unchanged)
 *   - WorkflowEngine execution loop (unchanged)
 *   - Retry / DAG / variable logic (unchanged)
 *
 * Phase C Step 5 = lifecycle formalization only.
 * Workers are not started/stopped yet — lifecycle tracks the in-process coordinator.
 */

// ── Runtime lifecycle states ──────────────────────────────────────────────────

/**
 * RuntimeLifecycleState — canonical states for any runtime (in-process or future worker).
 *
 * idle      → runtime exists but has no active runs
 * starting  → runtime is initialising (future: spawning child, loading env)
 * running   → one or more executions in flight
 * stopping  → graceful shutdown requested; drain in-flight runs
 * stopped   → fully shut down; no more executions possible
 * error     → unrecoverable runtime error; requires restart
 */
export type RuntimeLifecycleState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

/** Valid state transitions */
const VALID_TRANSITIONS: Record<RuntimeLifecycleState, RuntimeLifecycleState[]> = {
  idle:     ['starting', 'running', 'stopping', 'stopped'],
  starting: ['idle', 'running', 'error', 'stopped'],
  running:  ['stopping', 'idle', 'error'],
  stopping: ['stopped', 'error'],
  stopped:  [],
  error:    ['stopped'],
};

export class InvalidLifecycleTransitionError extends Error {
  constructor(from: RuntimeLifecycleState, to: RuntimeLifecycleState) {
    super(`Invalid lifecycle transition: ${from} → ${to}`);
    this.name = 'InvalidLifecycleTransitionError';
  }
}

// ── Cancellation token ────────────────────────────────────────────────────────

/**
 * CancellationToken — safe cancellation signal for in-flight executions.
 * Callers check isCancelled before starting each wave.
 * Phase C Step 5: used in-process only. Future: serialised into worker message.
 *
 * NON-NEGOTIABLE: engine must check this in the wave loop to respect cancellation.
 * This is PREPARATION — engine does not check it yet (Phase C Step 6+).
 */
export class CancellationToken {
  private _cancelled = false;
  private _reason?: string;
  private _cancelledAt?: string;

  /** Request cancellation. Safe to call multiple times (idempotent). */
  cancel(reason?: string): void {
    if (this._cancelled) return;
    this._cancelled = true;
    this._reason = reason;
    this._cancelledAt = new Date().toISOString();
  }

  get isCancelled(): boolean { return this._cancelled; }
  get reason(): string | undefined { return this._reason; }
  get cancelledAt(): string | undefined { return this._cancelledAt; }

  /** Snapshot — serialisable for future IPC transfer */
  toSnapshot(): { isCancelled: boolean; reason?: string; cancelledAt?: string } {
    return {
      isCancelled: this._cancelled,
      reason: this._reason,
      cancelledAt: this._cancelledAt,
    };
  }
}

// ── ExecutionSlot ─────────────────────────────────────────────────────────────

/**
 * ExecutionSlot — tracks one in-flight execution within a worker.
 * Coordinator holds a slot per active run.
 * Phase C Step 5: coordinator is in-process; slots are in-memory.
 */
export interface ExecutionSlot {
  runId: string;
  workerId: string;
  startedAt: string;
  cancellationToken: CancellationToken;
  /** Promise resolves when the execution completes or is cancelled */
  completion: Promise<void>;
  /** Call to signal the slot that execution is complete */
  markComplete: () => void;
}

export function createExecutionSlot(runId: string, workerId: string): ExecutionSlot {
  let resolve!: () => void;
  const completion = new Promise<void>(res => { resolve = res; });
  return {
    runId,
    workerId,
    startedAt: new Date().toISOString(),
    cancellationToken: new CancellationToken(),
    completion,
    markComplete: resolve,
  };
}

// ── RuntimeLifecycleTracker ───────────────────────────────────────────────────

export interface LifecycleTransitionEvent {
  from: RuntimeLifecycleState;
  to: RuntimeLifecycleState;
  at: string;
  reason?: string;
}

/**
 * RuntimeLifecycleTracker — tracks lifecycle state of a single runtime instance.
 * One tracker per worker (in-process coordinator has one tracker for the whole runtime).
 */
export class RuntimeLifecycleTracker {
  private _state: RuntimeLifecycleState = 'idle';
  private readonly _history: LifecycleTransitionEvent[] = [];
  private readonly _listeners = new Map<RuntimeLifecycleState, Array<() => void>>();

  get state(): RuntimeLifecycleState { return this._state; }
  get history(): ReadonlyArray<LifecycleTransitionEvent> { return this._history; }

  /** Transition to a new state. Throws if transition is invalid. */
  transition(to: RuntimeLifecycleState, reason?: string): void {
    const from = this._state;
    if (!VALID_TRANSITIONS[from].includes(to)) {
      throw new InvalidLifecycleTransitionError(from, to);
    }
    this._state = to;
    const event: LifecycleTransitionEvent = { from, to, at: new Date().toISOString(), reason };
    this._history.push(event);
    this._listeners.get(to)?.forEach(fn => { try { fn(); } catch { /* hook must not break */ } });
  }

  /** Register a callback that fires when the tracker enters a specific state. */
  onEnter(state: RuntimeLifecycleState, fn: () => void): void {
    if (!this._listeners.has(state)) this._listeners.set(state, []);
    this._listeners.get(state)!.push(fn);
  }

  /** True if this runtime can accept new execution requests. */
  get isAcceptingWork(): boolean {
    return this._state === 'idle' || this._state === 'running';
  }

  /** True if this runtime has completed shutdown. */
  get isShutDown(): boolean {
    return this._state === 'stopped' || this._state === 'error';
  }

  /** Snapshot — serialisable for coordinator health reporting. */
  toSnapshot(): { state: RuntimeLifecycleState; history: ReadonlyArray<LifecycleTransitionEvent> } {
    return { state: this._state, history: this._history };
  }
}

// ── WorkerHealthSnapshot ──────────────────────────────────────────────────────

/**
 * WorkerHealthSnapshot — point-in-time health of a worker runtime.
 * Coordinator reads this to decide whether to dispatch new work.
 * Future: returned by worker heartbeat message.
 */
export interface WorkerHealthSnapshot {
  workerId: string;
  runtimeType: import('./contracts').RuntimeType;
  lifecycleState: RuntimeLifecycleState;
  activeRunCount: number;
  totalRunsCompleted: number;
  totalRunsFailed: number;
  /** ISO timestamp of last activity */
  lastActiveAt: string;
  /** True if worker is accepting new requests */
  isAcceptingWork: boolean;
  capturedAt: string;
}
