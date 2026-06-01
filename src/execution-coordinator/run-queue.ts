/**
 * run-queue.ts
 * SKELETON — Phase C implementation target.
 *
 * Manages in-flight run tracking — maps runId → ExecutionSnapshot.
 * Phase C: backs the coordinator's in-memory state; Phase F may
 * persist to SQLite for crash recovery.
 *
 * Phase A: type definitions only.
 */

import type { ExecutionSnapshot } from '../shared-core/contracts/execution.contract';

export class RunQueue {
  private readonly runs = new Map<string, ExecutionSnapshot>();

  set(runId: string, snapshot: ExecutionSnapshot): void {
    this.runs.set(runId, snapshot);
  }

  get(runId: string): ExecutionSnapshot | undefined {
    return this.runs.get(runId);
  }

  delete(runId: string): void {
    this.runs.delete(runId);
  }

  activeRunIds(): string[] {
    return Array.from(this.runs.keys());
  }

  count(): number {
    return this.runs.size;
  }
}
