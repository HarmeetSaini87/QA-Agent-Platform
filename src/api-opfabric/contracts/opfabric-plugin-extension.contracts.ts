import type { OperationalIntelligencePropagation } from './operational-intelligence-governance.contracts';
import type { ReplayOperationalMemoryEntry } from './replay-operational-memory-federation.contracts';
import type { FederationOptimizationProposal } from './governed-adaptive-federation.contracts';

export interface IOperationalFederationEnricher {
  pluginId: string;
  onPropagationPublished?(propagation: OperationalIntelligencePropagation): void;
}

export interface IReplayExplainabilityFederationPlugin {
  pluginId: string;
  enrichMemoryEntry?(entry: ReplayOperationalMemoryEntry): Record<string, unknown>;
  isExplainable: true;
}

export interface IAdaptiveStabilizationFederationAdapter {
  pluginId: string;
  onProposalCreated?(proposal: FederationOptimizationProposal): void;
  onProposalPropagated?(proposalId: string): void;
}

export interface IOrchestrationResilienceFederationScoringPlugin {
  pluginId: string;
  contributeFederationScore?(domain: string, collectionId: string): number | null;
}

export interface IFederatedOperationalIntelligenceEnricher {
  pluginId: string;
  enrichIntelligenceSignal?(category: string, orgId: string): Record<string, unknown> | null;
}

export class NoOpFederatedOperationalEnricher
  implements IOperationalFederationEnricher,
    IAdaptiveStabilizationFederationAdapter,
    IOrchestrationResilienceFederationScoringPlugin {
  pluginId = 'noop-federated-operational-enricher';
}
