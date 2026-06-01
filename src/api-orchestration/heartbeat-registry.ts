// src/api-orchestration/heartbeat-registry.ts
// Phase E Step 3: In-memory worker heartbeat registry.
// Dead worker detection is advisory — platform does NOT auto-restart workers.

import type {
  IHeartbeatRegistry,
  WorkerHeartbeat,
  HeartbeatRegistrySnapshot,
} from './contracts/worker-heartbeat.contracts';

export class InMemoryHeartbeatRegistry implements IHeartbeatRegistry {
  private readonly _beats = new Map<string, WorkerHeartbeat>();

  record(heartbeat: WorkerHeartbeat): void {
    this._beats.set(heartbeat.workerId, heartbeat);
  }

  latest(workerId: string): WorkerHeartbeat | null {
    return this._beats.get(workerId) ?? null;
  }

  detectDead(deadThresholdMs: number): readonly string[] {
    const now = Date.now();
    const dead: string[] = [];
    for (const [workerId, beat] of this._beats) {
      if (now - new Date(beat.timestamp).getTime() > deadThresholdMs) {
        dead.push(workerId);
      }
    }
    return dead;
  }

  snapshot(): HeartbeatRegistrySnapshot {
    const beats = [...this._beats.values()];
    const dead = this.detectDead(60_000); // 60s default for snapshot
    return {
      capturedAt: new Date().toISOString(),
      totalWorkers: beats.length,
      liveWorkers: beats.length - dead.length,
      deadWorkers: dead,
      heartbeats: beats,
    };
  }
}

export const globalHeartbeatRegistry = new InMemoryHeartbeatRegistry();
