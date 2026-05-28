# Phase D Step 12: Distributed Execution Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add worker pool, execution lease, environment isolation, queue abstraction, and worker health observability contracts without changing any execution semantics.

**Architecture:** Eight pure-addition modules under `src/api-runtime/` plus distributed replay contracts in `src/api-observability/`. The coordinator, WorkflowEngine, DAG, retries, and apiRunner.ts are untouched. Single-node in-process execution remains the default and unchanged path. All new contracts are serialisable and IPC-ready for future distributed transport.

**Tech Stack:** TypeScript · Vitest · Express · vanilla JS (`29-worker-health.js`) · existing coordinator/runtime-lifecycle contracts

---

## What already exists — DO NOT re-implement

All of the following exist and must not be modified:

| File | Key exports |
|------|-------------|
| `src/api-runtime/execution-coordinator/contracts.ts` | `ExecutionRequest`, `ExecutionPayload`, `ExecutionContext`, `ExecutionResultEnvelope`, `WorkerCapabilityHint`, `ExecutionOwnership`, `CleanupHook`, `RuntimeType` |
| `src/api-runtime/execution-coordinator/coordinator.ts` | `IExecutionCoordinator`, `ExecutionCoordinator`, `getExecutionCoordinator()`, `setCoordinatorWorker()` |
| `src/api-runtime/execution-coordinator/runtime-lifecycle.ts` | `RuntimeLifecycleState`, `CancellationToken`, `ExecutionSlot`, `RuntimeLifecycleTracker`, `WorkerHealthSnapshot` |
| `src/api-runtime/runtime-workers/worker-contracts.ts` | `IWorkerRuntime`, `WorkerMetadata`, `WorkerIsolationBoundary` |
| `src/api-runtime/runtime-workers/in-process-worker.ts` | `InProcessWorkerRuntime`, `createInProcessWorker()` |
| `src/api-observability/contracts/replay-event.contracts.ts` | `ReplayEvent`, `ReplaySession` |
| `src/api-observability/contracts/execution-diff.contracts.ts` | `RunDiffRequest`, `StepDiff`, `RunDiffSummary` |
| `src/api-observability/contracts/rca-extension.contracts.ts` | `RcaExtensionPoint`, `NoOpRcaProvider` |
| `src/storage-provider/execution-store.ts` | `loadRunResult`, `saveRunResult`, `loadSnapshot` |

**CRITICAL INVARIANTS:**
1. `InProcessWorkerRuntime`, `ExecutionCoordinator`, `WorkflowEngine`, `apiRunner.ts` — DO NOT MODIFY
2. `ExecutionPayload`, `ExecutionRequest`, `WorkerCapabilityHint` — DO NOT MODIFY (already IPC-ready)
3. `RuntimeLifecycleState`, `CancellationToken`, `ExecutionSlot` — DO NOT MODIFY
4. Single-node execution path MUST still work identically after all tasks

---

## File Structure

All new files to create:

```
src/api-runtime/
  worker-pool/
    worker-pool.contracts.ts          ← Task 1
    simple-worker-pool.ts             ← Task 1
    __tests__/worker-pool.test.ts     ← Task 1
  execution-leasing/
    lease.contracts.ts                ← Task 2
    in-memory-lease-registry.ts       ← Task 2
    __tests__/lease-registry.test.ts  ← Task 2
  environment-isolation/
    env-isolation.contracts.ts        ← Task 3
    in-memory-env-lock-registry.ts    ← Task 3
    __tests__/env-lock-registry.test.ts ← Task 3
  worker-health/
    worker-health-aggregator.ts       ← Task 4
    worker-health-singleton.ts        ← Task 4
    routes/
      worker-health.routes.ts         ← Task 4
    __tests__/worker-health-aggregator.test.ts ← Task 4
  orchestration/
    queue.contracts.ts                ← Task 5
    in-memory-execution-queue.ts      ← Task 5
    __tests__/in-memory-queue.test.ts ← Task 5
  cloud-extension/
    cloud-worker.contracts.ts         ← Task 8

src/api-observability/contracts/
  distributed-replay.contracts.ts     ← Task 6
src/api-observability/__tests__/
  distributed-replay.test.ts          ← Task 6

src/ui/public/js/
  29-worker-health.js                 ← Task 7

src/ui/public/
  index.html                          ← Task 7 (add nav tab + panel)
  styles_addon.css                    ← Task 7 (append CSS)

scripts/concat-modules.js             ← Task 7 (register 29-worker-health.js)

src/ui/server.ts                      ← Task 8 (register worker health routes)

CLAUDE.md                             ← Task 8 (plan reference + shipped section)
```

---

## Task 1: Worker Pool Contracts + SimpleWorkerPool

Adds a registry abstraction for tracking available workers and providing selection strategy. The coordinator remains the dispatcher — this pool only tracks and selects workers.

### Step 1.1 — Create directories

```bash
mkdir -p src/api-runtime/worker-pool/__tests__
```

### Step 1.2 — Write the failing test first

Create `src/api-runtime/worker-pool/__tests__/worker-pool.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SimpleWorkerPool } from '../simple-worker-pool';
import { createInProcessWorker } from '../../runtime-workers/in-process-worker';

function makeMeta(w: ReturnType<typeof createInProcessWorker>) {
  return {
    workerId: w.workerId,
    runtimeType: 'in-process' as const,
    createdAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
  };
}

describe('SimpleWorkerPool', () => {
  let pool: SimpleWorkerPool;
  beforeEach(() => { pool = new SimpleWorkerPool(); });

  it('returns null when no workers registered', () => {
    expect(pool.selectWorker()).toBeNull();
  });

  it('selectWorker returns the registered worker', () => {
    const w = createInProcessWorker();
    pool.register(w, makeMeta(w));
    expect(pool.selectWorker()).toBe(w);
  });

  it('round-robins across two workers', () => {
    const w1 = createInProcessWorker('w1');
    const w2 = createInProcessWorker('w2');
    pool.register(w1, makeMeta(w1));
    pool.register(w2, makeMeta(w2));
    const first = pool.selectWorker();
    const second = pool.selectWorker();
    expect(first).not.toBe(second);
  });

  it('skips disposed workers', async () => {
    const w1 = createInProcessWorker('w1');
    const w2 = createInProcessWorker('w2');
    pool.register(w1, makeMeta(w1));
    pool.register(w2, makeMeta(w2));
    await w1.dispose();
    expect(pool.selectWorker()).toBe(w2);
  });

  it('deregister removes worker from selection', () => {
    const w = createInProcessWorker();
    pool.register(w, makeMeta(w));
    pool.deregister(w.workerId);
    expect(pool.selectWorker()).toBeNull();
  });

  it('isAcceptingWork false when all workers disposed', async () => {
    const w = createInProcessWorker();
    pool.register(w, makeMeta(w));
    await w.dispose();
    expect(pool.isAcceptingWork).toBe(false);
  });

  it('getMetrics reports correct counts', () => {
    const w1 = createInProcessWorker('w1');
    const w2 = createInProcessWorker('w2');
    pool.register(w1, makeMeta(w1));
    pool.register(w2, makeMeta(w2));
    const m = pool.getMetrics();
    expect(m.totalWorkers).toBe(2);
    expect(m.acceptingWorkersCount).toBe(2);
  });
});
```

### Step 1.3 — Run failing tests (expected: fail because files don't exist)

```bash
npx vitest run src/api-runtime/worker-pool/__tests__/worker-pool.test.ts
```

Expected output: compilation error — `SimpleWorkerPool` not found.

### Step 1.4 — Create `src/api-runtime/worker-pool/worker-pool.contracts.ts`

```typescript
// src/api-runtime/worker-pool/worker-pool.contracts.ts
// Phase D Step 12: Worker pool registry abstraction for future multi-worker routing.
// Coordinator remains the dispatcher — pool tracks available workers + provides selection.

import type { IWorkerRuntime, WorkerMetadata } from '../runtime-workers/worker-contracts';

export type WorkerSelectionStrategy = 'round-robin' | 'least-loaded' | 'first-available';

export interface WorkerRegistration {
  readonly worker: IWorkerRuntime;
  readonly metadata: WorkerMetadata;
  readonly registeredAt: string;
}

export interface WorkerPoolConfig {
  readonly selectionStrategy: WorkerSelectionStrategy;
}

export interface WorkerPoolMetrics {
  readonly totalWorkers: number;
  readonly acceptingWorkersCount: number;
  readonly capturedAt: string;
}

export interface IWorkerPool {
  register(worker: IWorkerRuntime, metadata: WorkerMetadata): void;
  deregister(workerId: string): boolean;
  selectWorker(): IWorkerRuntime | null;
  listWorkers(): WorkerRegistration[];
  getMetrics(): WorkerPoolMetrics;
  readonly isAcceptingWork: boolean;
}
```

### Step 1.5 — Create `src/api-runtime/worker-pool/simple-worker-pool.ts`

```typescript
// src/api-runtime/worker-pool/simple-worker-pool.ts
// Phase D Step 12: SimpleWorkerPool — single-node default, round-robin for future multi-worker.

import type { IWorkerRuntime, WorkerMetadata } from '../runtime-workers/worker-contracts';
import type {
  IWorkerPool,
  WorkerPoolConfig,
  WorkerPoolMetrics,
  WorkerRegistration,
} from './worker-pool.contracts';

export class SimpleWorkerPool implements IWorkerPool {
  private readonly _workers = new Map<string, WorkerRegistration>();
  private _roundRobinIndex = 0;

  constructor(private readonly _config: WorkerPoolConfig = { selectionStrategy: 'round-robin' }) {}

  register(worker: IWorkerRuntime, metadata: WorkerMetadata): void {
    this._workers.set(worker.workerId, {
      worker,
      metadata,
      registeredAt: new Date().toISOString(),
    });
  }

  deregister(workerId: string): boolean {
    return this._workers.delete(workerId);
  }

  selectWorker(): IWorkerRuntime | null {
    const available = [...this._workers.values()]
      .filter(r => !r.worker.isDisposed)
      .map(r => r.worker);
    if (!available.length) return null;
    const idx = this._roundRobinIndex % available.length;
    this._roundRobinIndex++;
    return available[idx];
  }

  listWorkers(): WorkerRegistration[] {
    return [...this._workers.values()];
  }

  getMetrics(): WorkerPoolMetrics {
    const workers = [...this._workers.values()];
    return {
      totalWorkers: workers.length,
      acceptingWorkersCount: workers.filter(r => !r.worker.isDisposed).length,
      capturedAt: new Date().toISOString(),
    };
  }

  get isAcceptingWork(): boolean {
    return [...this._workers.values()].some(r => !r.worker.isDisposed);
  }
}
```

### Step 1.6 — Run tests (expected: all pass)

```bash
npx vitest run src/api-runtime/worker-pool/__tests__/worker-pool.test.ts
```

Expected output:
```
✓ src/api-runtime/worker-pool/__tests__/worker-pool.test.ts (7)
  ✓ SimpleWorkerPool > returns null when no workers registered
  ✓ SimpleWorkerPool > selectWorker returns the registered worker
  ✓ SimpleWorkerPool > round-robins across two workers
  ✓ SimpleWorkerPool > skips disposed workers
  ✓ SimpleWorkerPool > deregister removes worker from selection
  ✓ SimpleWorkerPool > isAcceptingWork false when all workers disposed
  ✓ SimpleWorkerPool > getMetrics reports correct counts

Test Files  1 passed (1)
Tests       7 passed (7)
```

### Step 1.7 — Commit

```bash
git add src/api-runtime/worker-pool/
git commit -m "feat(worker-pool): add IWorkerPool contract + SimpleWorkerPool with round-robin selection"
```

---

## Task 2: Execution Lease Model

Adds time-bounded run ownership. Leases prevent double-dispatch and enable stuck-run detection. NOT wired into the coordinator yet — observability and future distributed coordination only.

### Step 2.1 — Create directories

```bash
mkdir -p src/api-runtime/execution-leasing/__tests__
```

### Step 2.2 — Write the failing test first

Create `src/api-runtime/execution-leasing/__tests__/lease-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryLeaseRegistry, _resetLeaseRegistrySingleton } from '../in-memory-lease-registry';

describe('InMemoryLeaseRegistry', () => {
  let registry: InMemoryLeaseRegistry;
  beforeEach(() => { registry = new InMemoryLeaseRegistry(); });

  it('acquire returns success with lease', () => {
    const result = registry.acquire('run-1', 'worker-1', 'env-1', 60_000);
    expect(result.success).toBe(true);
    expect(result.lease).not.toBeNull();
    expect(result.lease!.runId).toBe('run-1');
    expect(result.lease!.status).toBe('active');
  });

  it('second acquire for same runId returns conflict', () => {
    registry.acquire('run-1', 'worker-1', 'env-1', 60_000);
    const result = registry.acquire('run-1', 'worker-2', 'env-1', 60_000);
    expect(result.success).toBe(false);
    expect(result.conflictingRunId).toBe('run-1');
  });

  it('isLeased returns true after acquire', () => {
    registry.acquire('run-1', 'worker-1', 'env-1', 60_000);
    expect(registry.isLeased('run-1')).toBe(true);
  });

  it('release marks lease as released', () => {
    registry.acquire('run-1', 'worker-1', 'env-1', 60_000);
    expect(registry.release('run-1')).toBe(true);
    expect(registry.isLeased('run-1')).toBe(false);
  });

  it('acquire succeeds after release', () => {
    registry.acquire('run-1', 'worker-1', 'env-1', 60_000);
    registry.release('run-1');
    const result = registry.acquire('run-1', 'worker-2', 'env-1', 60_000);
    expect(result.success).toBe(true);
  });

  it('listExpired returns expired active leases', async () => {
    registry.acquire('run-expired', 'w1', 'env-1', 1); // 1ms TTL
    await new Promise(r => setTimeout(r, 10));
    expect(registry.listExpired().map(l => l.runId)).toContain('run-expired');
  });

  it('listActive returns non-expired leases', () => {
    registry.acquire('run-1', 'w1', 'env-1', 60_000);
    expect(registry.listActive().map(l => l.runId)).toContain('run-1');
  });

  it('listExpired omits released leases', async () => {
    registry.acquire('run-1', 'w1', 'env-1', 1);
    registry.release('run-1');
    await new Promise(r => setTimeout(r, 10));
    expect(registry.listExpired().map(l => l.runId)).not.toContain('run-1');
  });
});
```

### Step 2.3 — Run failing tests (expected: compilation error)

```bash
npx vitest run src/api-runtime/execution-leasing/__tests__/lease-registry.test.ts
```

Expected output: error — `InMemoryLeaseRegistry` not found.

### Step 2.4 — Create `src/api-runtime/execution-leasing/lease.contracts.ts`

```typescript
// src/api-runtime/execution-leasing/lease.contracts.ts
// Phase D Step 12: Time-bounded run ownership contracts.
// Leases prevent double-dispatch and enable stuck-run detection.
// NOT wired into coordinator yet — observability + future distributed coordination.

export type LeaseStatus = 'active' | 'expired' | 'released';

export interface ExecutionLease {
  readonly leaseId: string;
  readonly runId: string;
  readonly workerId: string;
  readonly environmentId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly ttlMs: number;
  readonly status: LeaseStatus;
}

export interface LeaseAcquisitionResult {
  readonly success: boolean;
  readonly lease: ExecutionLease | null;
  readonly conflictingRunId?: string;
  readonly reason?: string;
}

export interface ILeaseRegistry {
  acquire(runId: string, workerId: string, environmentId: string, ttlMs: number): LeaseAcquisitionResult;
  release(runId: string): boolean;
  getLease(runId: string): ExecutionLease | null;
  isLeased(runId: string): boolean;
  listExpired(): ExecutionLease[];
  listActive(): ExecutionLease[];
}
```

### Step 2.5 — Create `src/api-runtime/execution-leasing/in-memory-lease-registry.ts`

```typescript
// src/api-runtime/execution-leasing/in-memory-lease-registry.ts
// Phase D Step 12: In-memory lease registry. Future: back with Redis or DB for distributed.

import type {
  ExecutionLease,
  ILeaseRegistry,
  LeaseAcquisitionResult,
  LeaseStatus,
} from './lease.contracts';
import { v4 as uuidv4 } from 'uuid';

export class InMemoryLeaseRegistry implements ILeaseRegistry {
  private readonly _leases = new Map<string, ExecutionLease>();

  acquire(
    runId: string,
    workerId: string,
    environmentId: string,
    ttlMs: number,
  ): LeaseAcquisitionResult {
    const existing = this._leases.get(runId);
    if (existing && existing.status === 'active' && !this._isExpired(existing)) {
      return {
        success: false,
        lease: null,
        conflictingRunId: runId,
        reason: 'Run already leased',
      };
    }
    const now = Date.now();
    const lease: ExecutionLease = {
      leaseId: `lease-${uuidv4().slice(0, 8)}`,
      runId,
      workerId,
      environmentId,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      ttlMs,
      status: 'active',
    };
    this._leases.set(runId, lease);
    return { success: true, lease };
  }

  release(runId: string): boolean {
    const lease = this._leases.get(runId);
    if (!lease) return false;
    // Readonly interface — create new object with released status
    const released: ExecutionLease = { ...lease, status: 'released' as LeaseStatus };
    this._leases.set(runId, released);
    return true;
  }

  getLease(runId: string): ExecutionLease | null {
    return this._leases.get(runId) ?? null;
  }

  isLeased(runId: string): boolean {
    const lease = this._leases.get(runId);
    return !!lease && lease.status === 'active' && !this._isExpired(lease);
  }

  listExpired(): ExecutionLease[] {
    return [...this._leases.values()].filter(
      l => l.status === 'active' && this._isExpired(l),
    );
  }

  listActive(): ExecutionLease[] {
    return [...this._leases.values()].filter(
      l => l.status === 'active' && !this._isExpired(l),
    );
  }

  private _isExpired(lease: ExecutionLease): boolean {
    return Date.now() > new Date(lease.expiresAt).getTime();
  }
}

let _registry: InMemoryLeaseRegistry | null = null;

export function getLeaseRegistrySingleton(): InMemoryLeaseRegistry {
  if (!_registry) _registry = new InMemoryLeaseRegistry();
  return _registry;
}

export function _resetLeaseRegistrySingleton(): void {
  _registry = null;
}
```

### Step 2.6 — Run tests (expected: all pass)

```bash
npx vitest run src/api-runtime/execution-leasing/__tests__/lease-registry.test.ts
```

Expected output:
```
✓ src/api-runtime/execution-leasing/__tests__/lease-registry.test.ts (8)
  ✓ InMemoryLeaseRegistry > acquire returns success with lease
  ✓ InMemoryLeaseRegistry > second acquire for same runId returns conflict
  ✓ InMemoryLeaseRegistry > isLeased returns true after acquire
  ✓ InMemoryLeaseRegistry > release marks lease as released
  ✓ InMemoryLeaseRegistry > acquire succeeds after release
  ✓ InMemoryLeaseRegistry > listExpired returns expired active leases
  ✓ InMemoryLeaseRegistry > listActive returns non-expired leases
  ✓ InMemoryLeaseRegistry > listExpired omits released leases

Test Files  1 passed (1)
Tests       8 passed (8)
```

### Step 2.7 — Commit

```bash
git add src/api-runtime/execution-leasing/
git commit -m "feat(execution-leasing): add ILeaseRegistry + InMemoryLeaseRegistry with TTL and stuck-run detection"
```

---

## Task 3: Environment Isolation Contracts + Lock Registry

Adds exclusive/shared environment locking. Prevents two runs from hitting the same environment simultaneously (exclusive mode). Shared mode allows multiple read-only runs. NOT wired into execution yet.

### Step 3.1 — Create directories

```bash
mkdir -p src/api-runtime/environment-isolation/__tests__
```

### Step 3.2 — Write the failing test first

Create `src/api-runtime/environment-isolation/__tests__/env-lock-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEnvironmentLockRegistry } from '../in-memory-env-lock-registry';
import type { EnvironmentIsolationPolicy } from '../env-isolation.contracts';

const exclusive: EnvironmentIsolationPolicy = { mode: 'exclusive', lockTtlMs: 60_000 };
const shared: EnvironmentIsolationPolicy = { mode: 'shared', lockTtlMs: 60_000 };

describe('InMemoryEnvironmentLockRegistry', () => {
  let reg: InMemoryEnvironmentLockRegistry;
  beforeEach(() => { reg = new InMemoryEnvironmentLockRegistry(); });

  it('exclusive lock acquired when env is free', () => {
    const r = reg.lock('env-1', 'run-1', 'w-1', exclusive);
    expect(r.acquired).toBe(true);
    expect(r.lock!.environmentId).toBe('env-1');
  });

  it('second exclusive lock for same env conflicts', () => {
    reg.lock('env-1', 'run-1', 'w-1', exclusive);
    const r = reg.lock('env-1', 'run-2', 'w-1', exclusive);
    expect(r.acquired).toBe(false);
    expect(r.conflictingRunId).toBe('run-1');
  });

  it('shared mode allows multiple runs on same env', () => {
    reg.lock('env-1', 'run-1', 'w-1', shared);
    const r = reg.lock('env-1', 'run-2', 'w-1', shared);
    expect(r.acquired).toBe(true);
    expect(reg.getConflicts('env-1').length).toBe(2);
  });

  it('unlock releases the lock', () => {
    reg.lock('env-1', 'run-1', 'w-1', exclusive);
    expect(reg.unlock('env-1', 'run-1')).toBe(true);
    expect(reg.isLocked('env-1')).toBe(false);
  });

  it('exclusive lock succeeds after unlock', () => {
    reg.lock('env-1', 'run-1', 'w-1', exclusive);
    reg.unlock('env-1', 'run-1');
    expect(reg.lock('env-1', 'run-2', 'w-1', exclusive).acquired).toBe(true);
  });

  it('isLocked false when no locks', () => {
    expect(reg.isLocked('env-1')).toBe(false);
  });

  it('getActiveLocks returns all non-expired locks across envs', () => {
    reg.lock('env-1', 'run-1', 'w-1', exclusive);
    reg.lock('env-2', 'run-2', 'w-1', exclusive);
    expect(reg.getActiveLocks().length).toBe(2);
  });

  it('expired locks not counted as active', async () => {
    reg.lock('env-1', 'run-1', 'w-1', { mode: 'exclusive', lockTtlMs: 1 });
    await new Promise(r => setTimeout(r, 10));
    expect(reg.isLocked('env-1')).toBe(false);
  });
});
```

### Step 3.3 — Run failing tests (expected: compilation error)

```bash
npx vitest run src/api-runtime/environment-isolation/__tests__/env-lock-registry.test.ts
```

Expected output: error — `InMemoryEnvironmentLockRegistry` not found.

### Step 3.4 — Create `src/api-runtime/environment-isolation/env-isolation.contracts.ts`

```typescript
// src/api-runtime/environment-isolation/env-isolation.contracts.ts
// Phase D Step 12: Environment locking contracts.
// Exclusive mode: only one run per env at a time.
// Shared mode: multiple runs allowed (for read-only envs).
// NOT wired into execution yet — observability + future distributed coordination.

export type EnvironmentLockMode = 'exclusive' | 'shared';

export interface EnvironmentLock {
  readonly lockId: string;
  readonly environmentId: string;
  readonly runId: string;
  readonly workerId: string;
  readonly mode: EnvironmentLockMode;
  readonly lockedAt: string;
  readonly expiresAt: string;
}

export interface EnvironmentIsolationPolicy {
  readonly mode: EnvironmentLockMode;
  readonly lockTtlMs: number;
}

export interface LockAcquisitionResult {
  readonly acquired: boolean;
  readonly lock: EnvironmentLock | null;
  readonly conflictingRunId?: string;
  readonly reason?: string;
}

export interface IEnvironmentLockRegistry {
  lock(
    environmentId: string,
    runId: string,
    workerId: string,
    policy: EnvironmentIsolationPolicy,
  ): LockAcquisitionResult;
  unlock(environmentId: string, runId: string): boolean;
  isLocked(environmentId: string): boolean;
  getActiveLocks(): EnvironmentLock[];
  getConflicts(environmentId: string): EnvironmentLock[];
}
```

### Step 3.5 — Create `src/api-runtime/environment-isolation/in-memory-env-lock-registry.ts`

```typescript
// src/api-runtime/environment-isolation/in-memory-env-lock-registry.ts
// Phase D Step 12: In-memory environment lock registry.
// Future: back with Redis or DB for distributed multi-worker isolation.

import type {
  EnvironmentLock,
  EnvironmentIsolationPolicy,
  IEnvironmentLockRegistry,
  LockAcquisitionResult,
} from './env-isolation.contracts';
import { v4 as uuidv4 } from 'uuid';

export class InMemoryEnvironmentLockRegistry implements IEnvironmentLockRegistry {
  // envId → array of active locks (shared mode allows multiple)
  private readonly _locks = new Map<string, EnvironmentLock[]>();

  lock(
    environmentId: string,
    runId: string,
    workerId: string,
    policy: EnvironmentIsolationPolicy,
  ): LockAcquisitionResult {
    const active = this._activeLocks(environmentId);
    if (policy.mode === 'exclusive' && active.length > 0) {
      return {
        acquired: false,
        lock: null,
        conflictingRunId: active[0].runId,
        reason: 'Environment locked exclusively',
      };
    }
    const now = Date.now();
    const newLock: EnvironmentLock = {
      lockId: `lock-${uuidv4().slice(0, 8)}`,
      environmentId,
      runId,
      workerId,
      mode: policy.mode,
      lockedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + policy.lockTtlMs).toISOString(),
    };
    const current = this._locks.get(environmentId) ?? [];
    this._locks.set(environmentId, [...current, newLock]);
    return { acquired: true, lock: newLock };
  }

  unlock(environmentId: string, runId: string): boolean {
    const locks = this._locks.get(environmentId);
    if (!locks) return false;
    const filtered = locks.filter(l => l.runId !== runId);
    if (filtered.length === locks.length) return false;
    this._locks.set(environmentId, filtered);
    return true;
  }

  isLocked(environmentId: string): boolean {
    return this._activeLocks(environmentId).length > 0;
  }

  getActiveLocks(): EnvironmentLock[] {
    return [...this._locks.values()].flat().filter(l => !this._isExpired(l));
  }

  getConflicts(environmentId: string): EnvironmentLock[] {
    return this._activeLocks(environmentId);
  }

  private _activeLocks(envId: string): EnvironmentLock[] {
    return (this._locks.get(envId) ?? []).filter(l => !this._isExpired(l));
  }

  private _isExpired(lock: EnvironmentLock): boolean {
    return Date.now() > new Date(lock.expiresAt).getTime();
  }
}

let _registry: InMemoryEnvironmentLockRegistry | null = null;

export function getEnvLockRegistrySingleton(): InMemoryEnvironmentLockRegistry {
  if (!_registry) _registry = new InMemoryEnvironmentLockRegistry();
  return _registry;
}

export function _resetEnvLockRegistrySingleton(): void {
  _registry = null;
}
```

### Step 3.6 — Run tests (expected: all pass)

```bash
npx vitest run src/api-runtime/environment-isolation/__tests__/env-lock-registry.test.ts
```

Expected output:
```
✓ src/api-runtime/environment-isolation/__tests__/env-lock-registry.test.ts (8)
  ✓ InMemoryEnvironmentLockRegistry > exclusive lock acquired when env is free
  ✓ InMemoryEnvironmentLockRegistry > second exclusive lock for same env conflicts
  ✓ InMemoryEnvironmentLockRegistry > shared mode allows multiple runs on same env
  ✓ InMemoryEnvironmentLockRegistry > unlock releases the lock
  ✓ InMemoryEnvironmentLockRegistry > exclusive lock succeeds after unlock
  ✓ InMemoryEnvironmentLockRegistry > isLocked false when no locks
  ✓ InMemoryEnvironmentLockRegistry > getActiveLocks returns all non-expired locks across envs
  ✓ InMemoryEnvironmentLockRegistry > expired locks not counted as active

Test Files  1 passed (1)
Tests       8 passed (8)
```

### Step 3.7 — Commit

```bash
git add src/api-runtime/environment-isolation/
git commit -m "feat(environment-isolation): add IEnvironmentLockRegistry + exclusive/shared env locking"
```

---

## Task 4: Worker Health Aggregator + Routes

Aggregates health from coordinator + lease registry. Detects stuck runs (active leases past a configurable threshold). Exposes `GET /api/worker-pool/health` and `GET /api/worker-pool/health/stuck-runs`.

### Step 4.1 — Create directories

```bash
mkdir -p src/api-runtime/worker-health/routes
mkdir -p src/api-runtime/worker-health/__tests__
```

### Step 4.2 — Write the failing test first

Create `src/api-runtime/worker-health/__tests__/worker-health-aggregator.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { aggregatePoolHealth } from '../worker-health-aggregator';
import { InMemoryLeaseRegistry } from '../../execution-leasing/in-memory-lease-registry';
import type { WorkerHealthSnapshot } from '../../execution-coordinator/runtime-lifecycle';

function makeHealth(isAccepting = true): WorkerHealthSnapshot {
  return {
    workerId: 'w-1',
    runtimeType: 'in-process',
    lifecycleState: 'idle',
    activeRunCount: 0,
    totalRunsCompleted: 0,
    totalRunsFailed: 0,
    lastActiveAt: new Date().toISOString(),
    isAcceptingWork: isAccepting,
    capturedAt: new Date().toISOString(),
  };
}

describe('aggregatePoolHealth', () => {
  let leaseRegistry: InMemoryLeaseRegistry;
  beforeEach(() => { leaseRegistry = new InMemoryLeaseRegistry(); });

  it('isHealthy true when worker accepting and no stuck runs', () => {
    const report = aggregatePoolHealth(makeHealth(true), leaseRegistry);
    expect(report.isHealthy).toBe(true);
    expect(report.stuckRuns).toHaveLength(0);
  });

  it('isHealthy false when worker not accepting work', () => {
    const report = aggregatePoolHealth(makeHealth(false), leaseRegistry);
    expect(report.isHealthy).toBe(false);
  });

  it('isHealthy false when null workerHealth', () => {
    const report = aggregatePoolHealth(null, leaseRegistry);
    expect(report.isHealthy).toBe(false);
  });

  it('detects stuck runs past threshold', async () => {
    leaseRegistry.acquire('run-stuck', 'w-1', 'env-1', 60_000);
    await new Promise(r => setTimeout(r, 10));
    // 5ms threshold — run acquired >5ms ago so it's "stuck"
    const report = aggregatePoolHealth(makeHealth(true), leaseRegistry, 5);
    expect(report.stuckRuns).toHaveLength(1);
    expect(report.stuckRuns[0].runId).toBe('run-stuck');
    expect(report.isHealthy).toBe(false);
  });

  it('non-stuck run not in stuckRuns', () => {
    leaseRegistry.acquire('run-fast', 'w-1', 'env-1', 60_000);
    const report = aggregatePoolHealth(makeHealth(true), leaseRegistry, 300_000);
    expect(report.stuckRuns).toHaveLength(0);
  });

  it('reports active and expired lease counts', async () => {
    leaseRegistry.acquire('run-active', 'w-1', 'env-1', 60_000);
    leaseRegistry.acquire('run-expired', 'w-1', 'env-1', 1);
    await new Promise(r => setTimeout(r, 10));
    const report = aggregatePoolHealth(makeHealth(true), leaseRegistry);
    expect(report.activeLeases).toBe(1);
    expect(report.expiredLeases).toBe(1);
  });
});
```

### Step 4.3 — Run failing tests (expected: compilation error)

```bash
npx vitest run src/api-runtime/worker-health/__tests__/worker-health-aggregator.test.ts
```

Expected output: error — `aggregatePoolHealth` not found.

### Step 4.4 — Create `src/api-runtime/worker-health/worker-health-aggregator.ts`

```typescript
// src/api-runtime/worker-health/worker-health-aggregator.ts
// Phase D Step 12: Aggregates health from coordinator + lease registry.
// Detects stuck runs (active leases past stuck threshold).

import type { WorkerHealthSnapshot } from '../execution-coordinator/runtime-lifecycle';
import type { ILeaseRegistry } from '../execution-leasing/lease.contracts';

export interface StuckRunRecord {
  readonly runId: string;
  readonly workerId: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly stuckThresholdMs: number;
}

export interface WorkerPoolHealthReport {
  readonly capturedAt: string;
  readonly workerHealth: WorkerHealthSnapshot | null;
  readonly activeLeases: number;
  readonly expiredLeases: number;
  readonly stuckRuns: StuckRunRecord[];
  readonly isHealthy: boolean;
}

export function aggregatePoolHealth(
  workerHealth: WorkerHealthSnapshot | null,
  leaseRegistry: ILeaseRegistry,
  stuckThresholdMs = 300_000,
): WorkerPoolHealthReport {
  const active = leaseRegistry.listActive();
  const expired = leaseRegistry.listExpired();
  const now = Date.now();

  const stuckRuns: StuckRunRecord[] = active
    .map((lease): StuckRunRecord | null => {
      const elapsed = now - new Date(lease.acquiredAt).getTime();
      if (elapsed <= stuckThresholdMs) return null;
      return {
        runId: lease.runId,
        workerId: lease.workerId,
        startedAt: lease.acquiredAt,
        durationMs: elapsed,
        stuckThresholdMs,
      };
    })
    .filter((r): r is StuckRunRecord => r !== null);

  return {
    capturedAt: new Date().toISOString(),
    workerHealth,
    activeLeases: active.length,
    expiredLeases: expired.length,
    stuckRuns,
    isHealthy: (workerHealth?.isAcceptingWork ?? false) && stuckRuns.length === 0,
  };
}
```

### Step 4.5 — Create `src/api-runtime/worker-health/worker-health-singleton.ts`

```typescript
// src/api-runtime/worker-health/worker-health-singleton.ts
// Phase D Step 12: Singleton lease registry for worker-health routes.
// Isolated from getLeaseRegistrySingleton() to avoid circular deps with route layer.

import { InMemoryLeaseRegistry } from '../execution-leasing/in-memory-lease-registry';

let _leaseRegistry: InMemoryLeaseRegistry | null = null;

export function getWorkerHealthLeaseRegistry(): InMemoryLeaseRegistry {
  if (!_leaseRegistry) _leaseRegistry = new InMemoryLeaseRegistry();
  return _leaseRegistry;
}

export function _resetWorkerHealthSingleton(): void {
  _leaseRegistry = null;
}
```

### Step 4.6 — Create `src/api-runtime/worker-health/routes/worker-health.routes.ts`

```typescript
// src/api-runtime/worker-health/routes/worker-health.routes.ts
// Phase D Step 12: Worker pool health observability routes.
// GET /api/worker-pool/health        — full WorkerPoolHealthReport
// GET /api/worker-pool/health/stuck-runs — stuck runs only

import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../../auth/middleware';
import { aggregatePoolHealth } from '../worker-health-aggregator';
import { getWorkerHealthLeaseRegistry } from '../worker-health-singleton';
import { getExecutionCoordinator } from '../../execution-coordinator/coordinator';

export function registerWorkerHealthRoutes(app: Express): void {

  /**
   * GET /api/worker-pool/health
   * Returns WorkerPoolHealthReport: worker state + active/expired leases + stuck runs.
   */
  app.get('/api/worker-pool/health', requireAuth, (_req: Request, res: Response) => {
    const coordinator = getExecutionCoordinator();
    const workerHealth = coordinator ? coordinator.getWorkerHealth() : null;
    const report = aggregatePoolHealth(workerHealth, getWorkerHealthLeaseRegistry());
    return void res.json(report);
  });

  /**
   * GET /api/worker-pool/health/stuck-runs
   * Returns only stuck runs (active leases past 5-minute threshold).
   */
  app.get('/api/worker-pool/health/stuck-runs', requireAuth, (_req: Request, res: Response) => {
    const coordinator = getExecutionCoordinator();
    const workerHealth = coordinator ? coordinator.getWorkerHealth() : null;
    const report = aggregatePoolHealth(workerHealth, getWorkerHealthLeaseRegistry());
    return void res.json({ stuckRuns: report.stuckRuns, capturedAt: report.capturedAt });
  });
}
```

### Step 4.7 — Run tests (expected: all pass)

```bash
npx vitest run src/api-runtime/worker-health/__tests__/worker-health-aggregator.test.ts
```

Expected output:
```
✓ src/api-runtime/worker-health/__tests__/worker-health-aggregator.test.ts (6)
  ✓ aggregatePoolHealth > isHealthy true when worker accepting and no stuck runs
  ✓ aggregatePoolHealth > isHealthy false when worker not accepting work
  ✓ aggregatePoolHealth > isHealthy false when null workerHealth
  ✓ aggregatePoolHealth > detects stuck runs past threshold
  ✓ aggregatePoolHealth > non-stuck run not in stuckRuns
  ✓ aggregatePoolHealth > reports active and expired lease counts

Test Files  1 passed (1)
Tests       6 passed (6)
```

### Step 4.8 — Commit

```bash
git add src/api-runtime/worker-health/
git commit -m "feat(worker-health): add aggregatePoolHealth, WorkerPoolHealthReport, stuck-run detection, and health routes"
```

---

## Task 5: Queue & Orchestration Abstraction

Adds an execution queue abstraction for future distributed queues. `InMemoryExecutionQueue` passes through to coordinator synchronously today. Future: replace with Redis/SQS/Azure Service Bus backend without changing callers.

### Step 5.1 — Create directories

```bash
mkdir -p src/api-runtime/orchestration/__tests__
```

### Step 5.2 — Write the failing test first

Create `src/api-runtime/orchestration/__tests__/in-memory-queue.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryExecutionQueue } from '../in-memory-execution-queue';
import type { ExecutionRequest } from '../../execution-coordinator/contracts';

function makeRequest(runId: string): ExecutionRequest {
  return {
    runId,
    runtimeType: 'in-process',
    collection: {
      id: 'col-1',
      name: 'Test',
      steps: [],
      projectId: undefined,
    } as any,
    environment: {
      id: 'env-1',
      name: 'Test',
      baseUrl: 'http://localhost',
    } as any,
    initialVariables: {},
    enqueuedAt: new Date().toISOString(),
  };
}

describe('InMemoryExecutionQueue', () => {
  let queue: InMemoryExecutionQueue;
  beforeEach(() => { queue = new InMemoryExecutionQueue(); });

  it('size is 0 initially', () => { expect(queue.size).toBe(0); });

  it('dequeue returns null when empty', () => { expect(queue.dequeue()).toBeNull(); });

  it('peek returns null when empty', () => { expect(queue.peek()).toBeNull(); });

  it('enqueue increases size', () => {
    queue.enqueue(makeRequest('run-1'));
    expect(queue.size).toBe(1);
  });

  it('dequeue returns enqueued item and reduces size', () => {
    const req = makeRequest('run-1');
    queue.enqueue(req);
    const item = queue.dequeue();
    expect(item!.request.runId).toBe('run-1');
    expect(queue.size).toBe(0);
  });

  it('FIFO ordering for equal priority', () => {
    queue.enqueue(makeRequest('run-1'));
    queue.enqueue(makeRequest('run-2'));
    expect(queue.dequeue()!.request.runId).toBe('run-1');
    expect(queue.dequeue()!.request.runId).toBe('run-2');
  });

  it('higher priority dequeued before lower', () => {
    queue.enqueue(makeRequest('run-low'), 0);
    queue.enqueue(makeRequest('run-high'), 10);
    expect(queue.dequeue()!.request.runId).toBe('run-high');
  });

  it('processedCount increments on dequeue', () => {
    queue.enqueue(makeRequest('run-1'));
    queue.dequeue();
    expect(queue.getMetrics().processedCount).toBe(1);
  });

  it('peek does not remove item', () => {
    queue.enqueue(makeRequest('run-1'));
    queue.peek();
    expect(queue.size).toBe(1);
  });
});
```

### Step 5.3 — Run failing tests (expected: compilation error)

```bash
npx vitest run src/api-runtime/orchestration/__tests__/in-memory-queue.test.ts
```

Expected output: error — `InMemoryExecutionQueue` not found.

### Step 5.4 — Create `src/api-runtime/orchestration/queue.contracts.ts`

```typescript
// src/api-runtime/orchestration/queue.contracts.ts
// Phase D Step 12: Execution queue abstraction for future distributed queues.
// InMemoryExecutionQueue passes through to coordinator synchronously today.
// Future: replace with Redis/SQS/Azure Service Bus backend.

import type { ExecutionRequest, ExecutionResultEnvelope } from '../execution-coordinator/contracts';

export interface QueuedExecutionRequest {
  readonly queueId: string;
  readonly request: ExecutionRequest;
  readonly enqueuedAt: string;
  readonly priority: number;
}

export interface QueueMetrics {
  readonly pendingCount: number;
  readonly processedCount: number;
  readonly failedCount: number;
  readonly capturedAt: string;
}

export interface IExecutionQueue {
  enqueue(request: ExecutionRequest, priority?: number): QueuedExecutionRequest;
  dequeue(): QueuedExecutionRequest | null;
  peek(): QueuedExecutionRequest | null;
  getMetrics(): QueueMetrics;
  readonly size: number;
}

export interface IOrchestrationBroker {
  submit(request: ExecutionRequest): Promise<ExecutionResultEnvelope>;
  getQueueMetrics(): QueueMetrics;
  readonly isReady: boolean;
}
```

### Step 5.5 — Create `src/api-runtime/orchestration/in-memory-execution-queue.ts`

```typescript
// src/api-runtime/orchestration/in-memory-execution-queue.ts
// Phase D Step 12: In-memory execution queue with priority insertion.
// Future: swap implementation for Redis/SQS/Azure without changing callers.

import { v4 as uuidv4 } from 'uuid';
import type { ExecutionRequest } from '../execution-coordinator/contracts';
import type { IExecutionQueue, QueuedExecutionRequest, QueueMetrics } from './queue.contracts';

export class InMemoryExecutionQueue implements IExecutionQueue {
  private _queue: QueuedExecutionRequest[] = [];
  private _processedCount = 0;
  private _failedCount = 0;

  enqueue(request: ExecutionRequest, priority = 0): QueuedExecutionRequest {
    const item: QueuedExecutionRequest = {
      queueId: `q-${uuidv4().slice(0, 8)}`,
      request,
      enqueuedAt: new Date().toISOString(),
      priority,
    };
    // Insert in priority order (higher priority = earlier position)
    const insertIdx = this._queue.findIndex(i => i.priority < priority);
    if (insertIdx === -1) {
      this._queue.push(item);
    } else {
      this._queue.splice(insertIdx, 0, item);
    }
    return item;
  }

  dequeue(): QueuedExecutionRequest | null {
    const item = this._queue.shift() ?? null;
    if (item) this._processedCount++;
    return item;
  }

  peek(): QueuedExecutionRequest | null {
    return this._queue[0] ?? null;
  }

  getMetrics(): QueueMetrics {
    return {
      pendingCount: this._queue.length,
      processedCount: this._processedCount,
      failedCount: this._failedCount,
      capturedAt: new Date().toISOString(),
    };
  }

  get size(): number {
    return this._queue.length;
  }
}
```

### Step 5.6 — Run tests (expected: all pass)

```bash
npx vitest run src/api-runtime/orchestration/__tests__/in-memory-queue.test.ts
```

Expected output:
```
✓ src/api-runtime/orchestration/__tests__/in-memory-queue.test.ts (9)
  ✓ InMemoryExecutionQueue > size is 0 initially
  ✓ InMemoryExecutionQueue > dequeue returns null when empty
  ✓ InMemoryExecutionQueue > peek returns null when empty
  ✓ InMemoryExecutionQueue > enqueue increases size
  ✓ InMemoryExecutionQueue > dequeue returns enqueued item and reduces size
  ✓ InMemoryExecutionQueue > FIFO ordering for equal priority
  ✓ InMemoryExecutionQueue > higher priority dequeued before lower
  ✓ InMemoryExecutionQueue > processedCount increments on dequeue
  ✓ InMemoryExecutionQueue > peek does not remove item

Test Files  1 passed (1)
Tests       9 passed (9)
```

### Step 5.7 — Commit

```bash
git add src/api-runtime/orchestration/
git commit -m "feat(orchestration): add IExecutionQueue + InMemoryExecutionQueue with priority FIFO passthrough"
```

---

## Task 6: Distributed Replay Compatibility Contracts

Adds contracts for future distributed replay assembly. `SingleWorkerReplayMerger` covers the current single-node case. Future multi-worker mergers implement the same `IReplayMergeEngine` interface.

### Step 6.1 — Create directories

```bash
mkdir -p src/api-observability/__tests__
```

### Step 6.2 — Write the failing test first

Create `src/api-observability/__tests__/distributed-replay.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SingleWorkerReplayMerger } from '../contracts/distributed-replay.contracts';
import type {
  DistributedReplayManifest,
  WorkerReplayFragment,
} from '../contracts/distributed-replay.contracts';
import type { ReplayEvent } from '../contracts/replay-event.contracts';

function makeFragment(events: ReplayEvent[]): WorkerReplayFragment {
  return {
    workerId: 'w-1',
    runId: 'run-1',
    collectionId: 'col-1',
    fragmentIndex: 0,
    totalFragments: 1,
    events,
    capturedAt: new Date().toISOString(),
  };
}

function makeManifest(fragments: WorkerReplayFragment[]): DistributedReplayManifest {
  return {
    runId: 'run-1',
    workers: ['w-1'],
    fragments,
    mergeStrategy: 'sequential-by-seq',
    totalEvents: fragments.reduce((s, f) => s + f.events.length, 0),
    isMergeComplete: true,
    createdAt: new Date().toISOString(),
  };
}

function makeEvent(seq: number, kind: ReplayEvent['kind'] = 'step-completed'): ReplayEvent {
  return {
    seq,
    kind,
    stepId: `step-${seq}`,
    stepName: `Step ${seq}`,
    timestamp: new Date().toISOString(),
  };
}

describe('SingleWorkerReplayMerger', () => {
  const merger = new SingleWorkerReplayMerger();

  it('strategyName is sequential-by-seq', () => {
    expect(merger.strategyName).toBe('sequential-by-seq');
  });

  it('throws if more than 1 fragment', () => {
    const manifest = makeManifest([makeFragment([]), makeFragment([])]);
    expect(() => merger.merge(manifest)).toThrow(
      'SingleWorkerReplayMerger requires exactly 1 fragment',
    );
  });

  it('returns ReplaySession with events sorted by seq', () => {
    const events = [makeEvent(3), makeEvent(1), makeEvent(2)];
    const session = merger.merge(makeManifest([makeFragment(events)]));
    expect(session.events.map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it('computes stats correctly', () => {
    const events: ReplayEvent[] = [
      { ...makeEvent(1, 'request-sent') },
      { ...makeEvent(2, 'assertion-evaluated'), assertion: { type: 'status', passed: true } },
      { ...makeEvent(3, 'assertion-evaluated'), assertion: { type: 'status', passed: false } },
      {
        ...makeEvent(4, 'retry-triggered'),
        retry: { attempt: 1, maxRetries: 3, delayMs: 0 },
      },
    ];
    const session = merger.merge(makeManifest([makeFragment(events)]));
    expect(session.stats.requestsSent).toBe(1);
    expect(session.stats.assertionsPassed).toBe(1);
    expect(session.stats.assertionsFailed).toBe(1);
    expect(session.stats.retriesTriggered).toBe(1);
  });

  it('isMergeComplete false does not throw (advisory only)', () => {
    const manifest = { ...makeManifest([makeFragment([])]), isMergeComplete: false };
    expect(() => merger.merge(manifest)).not.toThrow();
  });
});
```

### Step 6.3 — Run failing tests (expected: compilation error)

```bash
npx vitest run src/api-observability/__tests__/distributed-replay.test.ts
```

Expected output: error — `distributed-replay.contracts` not found.

### Step 6.4 — Create `src/api-observability/contracts/distributed-replay.contracts.ts`

```typescript
// src/api-observability/contracts/distributed-replay.contracts.ts
// Phase D Step 12: Contracts for future distributed replay assembly.
// ADVISORY ONLY — no merge engine implemented yet.
// SingleWorkerReplayMerger covers the current single-node case.

import type { ReplayEvent, ReplaySession } from './replay-event.contracts';

export interface WorkerReplayFragment {
  readonly workerId: string;
  readonly runId: string;
  readonly collectionId: string;
  readonly fragmentIndex: number;
  readonly totalFragments: number;
  readonly events: readonly ReplayEvent[];
  readonly capturedAt: string;
}

export type ReplayMergeStrategy =
  | 'sequential-by-seq'    // merge by event.seq (single-worker safe)
  | 'worker-ordered'       // events grouped by worker, then by seq
  | 'timestamp-ordered';   // merge by event.timestamp (clock-skew risk)

export interface DistributedReplayManifest {
  readonly runId: string;
  readonly workers: readonly string[];
  readonly fragments: readonly WorkerReplayFragment[];
  readonly mergeStrategy: ReplayMergeStrategy;
  readonly totalEvents: number;
  readonly isMergeComplete: boolean;
  readonly createdAt: string;
}

/**
 * IReplayMergeEngine — extension point for future distributed replay assembly.
 * Single-node today, distributed workers in future.
 */
export interface IReplayMergeEngine {
  merge(manifest: DistributedReplayManifest): ReplaySession;
  readonly strategyName: ReplayMergeStrategy;
}

/**
 * SingleWorkerReplayMerger — the current (single-node) merge implementation.
 * Requires exactly 1 fragment. Future multi-worker mergers implement the same interface.
 */
export class SingleWorkerReplayMerger implements IReplayMergeEngine {
  readonly strategyName: ReplayMergeStrategy = 'sequential-by-seq';

  merge(manifest: DistributedReplayManifest): ReplaySession {
    if (manifest.fragments.length !== 1) {
      throw new Error(
        `SingleWorkerReplayMerger requires exactly 1 fragment, got ${manifest.fragments.length}`,
      );
    }
    const fragment = manifest.fragments[0];
    const events = [...fragment.events].sort((a, b) => a.seq - b.seq);

    const stats = {
      requestsSent: events.filter(e => e.kind === 'request-sent').length,
      assertionsPassed: events.filter(
        e => e.kind === 'assertion-evaluated' && e.assertion?.passed,
      ).length,
      assertionsFailed: events.filter(
        e => e.kind === 'assertion-evaluated' && !e.assertion?.passed,
      ).length,
      retriesTriggered: events.filter(e => e.kind === 'retry-triggered').length,
      teardownEvents: events.filter(e => e.kind === 'teardown-executed').length,
      failuresPropagated: events.filter(e => e.kind === 'failure-propagated').length,
    };

    return {
      runId: manifest.runId,
      collectionId: fragment.collectionId,
      synthesizedAt: new Date().toISOString(),
      _schemaVersion: 1,
      events,
      eventCount: events.length,
      stats,
    };
  }
}
```

### Step 6.5 — Run tests (expected: all pass)

```bash
npx vitest run src/api-observability/__tests__/distributed-replay.test.ts
```

Expected output:
```
✓ src/api-observability/__tests__/distributed-replay.test.ts (5)
  ✓ SingleWorkerReplayMerger > strategyName is sequential-by-seq
  ✓ SingleWorkerReplayMerger > throws if more than 1 fragment
  ✓ SingleWorkerReplayMerger > returns ReplaySession with events sorted by seq
  ✓ SingleWorkerReplayMerger > computes stats correctly
  ✓ SingleWorkerReplayMerger > isMergeComplete false does not throw (advisory only)

Test Files  1 passed (1)
Tests       5 passed (5)
```

### Step 6.6 — Commit

```bash
git add src/api-observability/contracts/distributed-replay.contracts.ts
git add src/api-observability/__tests__/distributed-replay.test.ts
git commit -m "feat(distributed-replay): add DistributedReplayManifest + SingleWorkerReplayMerger contracts"
```

---

## Task 7: Worker Health UI Module

Adds the `29-worker-health.js` vanilla JS module, nav tab, panel, CSS, and registers the module in `concat-modules.js`.

**Pre-requisite reading:** Before implementing, verify:
- `src/ui/public/index.html` line 160: `<div class="nav-item" data-tab="api-replay">🔍 Replay</div>`
- `src/ui/public/index.html` lines 1238-1241: `<div class="panel" id="panel-api-replay">` block
- `scripts/concat-modules.js` line 39: `'28-api-replay.js'`
- End of `src/ui/public/styles_addon.css`: last CSS block before EOF

### Step 7.1 — Create `src/ui/public/js/29-worker-health.js`

```javascript
// Module: Worker Health & Pool Observability UI
// Page: worker-health

function workerHealthInit() {
  workerHealthLoad();
}

async function workerHealthLoad() {
  var el = document.getElementById('worker-health-content');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted);padding:16px;">Loading worker health...</div>';
  try {
    var res = await fetch('/api/worker-pool/health');
    if (!res.ok) {
      modAlert('worker-health-alert', 'error', 'Failed to load worker health.');
      el.innerHTML = '';
      return;
    }
    var report = await res.json();
    el.innerHTML = workerHealthRenderReport(report);
  } catch (e) {
    modAlert('worker-health-alert', 'error', 'Error: ' + e.message);
    el.innerHTML = '';
  }
}

function workerHealthRenderReport(report) {
  var isHealthy = report.isHealthy;
  var wh = report.workerHealth;
  var statusLabel = isHealthy ? '✓ Healthy' : '✗ Unhealthy';
  var statusColor = isHealthy ? '#4ade80' : '#f87171';

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
    + '<div style="font-size:15px;font-weight:600;">Worker Pool Status: <span style="color:' + statusColor + ';">' + statusLabel + '</span></div>'
    + '<button class="btn btn-sm" onclick="workerHealthLoad()">⟳ Refresh</button>'
    + '</div>';

  // Coordinator worker card
  html += '<div class="worker-health-card ' + (isHealthy ? 'healthy' : 'unhealthy') + '">'
    + '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">'
    + (wh ? escHtml(wh.workerId) + ' <span style="color:#6b7280;font-weight:400;">(' + escHtml(wh.runtimeType) + ')</span>' : 'No worker registered')
    + '</div>';

  if (wh) {
    html += '<div>'
      + '<span class="worker-health-metric"><span class="metric-val">' + wh.activeRunCount + '</span><span class="metric-lbl">Active</span></span>'
      + '<span class="worker-health-metric"><span class="metric-val">' + wh.totalRunsCompleted + '</span><span class="metric-lbl">Completed</span></span>'
      + '<span class="worker-health-metric"><span class="metric-val">' + wh.totalRunsFailed + '</span><span class="metric-lbl">Failed</span></span>'
      + '<span class="worker-health-metric"><span class="metric-val" style="color:' + (wh.isAcceptingWork ? '#4ade80' : '#f87171') + ';">' + (wh.isAcceptingWork ? 'YES' : 'NO') + '</span><span class="metric-lbl">Accepting</span></span>'
      + '</div>'
      + '<div style="font-size:10px;color:#4b5563;margin-top:6px;">State: ' + escHtml(wh.lifecycleState) + ' &middot; Last active: ' + escHtml((wh.lastActiveAt || '').replace('T', ' ').slice(0, 19)) + '</div>';
  }
  html += '</div>';

  // Lease metrics
  html += '<div style="display:flex;gap:24px;margin-bottom:16px;font-size:12px;">'
    + '<div><b>' + report.activeLeases + '</b> <span style="color:#6b7280;">active leases</span></div>'
    + '<div><b>' + report.expiredLeases + '</b> <span style="color:#6b7280;">expired leases</span></div>'
    + '</div>';

  // Stuck runs
  if (report.stuckRuns && report.stuckRuns.length > 0) {
    html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:#f87171;">⚠ Stuck Runs</div>'
      + '<div style="max-height:200px;overflow-y:auto;">'
      + report.stuckRuns.map(function(r) {
          return '<div class="stuck-run-row">'
            + '<span class="stuck-run-badge">STUCK</span>'
            + '<span style="font-family:monospace;font-size:11px;">' + escHtml(r.runId) + '</span>'
            + '<span style="color:#6b7280;">' + escHtml(r.workerId) + '</span>'
            + '<span style="color:#9ca3af;">+' + Math.round(r.durationMs / 1000) + 's</span>'
            + '</div>';
        }).join('')
      + '</div>';
  } else {
    html += '<div style="font-size:12px;color:#4b5563;">No stuck runs detected.</div>';
  }

  html += '<div style="font-size:10px;color:#374151;margin-top:12px;">Captured: ' + escHtml((report.capturedAt || '').replace('T', ' ').slice(0, 19)) + '</div>';
  return html;
}

if (typeof registerPageModule === 'function') {
  registerPageModule('worker-health', workerHealthInit);
}
```

### Step 7.2 — Append CSS to `src/ui/public/styles_addon.css`

Append to the end of the file (after the last existing block ending at `.timeline-event-type.evt-node-retrying { color: #fbbf24; }`):

```css

/* ── Phase D Step 12: Worker Health & Pool Observability ─────────────────── */
.worker-health-card {
  background: #111827;
  border: 1px solid #374151;
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.worker-health-card.healthy { border-left: 3px solid #4ade80; }
.worker-health-card.unhealthy { border-left: 3px solid #f87171; }
.worker-health-metric {
  display: inline-block;
  margin-right: 20px;
  font-size: 12px;
}
.worker-health-metric .metric-val { font-weight: 700; font-size: 18px; display: block; }
.worker-health-metric .metric-lbl { color: #6b7280; }
.stuck-run-row {
  padding: 4px 8px;
  font-size: 11px;
  border-bottom: 1px solid #1f2937;
  display: flex;
  gap: 12px;
  align-items: center;
}
.stuck-run-badge { background: #7f1d1d; color: #fca5a5; font-size: 10px; padding: 1px 6px; border-radius: 3px; }
```

### Step 7.3 — Add nav tab to `src/ui/public/index.html`

Locate line 160:
```html
        <div class="nav-item" data-tab="api-replay">🔍 Replay</div>
```

After that line add:
```html
        <div class="nav-item" data-tab="worker-health">⚙️ Workers</div>
```

### Step 7.4 — Add panel to `src/ui/public/index.html`

Locate lines 1238-1241:
```html
        <div class="panel" id="panel-api-replay">
          <div id="api-replay-alert"></div>
          <div id="api-replay-content"></div>
        </div><!-- /panel-api-replay -->
```

After that block add:
```html
        <div class="panel" id="panel-worker-health">
          <div id="worker-health-alert"></div>
          <div id="worker-health-content"></div>
        </div><!-- /panel-worker-health -->
```

### Step 7.5 — Register module in `scripts/concat-modules.js`

Locate line 39:
```javascript
  '28-api-replay.js',
```

After that line add:
```javascript
  '29-worker-health.js',
```

### Step 7.6 — Build and verify module concat

```bash
node scripts/concat-modules.js
```

Expected output: no errors, `modules.js` updated with `29-worker-health.js` content appended.

### Step 7.7 — TypeScript build check (no errors expected)

```bash
npx tsc --noEmit
```

Expected output: no errors.

### Step 7.8 — Commit

```bash
git add src/ui/public/js/29-worker-health.js
git add src/ui/public/index.html
git add src/ui/public/styles_addon.css
git add scripts/concat-modules.js
git commit -m "feat(worker-health-ui): add 29-worker-health.js worker pool dashboard with stuck-run display"
```

---

## Task 8: Cloud Extension Contracts + server.ts + CLAUDE.md

Adds the cloud worker extension point (`NoOpWorkerProvider` — no-op today), registers routes in `server.ts`, and updates `CLAUDE.md` with plan reference and shipped section.

### Step 8.1 — Create directories

```bash
mkdir -p src/api-runtime/cloud-extension
```

### Step 8.2 — Create `src/api-runtime/cloud-extension/cloud-worker.contracts.ts`

```typescript
// src/api-runtime/cloud-extension/cloud-worker.contracts.ts
// Phase D Step 12: Extension points for future Kubernetes/Azure/cloud worker provisioning.
// ADVISORY ONLY — NoOpWorkerProvider is the only implementation today.
// Replace with a real provider (AzureContainerWorkerProvider, K8sWorkerProvider) in future.

export interface CloudWorkerConfig {
  readonly imageTag?: string;
  readonly region?: string;
  readonly maxConcurrency?: number;
  readonly timeoutMs?: number;
  readonly labels?: Record<string, string>;
}

export interface WorkerProvisionRequest {
  readonly requestId: string;
  readonly runtimeType: 'child-process' | 'remote-worker';
  readonly config: CloudWorkerConfig;
  readonly requestedAt: string;
}

export interface WorkerProvisionResult {
  readonly requestId: string;
  readonly success: boolean;
  readonly workerId?: string;
  readonly provisionedAt?: string;
  readonly error?: string;
}

export interface IWorkerProvider {
  provisionWorker(request: WorkerProvisionRequest): Promise<WorkerProvisionResult>;
  deprovisionWorker(workerId: string): Promise<boolean>;
  listProvisionedWorkers(): Promise<string[]>;
  readonly providerName: string;
}

/**
 * NoOpWorkerProvider — the default provider. Always returns success: false.
 * Replace with a real cloud provider when distributed execution is needed.
 * Preserves backward compatibility: single-node execution is unaffected.
 */
export class NoOpWorkerProvider implements IWorkerProvider {
  readonly providerName = 'no-op';

  async provisionWorker(request: WorkerProvisionRequest): Promise<WorkerProvisionResult> {
    return {
      requestId: request.requestId,
      success: false,
      error: 'NoOpWorkerProvider: cloud worker provisioning not available in this environment',
    };
  }

  async deprovisionWorker(_workerId: string): Promise<boolean> {
    return false;
  }

  async listProvisionedWorkers(): Promise<string[]> {
    return [];
  }
}
```

### Step 8.3 — Register worker health routes in `src/ui/server.ts`

Locate the existing import for observability routes (around line 61):
```typescript
import { registerObservabilityRoutes } from '../api-observability/routes/observability.routes';
```

After that line, add:
```typescript
import { registerWorkerHealthRoutes } from '../api-runtime/worker-health/routes/worker-health.routes';
```

Locate the existing call (around line 233):
```typescript
registerObservabilityRoutes(app);
```

After that line, add:
```typescript
registerWorkerHealthRoutes(app);
```

### Step 8.4 — Update `CLAUDE.md`

**Addition 1:** Locate line 127:
```
> **📋 See [docs/superpowers/plans/2026-05-19-phase-d-step11-observability-replay.md](docs/superpowers/plans/2026-05-19-phase-d-step11-observability-replay.md) — Phase D Step 11 implementation plan (8 tasks). **COMPLETE as of 2026-05-19.**
```

After that line add:
```
> **📋 See [docs/superpowers/plans/2026-05-20-phase-d-step12-distributed-execution-readiness.md](docs/superpowers/plans/2026-05-20-phase-d-step12-distributed-execution-readiness.md) — Phase D Step 12 implementation plan (8 tasks). **COMPLETE as of 2026-05-20.**
```

**Addition 2:** Locate the shipped section for Step 11 (around line 294):
```markdown
### Observability, Replay Engine & Execution Intelligence (shipped 2026-05-19)
```

After the last bullet point under that section, add the new shipped section:

```markdown
### Distributed Execution Readiness (shipped 2026-05-20)
- Module: `src/api-runtime/worker-pool/` — `IWorkerPool`, `SimpleWorkerPool` (round-robin selection, skip-disposed)
- Module: `src/api-runtime/execution-leasing/` — `ILeaseRegistry`, `InMemoryLeaseRegistry` (acquire/release/expiry/stuck-run detection)
- Module: `src/api-runtime/environment-isolation/` — `IEnvironmentLockRegistry`, `InMemoryEnvironmentLockRegistry` (exclusive/shared env locking)
- Module: `src/api-runtime/worker-health/` — `aggregatePoolHealth()`, `WorkerPoolHealthReport`, `StuckRunRecord`; singleton lease registry
- Routes: `GET /api/worker-pool/health`, `GET /api/worker-pool/health/stuck-runs`
- Module: `src/api-runtime/orchestration/` — `IExecutionQueue`, `IOrchestrationBroker`, `InMemoryExecutionQueue` (priority FIFO passthrough)
- Module: `src/api-runtime/cloud-extension/` — `IWorkerProvider`, `NoOpWorkerProvider` (K8s/Azure extension point, no-op today)
- Contracts: `distributed-replay.contracts.ts` — `DistributedReplayManifest`, `SingleWorkerReplayMerger` (single-node today)
- UI: `29-worker-health.js` — worker pool health dashboard, stuck run detection, live refresh
- Backward compat: coordinator/WorkflowEngine/apiRunner.ts/DAG untouched; single-node default unchanged
```

### Step 8.5 — TypeScript build check

```bash
npx tsc --noEmit
```

Expected output: no errors.

### Step 8.6 — Run full test suite

```bash
npx vitest run src/api-runtime/worker-pool/__tests__/worker-pool.test.ts \
  src/api-runtime/execution-leasing/__tests__/lease-registry.test.ts \
  src/api-runtime/environment-isolation/__tests__/env-lock-registry.test.ts \
  src/api-runtime/worker-health/__tests__/worker-health-aggregator.test.ts \
  src/api-runtime/orchestration/__tests__/in-memory-queue.test.ts \
  src/api-observability/__tests__/distributed-replay.test.ts
```

Expected output:
```
Test Files  6 passed (6)
Tests       43 passed (43)
```

### Step 8.7 — Commit

```bash
git add src/api-runtime/cloud-extension/cloud-worker.contracts.ts
git add src/ui/server.ts
git add CLAUDE.md
git commit -m "feat(cloud-extension): add NoOpWorkerProvider + register worker health routes + update CLAUDE.md"
```

---

## Final Verification

After all 8 tasks are complete, run the full suite one final time:

```bash
npx vitest run src/api-runtime/ src/api-observability/__tests__/distributed-replay.test.ts
```

And a TypeScript build check:

```bash
npx tsc --noEmit
```

Both must pass with zero errors before marking Phase D Step 12 complete.

---

## Summary of Tasks

| Task | What it implements |
|------|--------------------|
| Task 1 | `IWorkerPool` contract + `SimpleWorkerPool` with round-robin selection and dispose-aware filtering |
| Task 2 | `ILeaseRegistry` contract + `InMemoryLeaseRegistry` with TTL, acquire/release, and expired-lease detection |
| Task 3 | `IEnvironmentLockRegistry` contract + `InMemoryEnvironmentLockRegistry` with exclusive/shared locking and TTL expiry |
| Task 4 | `aggregatePoolHealth()` + `WorkerPoolHealthReport` + stuck-run detection + `GET /api/worker-pool/health` routes |
| Task 5 | `IExecutionQueue` + `IOrchestrationBroker` contracts + `InMemoryExecutionQueue` with priority FIFO |
| Task 6 | `DistributedReplayManifest` + `IReplayMergeEngine` + `SingleWorkerReplayMerger` for current single-node replay |
| Task 7 | `29-worker-health.js` UI module + nav tab + panel + CSS + `concat-modules.js` registration |
| Task 8 | `NoOpWorkerProvider` cloud extension point + `server.ts` route registration + `CLAUDE.md` updates |
