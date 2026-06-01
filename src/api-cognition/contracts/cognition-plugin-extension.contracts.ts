// src/api-cognition/contracts/cognition-plugin-extension.contracts.ts
// Phase E Step 14: Cognition plugin/SDK extensibility stubs. Explainable + advisory-only.

/** Stub — cognition enrichers add explainable reasoning; never mutate orchestration. */
export interface ICognitionEnricher {
  readonly enricherId: string;
  readonly isAdvisoryOnly: true;
  enrich(
    collectionId: string,
    cognitionRecord: Record<string, unknown>
  ): { enrichedSignal: string; reasoning: string; confidence: number };
}

/** Stub — replay reasoning plugins produce explainable trails; never write replay store. */
export interface IReplayReasoningPlugin {
  readonly pluginId: string;
  readonly isReadOnly: true;
  readonly isExplainable: true;
  reason(
    runId: string,
    replaySnapshot: Record<string, unknown>
  ): { conclusion: string; reasoningChain: string[] };
}

/** Stub — operational cognition adapter bridges external cognition systems; advisory output only. */
export interface IOperationalCognitionAdapter {
  readonly adapterId: string;
  readonly isAdvisoryOnly: true;
  adapt(signal: Record<string, unknown>): { adaptedSignal: string; confidence: number };
}

/** Stub — reliability cognition scoring plugin adds dimension scores; never blocks execution. */
export interface IReliabilityCognitionScoringPlugin {
  readonly pluginId: string;
  readonly isExplainable: true;
  score(dimension: string, inputs: Record<string, unknown>): { score: number; reasoning: string };
}

/** No-op federated cognition enricher for future cross-mesh cognitive federation. */
export class NoOpFederatedCognitionEnricher {
  readonly isNoOp = true as const;
  readonly enricherId = 'noop-federated-cognition';
  readonly governanceNote = 'Federated cognition enrichment requires multi-mesh explainability audit.';
}
