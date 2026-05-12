/**
 * artifact.contract.ts
 * Contracts for run artifact storage (HAR, snapshots, baselines, timeline).
 *
 * Wraps existing file-based artifact storage:
 *   data/api-runs/       → run results
 *   data/api-baselines/  → baseline response snapshots
 *
 * All types are runtime-agnostic — no Playwright-specific types here.
 * Playwright HAR is serialised to a plain object before storage.
 */

import type { ApiCollectionRunResult, ApiResponseSnapshot } from '../../data/types';
import type { ExecutionSnapshot } from './dependency-graph.contract';

// ── Artifact reference ────────────────────────────────────────────────────────

export type ArtifactType =
  | 'run-result'       // full ApiCollectionRunResult JSON
  | 'baseline'         // ApiResponseSnapshot for contract drift detection
  | 'execution-snapshot' // ExecutionSnapshot for selective rerun
  | 'har'              // HTTP Archive (HAR 1.2 format)
  | 'contract-report'  // OpenAPI contract violation report
  | 'timeline';        // ExecutionTimeline for debugger

export interface ArtifactRef {
  type: ArtifactType;
  runId: string;
  collectionId: string;
  stepId?: string;
  /** Absolute path on disk — storage-agnostic identifier */
  filePath: string;
  sizeBytes?: number;
  createdAt: string;
}

// ── HAR metadata ──────────────────────────────────────────────────────────────

/** HAR 1.2 — only the fields TestForge needs; full HAR stored as raw JSON */
export interface HarEntry {
  stepId: string;
  stepName: string;
  startedAt: string;        // ISO
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    bodySize: number;
    bodyTruncated: boolean;
  };
  timings: {
    send: number;
    wait: number;
    receive: number;
  };
}

export interface HarArtifact {
  harVersion: '1.2';
  runId: string;
  collectionId: string;
  createdAt: string;
  entries: HarEntry[];
}

// ── Execution timeline — for debugger/replay UI ───────────────────────────────

export interface TimelineEvent {
  nodeId: string;
  nodeName: string;
  eventType:
    | 'node-started'
    | 'node-completed'
    | 'node-failed'
    | 'node-skipped'
    | 'node-retrying'
    | 'variable-extracted'
    | 'assertion-failed'
    | 'condition-evaluated';
  timestamp: string;
  durationMs?: number;
  detail?: string;
  variableKey?: string;
  variableValue?: string;
}

export interface ExecutionTimeline {
  runId: string;
  collectionId: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  events: TimelineEvent[];
}

// ── Artifact engine contract ──────────────────────────────────────────────────

/** Contract for the artifact-engine module (Phase C implementation target) */
export interface IArtifactEngine {
  // Run results
  saveRunResult(result: ApiCollectionRunResult): Promise<ArtifactRef>;
  loadRunResult(runId: string): Promise<ApiCollectionRunResult | undefined>;

  // Baselines
  saveBaseline(collectionId: string, stepId: string, snapshot: ApiResponseSnapshot): Promise<ArtifactRef>;
  loadBaseline(collectionId: string, stepId: string): Promise<ApiResponseSnapshot | undefined>;

  // HAR
  saveHar(har: HarArtifact): Promise<ArtifactRef>;
  loadHar(runId: string): Promise<HarArtifact | undefined>;

  // Execution snapshots
  saveExecutionSnapshot(snapshot: ExecutionSnapshot): Promise<ArtifactRef>;
  loadExecutionSnapshot(runId: string): Promise<ExecutionSnapshot | undefined>;

  // Timeline
  saveTimeline(timeline: ExecutionTimeline): Promise<ArtifactRef>;
  loadTimeline(runId: string): Promise<ExecutionTimeline | undefined>;

  // Management
  listArtifacts(collectionId: string, type?: ArtifactType): Promise<ArtifactRef[]>;
  deleteArtifact(ref: ArtifactRef): Promise<void>;
  /** Delete all artifacts older than retentionDays */
  purgeOldArtifacts(retentionDays: number): Promise<number>;
}
