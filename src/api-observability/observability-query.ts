import { loadRunResult, loadSnapshot } from '../storage-provider/execution-store';
import { loadTimeline } from '../api-runtime/artifact-engine/timeline-builder';
import { loadReplaySession, replaySessionExists, saveReplaySession } from './replay-event-store';
import { synthesizeReplaySession } from './replay-event-synthesizer';
import type { ReplaySession } from './contracts/replay-event.contracts';
import type { ExecutionTimeline } from '../shared-core/contracts/artifact.contract';
import type { ExecutionSnapshot } from '../shared-core/contracts/dependency-graph.contract';

export interface ObservabilitySummary {
  readonly runId: string;
  readonly collectionId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly stepCount: number;
  readonly hasSnapshot: boolean;
  readonly hasTimeline: boolean;
  readonly replay: ReplaySession | null;
  readonly timeline: ExecutionTimeline | null;
  readonly snapshotSummary: {
    readonly capturedAt: string;
    readonly completedNodeIds: number;
    readonly failedNodeIds: number;
    readonly skippedNodeIds: number;
  } | null;
}

export async function getObservabilitySummary(runId: string): Promise<ObservabilitySummary | null> {
  const run = loadRunResult(runId);
  if (!run) return null;

  const snapshot: ExecutionSnapshot | undefined = loadSnapshot(runId);
  const timeline: ExecutionTimeline | undefined = await loadTimeline(runId);

  let replay: ReplaySession | null;
  if (replaySessionExists(runId)) {
    replay = loadReplaySession(runId);
  } else {
    try {
      replay = synthesizeReplaySession(run, snapshot);
      await saveReplaySession(replay);
    } catch {
      replay = null;
    }
  }

  return {
    runId: run.id,
    collectionId: run.collectionId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    stepCount: run.stepResults.length,
    hasSnapshot: snapshot !== undefined,
    hasTimeline: timeline !== undefined,
    replay,
    timeline: timeline ?? null,
    snapshotSummary: snapshot ? {
      capturedAt: snapshot.capturedAt ?? '',
      completedNodeIds: snapshot.completedNodeIds?.length ?? 0,
      failedNodeIds: snapshot.failedNodeIds?.length ?? 0,
      skippedNodeIds: snapshot.skippedNodeIds?.length ?? 0,
    } : null,
  };
}
