// src/api-orchestration/contracts/distributed-replay-coordinator.contracts.ts
// Phase E Step 3: Distributed replay coordination contracts.
// Ensures replay timelines remain deterministic across future multi-worker scenarios.
// Single-worker today: merge is a pass-through. Future: merge sharded replay sessions.

import type { ReplaySession } from '../../api-observability/contracts/replay-event.contracts';

export interface ReplayWorkerContribution {
  readonly workerId: string;
  readonly runId: string;
  readonly session: ReplaySession;
  readonly shardIndex: number;
  readonly totalShards: number;
}

export interface MergedReplayResult {
  readonly runId: string;
  readonly mergedSession: ReplaySession;
  readonly workerCount: number;
  readonly deterministicGuarantee: true;
  readonly mergedAt: string;
}

export interface IDistributedReplayCoordinator {
  /** Merge one or more worker replay contributions into a single deterministic session. */
  merge(contributions: readonly ReplayWorkerContribution[]): MergedReplayResult;
  /** Validate that a merged session preserves sequential event ordering. */
  validateDeterminism(session: ReplaySession): boolean;
}
