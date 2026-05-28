// src/api-persistence/contracts/replay-repository.contracts.ts
// Phase E Step 2: Repository interface for ReplaySession persistence.
// Replay determinism invariant: stored sessions are immutable once written.

import type { ReplaySession } from '../../api-observability/contracts/replay-event.contracts';

export interface ReplayQueryOptions {
  collectionId?: string;
  limit?: number;
}

export interface ReplayIndexEntry {
  readonly runId: string;
  readonly collectionId: string;
  readonly synthesizedAt: string;
  readonly eventCount: number;
}

export interface IReplayRepository {
  /** Load full replay session — null if not synthesized yet. */
  load(runId: string): ReplaySession | null;
  /** Persist immutable replay session (atomic write). */
  save(session: ReplaySession): void;
  exists(runId: string): boolean;
  /** List index entries without loading full session payloads. */
  listIndex(options?: ReplayQueryOptions): ReplayIndexEntry[];
}
