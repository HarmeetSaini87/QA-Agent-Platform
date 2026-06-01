import type { ExecutionKnowledgeNode } from './execution-knowledge-graph.contracts';
import type { SemanticMemoryRecord } from './federated-semantic-memory.contracts';
import type { ContextualReasoningTrail } from './contextual-operational-reasoning.contracts';

export interface ISemanticEnricher {
  pluginId: string;
  enrichKnowledgeNode?(node: ExecutionKnowledgeNode): Record<string, unknown>;
}

export interface IReplaySemanticPlugin {
  pluginId: string;
  onCorrelationCreated?(correlationId: string, collectionId: string): void;
  isExplainable: true;
}

export interface IContextualReasoningAdapter {
  pluginId: string;
  enrichReasoningTrail?(trail: ContextualReasoningTrail): Record<string, unknown>;
}

export interface IOrchestrationSemanticScoringPlugin {
  pluginId: string;
  contributeSemanticScore?(dimension: string, collectionId: string): number | null;
}

export interface IFederatedSemanticIntelligenceEnricher {
  pluginId: string;
  onMemoryRecordAdded?(record: SemanticMemoryRecord): void;
}

export class NoOpFederatedSemanticEnricher
  implements ISemanticEnricher, IContextualReasoningAdapter, IOrchestrationSemanticScoringPlugin {
  pluginId = 'noop-federated-semantic-enricher';
}
