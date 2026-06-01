import type { ReliabilityFabricNode } from './reliability-fabric.contracts';
import type { ReliabilityMemoryRecord } from './federated-reliability-memory.contracts';
import type { ReliabilityOptimizationProposal } from './governed-reliability-optimization.contracts';

export interface IReliabilityFabricPlugin {
  pluginId: string;
  onNodeRegistered?(node: ReliabilityFabricNode): void;
  onNodeDegraded?(nodeId: string): void;
}

export interface IExplainabilityEnricher {
  pluginId: string;
  enrichTrail?(trailId: string, collectionId: string): Record<string, unknown>;
}

export interface IReliabilityOptimizationAdapter {
  pluginId: string;
  onProposalCreated?(proposal: ReliabilityOptimizationProposal): void;
  onProposalApproved?(proposalId: string): void;
}

export interface IResilienceScoringPlugin {
  pluginId: string;
  contributeDimensionScore?(domain: string, collectionId: string): number | null;
}

export interface IReliabilityMemoryAdapter {
  pluginId: string;
  onMemoryRecordAdded?(record: ReliabilityMemoryRecord): void;
  onExpiredEvicted?(count: number): void;
}

export class NoOpFederatedReliabilityEnricher
  implements IReliabilityFabricPlugin, IExplainabilityEnricher, IReliabilityOptimizationAdapter {
  pluginId = 'noop-federated-reliability-enricher';
}
