/**
 * artifact-capture.ts
 * SKELETON — Phase C implementation target.
 *
 * Interfaces for HAR recording, request/response snapshots, and trace references.
 * Phase C: Playwright HAR recording wired in via recordHar on RequestContextOptions.
 * Phase A: all stubs are safe no-ops — capture never occurs until Phase C.
 */

export interface HarMetadata {
  runId: string;
  stepId: string;
  /** Absolute path where HAR file will be written — Phase C */
  harPath?: string;
  captureRequested: boolean;
}

export interface RequestSnapshot {
  stepId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyPreview?: string;
  capturedAt: number;
}

export interface ResponseSnapshot {
  stepId: string;
  status: number;
  headers: Record<string, string>;
  bodyPreview?: string;
  durationMs: number;
  capturedAt: number;
}

export interface TraceReference {
  runId: string;
  stepId: string;
  /** Playwright trace zip path — Phase C */
  tracePath?: string;
}

export interface CapturedArtifacts {
  requests: RequestSnapshot[];
  responses: ResponseSnapshot[];
  traces: TraceReference[];
}

export interface IArtifactCapture {
  /** Begin HAR capture for a context. Phase C: calls context.recordHar(). */
  startHar(contextId: string, meta: HarMetadata): Promise<void>;

  /** Finalise HAR and return file path. Phase C only — stub returns undefined. */
  stopHar(contextId: string): Promise<string | undefined>;

  captureRequest(snapshot: RequestSnapshot): void;
  captureResponse(snapshot: ResponseSnapshot): void;
  registerTrace(ref: TraceReference): void;

  getArtifacts(runId: string): CapturedArtifacts;
}

// ── Phase A stub — all methods are safe no-ops ────────────────────────────────

export class ArtifactCaptureStub implements IArtifactCapture {
  async startHar(_contextId: string, _meta: HarMetadata): Promise<void> { /* no-op */ }
  async stopHar(_contextId: string): Promise<string | undefined> { return undefined; }
  captureRequest(_snapshot: RequestSnapshot): void { /* no-op */ }
  captureResponse(_snapshot: ResponseSnapshot): void { /* no-op */ }
  registerTrace(_ref: TraceReference): void { /* no-op */ }
  getArtifacts(_runId: string): CapturedArtifacts { return { requests: [], responses: [], traces: [] }; }
}
