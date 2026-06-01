import * as fs from 'fs';
import * as path from 'path';
import type { ApiStepResult } from '../../data/types';
import type { ExecutionTimeline, TimelineEvent, ArtifactRef } from '../../shared-core/contracts/artifact.contract';
import type { NodeExecutionRecord } from '../../shared-core/contracts/dependency-graph.contract';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const TIMELINE_DIR = path.join(DATA_DIR, 'api-timelines');

function ensureTimelineDir(): void {
  if (!fs.existsSync(TIMELINE_DIR)) fs.mkdirSync(TIMELINE_DIR, { recursive: true });
}

export function buildTimeline(
  runId: string,
  collectionId: string,
  stepResults: ApiStepResult[],
  startedAt: string
): ExecutionTimeline {
  const events: TimelineEvent[] = [];

  for (const r of stepResults) {
    events.push({
      nodeId: r.stepId,
      nodeName: r.stepName,
      eventType: 'node-started',
      timestamp: startedAt,
    });

    for (const ar of r.assertionResults ?? []) {
      if (!ar.passed) {
        events.push({
          nodeId: r.stepId,
          nodeName: r.stepName,
          eventType: 'assertion-failed',
          timestamp: startedAt,
          detail: ar.message,
        });
      }
    }

    for (const [key, value] of Object.entries(r.extractedVariables ?? {})) {
      events.push({
        nodeId: r.stepId,
        nodeName: r.stepName,
        eventType: 'variable-extracted',
        timestamp: startedAt,
        variableKey: key,
        variableValue: String(value),
      });
    }

    const completedEventType: TimelineEvent['eventType'] =
      r.status === 'failed' ? 'node-failed' :
      r.status === 'skipped' ? 'node-skipped' :
      'node-completed';

    events.push({
      nodeId: r.stepId,
      nodeName: r.stepName,
      eventType: completedEventType,
      timestamp: startedAt,
      durationMs: r.durationMs,
    });
  }

  const completedAt = new Date().toISOString();
  const totalDurationMs = stepResults.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);

  return { runId, collectionId, startedAt, completedAt, totalDurationMs, events };
}

/**
 * buildTimelineFromRecords — enriched timeline using accurate per-node timestamps
 * from NodeExecutionRecord (Phase C Step 2). Emits node-retrying events for
 * each retry attempt and uses startedAt/completedAt from the scheduler record.
 * Prefer this over buildTimeline() when an ExecutionSnapshot is available.
 */
export function buildTimelineFromRecords(
  runId: string,
  collectionId: string,
  nodeRecords: Record<string, NodeExecutionRecord>,
  runStartedAt: string
): ExecutionTimeline {
  const events: TimelineEvent[] = [];

  for (const record of Object.values(nodeRecords)) {
    const nodeStartedAt = record.startedAt ?? runStartedAt;

    events.push({
      nodeId: record.nodeId,
      nodeName: record.nodeName,
      eventType: 'node-started',
      timestamp: nodeStartedAt,
    });

    // Emit retrying events for each retry attempt
    if (record.retryState && record.retryState.attempt > 0) {
      for (let i = 0; i < record.retryState.attempt; i++) {
        events.push({
          nodeId: record.nodeId,
          nodeName: record.nodeName,
          eventType: 'node-retrying',
          timestamp: nodeStartedAt,
          detail: `Attempt ${i + 1} of ${record.retryState.maxRetries + 1}`,
        });
      }
    }

    const completedAt = record.completedAt ?? runStartedAt;

    if (record.status === 'failed') {
      events.push({
        nodeId: record.nodeId,
        nodeName: record.nodeName,
        eventType: 'node-failed',
        timestamp: completedAt,
        durationMs: record.durationMs,
        detail: record.error,
      });
    } else if (record.status === 'skipped') {
      events.push({
        nodeId: record.nodeId,
        nodeName: record.nodeName,
        eventType: 'node-skipped',
        timestamp: completedAt,
        detail: record.skipReason,
      });
    } else if (record.status === 'completed') {
      events.push({
        nodeId: record.nodeId,
        nodeName: record.nodeName,
        eventType: 'node-completed',
        timestamp: completedAt,
        durationMs: record.durationMs,
      });
    }
  }

  // Sort by timestamp for replay ordering
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const completedAt = new Date().toISOString();
  const totalDurationMs = Object.values(nodeRecords).reduce(
    (acc, r) => acc + (r.durationMs ?? 0), 0
  );

  return { runId, collectionId, startedAt: runStartedAt, completedAt, totalDurationMs, events };
}

export async function saveTimeline(timeline: ExecutionTimeline): Promise<ArtifactRef> {
  ensureTimelineDir();
  const filePath = path.join(TIMELINE_DIR, `${timeline.runId}.timeline.json`);
  fs.writeFileSync(filePath, JSON.stringify(timeline, null, 2));
  const stat = fs.statSync(filePath);
  return {
    type: 'timeline',
    runId: timeline.runId,
    collectionId: timeline.collectionId,
    filePath,
    sizeBytes: stat.size,
    createdAt: timeline.startedAt,
  };
}

export async function loadTimeline(runId: string): Promise<ExecutionTimeline | undefined> {
  const filePath = path.join(TIMELINE_DIR, `${runId}.timeline.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ExecutionTimeline;
}
