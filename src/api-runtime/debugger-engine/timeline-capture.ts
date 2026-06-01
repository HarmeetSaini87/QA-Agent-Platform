// src/api-runtime/debugger-engine/timeline-capture.ts
// Phase F — Debugger Engine: timeline capture and retrieval.
// Loads stored timeline or synthesizes from ExecutionSnapshot as fallback.

import { loadTimeline, buildTimelineFromRecords } from '../artifact-engine/timeline-builder';
import { loadExecutionSnapshot } from '../artifact-engine/execution-store';
import type { ExecutionTimeline } from '../../shared-core/contracts/artifact.contract';

export interface TimelineCaptureResult {
  runId: string;
  timeline: ExecutionTimeline;
  source: 'stored' | 'synthesized-from-snapshot';
  advisoryNote: string;
}

export async function captureTimeline(runId: string): Promise<TimelineCaptureResult | null> {
  const stored = await loadTimeline(runId);
  if (stored) {
    return {
      runId,
      timeline: stored,
      source: 'stored',
      advisoryNote: 'Timeline loaded from stored artifact.',
    };
  }

  // Fallback: synthesize from snapshot
  const snapshot = await loadExecutionSnapshot(runId);
  if (!snapshot) return null;

  const timeline = buildTimelineFromRecords(
    snapshot.runId,
    snapshot.collectionId,
    snapshot.nodeRecords,
    snapshot.capturedAt
  );

  return {
    runId,
    timeline,
    source: 'synthesized-from-snapshot',
    advisoryNote:
      'No stored timeline artifact found. Timeline synthesized from ExecutionSnapshot. ' +
      'Timestamps may be approximate.',
  };
}
