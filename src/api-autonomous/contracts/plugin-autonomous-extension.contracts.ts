// src/api-autonomous/contracts/plugin-autonomous-extension.contracts.ts
// Phase E Step 11: Plugin/SDK autonomous extensibility stubs. No unsafe runtime mutation.

/** Stub — custom remediation engines must declare advisory-only output. */
export interface ICustomRemediationEnginePlugin {
  readonly pluginId: string;
  readonly isAdvisoryOnly: true;
  analyzeAndPropose(
    collectionId: string,
    context: Record<string, unknown>
  ): { proposedChanges: Record<string, unknown>; confidence: number; rationale: string };
}

/** Stub — enterprise stabilization plugins enrich overlays only; never mutate orchestration. */
export interface IEnterpriseStabilizationPlugin {
  readonly pluginId: string;
  readonly isAdvisoryOnly: true;
  enrichStabilizationInsight(
    collectionId: string,
    baseInsight: Record<string, unknown>
  ): Record<string, unknown>;
}

/** Stub — adaptive orchestration enrichers annotate, never reorder execution. */
export interface IAdaptiveOrchestrationEnricher {
  readonly pluginId: string;
  enrich(collectionId: string, snapshot: Record<string, unknown>): Record<string, unknown>;
}

/** Stub — replay intelligence adapters read replay data; never write to replay store. */
export interface IReplayIntelligenceAdapter {
  readonly pluginId: string;
  readonly isReadOnly: true;
  extractSignals(runId: string, replaySnapshot: Record<string, unknown>): string[];
}

/** No-op policy-aware automation plugin for future marketplace integration. */
export class NoOpPolicyAwareAutomationPlugin {
  readonly isNoOp = true as const;
  readonly pluginId = 'noop-policy-automation';
  readonly governanceNote = 'Requires explicit policy approval and RBAC role before activation.';
}
