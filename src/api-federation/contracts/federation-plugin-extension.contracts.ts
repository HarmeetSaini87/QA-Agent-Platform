// src/api-federation/contracts/federation-plugin-extension.contracts.ts
// Phase E Step 12: Federation plugin/SDK extensibility stubs. No unsafe runtime mutation.

/** Stub — federated orchestration plugins must declare read/advisory-only output. */
export interface IFederatedOrchestrationPlugin {
  readonly pluginId: string;
  readonly isAdvisoryOnly: true;
  enrichFederationSnapshot(
    orgId: string,
    snapshot: Record<string, unknown>
  ): Record<string, unknown>;
}

/** Stub — enterprise federation adapter for external org registry integration. */
export interface IEnterpriseFederationAdapter {
  readonly adapterId: string;
  syncNodes(orgId: string): Promise<{ synced: number; errors: string[] }>;
  pushIntelligence(bundle: Record<string, unknown>): Promise<{ accepted: boolean }>;
}

/** Stub — replay intelligence federation enricher reads patterns; never writes replay store. */
export interface IReplayFederationEnricher {
  readonly enricherId: string;
  readonly isReadOnly: true;
  enrichPatterns(
    orgId: string,
    patterns: Record<string, unknown>[]
  ): Record<string, unknown>[];
}

/** Stub — cross-org analytics plugin for future marketplace federation. */
export interface ICrossOrgAnalyticsPlugin {
  readonly pluginId: string;
  analyzeSharedInsights(
    bundles: Record<string, unknown>[]
  ): { signal: string; confidence: number }[];
}

/** No-op federated governance adapter — wire external policy stores in future phases. */
export class NoOpFederatedGovernanceAdapter {
  readonly isNoOp = true as const;
  readonly adapterId = 'noop-federated-governance';
  readonly governanceNote = 'Federated governance adapter requires multi-org trust establishment.';
}
