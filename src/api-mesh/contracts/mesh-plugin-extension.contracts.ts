// src/api-mesh/contracts/mesh-plugin-extension.contracts.ts
// Phase E Step 13: Mesh plugin/SDK extensibility stubs. Advisory-only — no unsafe runtime mutation.

/** Stub — operational intelligence plugins enrich mesh signals; never mutate orchestration. */
export interface IOperationalIntelligencePlugin {
  readonly pluginId: string;
  readonly isAdvisoryOnly: true;
  enrichSignal(
    signalType: string,
    payload: Record<string, unknown>
  ): Record<string, unknown>;
}

/** Stub — adaptive orchestration enricher adds annotations; never reorders execution. */
export interface IAdaptiveOrchestrationMeshEnricher {
  readonly enricherId: string;
  enrich(collectionId: string, meshSummary: Record<string, unknown>): Record<string, unknown>;
}

/** Stub — replay knowledge adapter reads fabric; never writes replay store. */
export interface IReplayKnowledgeAdapter {
  readonly adapterId: string;
  readonly isReadOnly: true;
  extractKnowledge(
    collectionId: string,
    memoryIndex: Record<string, unknown>
  ): { signal: string; confidence: number }[];
}

/** Stub — reliability scoring plugin adds dimensions; never blocks execution. */
export interface IReliabilityScoringPlugin {
  readonly pluginId: string;
  scoreDimension(
    collectionId: string,
    dimension: string,
    inputs: Record<string, unknown>
  ): { score: number; rationale: string };
}

/** No-op federated learning enricher for future cross-mesh intelligence federation. */
export class NoOpFederatedLearningEnricher {
  readonly isNoOp = true as const;
  readonly enricherId = 'noop-federated-learning';
  readonly governanceNote = 'Federated learning enrichment requires multi-mesh trust and approval-chain.';
}
