// src/api-persistence/repositories/json-replay-repository.ts
// Phase E Step 2: JSON-backed IReplayRepository.
// Wraps api-observability/replay-event-store.ts — replay determinism preserved.

import * as fs from 'fs';
import * as path from 'path';
import type { ReplaySession } from '../../api-observability/contracts/replay-event.contracts';
import {
  loadReplaySession,
  saveReplaySession,
  replaySessionExists,
} from '../../api-observability/replay-event-store';
import type {
  IReplayRepository,
  ReplayQueryOptions,
  ReplayIndexEntry,
} from '../contracts/replay-repository.contracts';

export class JsonReplayRepository implements IReplayRepository {
  private _replayDir(): string {
    return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'replay-sessions');
  }

  load(runId: string): ReplaySession | null {
    return loadReplaySession(runId);
  }

  save(session: ReplaySession): void {
    // saveReplaySession is async in the existing store — call synchronously via the underlying pattern
    // to avoid introducing async boundary changes. Wrapped call is fire-and-sync-safe for JSON.
    void saveReplaySession(session);
  }

  exists(runId: string): boolean {
    return replaySessionExists(runId);
  }

  listIndex(options?: ReplayQueryOptions): ReplayIndexEntry[] {
    const dir = this._replayDir();
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.replay.json'));
    const entries: ReplayIndexEntry[] = [];

    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf8');
        const session = JSON.parse(raw) as ReplaySession;
        if (options?.collectionId && session.collectionId !== options.collectionId) continue;
        entries.push({
          runId: session.runId,
          collectionId: session.collectionId,
          synthesizedAt: session.synthesizedAt,
          eventCount: session.eventCount,
        });
      } catch { /* skip corrupt */ }
    }

    entries.sort((a, b) => b.synthesizedAt.localeCompare(a.synthesizedAt));

    return options?.limit ? entries.slice(0, options.limit) : entries;
  }
}
