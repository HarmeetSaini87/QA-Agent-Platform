// src/api-copilot/contracts/replay-reasoning.contracts.ts
// Phase E Step 10: Replay-assisted AI reasoning contracts. Read-only analysis — never mutates replay.

export interface ReplaySummary {
  readonly runId: string;
  readonly collectionId: string;
  readonly totalEvents: number;
  readonly failedStepIds: readonly string[];
  readonly retryStepIds: readonly string[];
  readonly teardownStepIds: readonly string[];
  readonly anomalySignals: readonly string[];
  readonly summarizedAt: string;
}

export interface RcaEvidenceCorrelation {
  readonly correlationId: string;
  readonly runId: string;
  readonly collectionId: string;
  readonly primaryFailureStepId: string;
  readonly correlatedStepIds: readonly string[];
  readonly evidenceItems: readonly {
    readonly stepId: string;
    readonly signal: string;
    readonly weight: number;   // 0–1
  }[];
  readonly rootCauseHypothesis: string;
  readonly confidence: number;   // 0–100
  readonly generatedAt: string;
}

export interface IReplayReasoningEngine {
  summarizeReplay(runId: string, collectionId: string): ReplaySummary;
  correlateRcaEvidence(runId: string, collectionId: string, failedStepId: string): RcaEvidenceCorrelation;
}
