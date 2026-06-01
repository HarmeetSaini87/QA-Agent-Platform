import type { UnifiedOrchestrationDecision } from './unified-orchestration-governance.contracts';
import type { ConsolidationDomainScore } from './enterprise-operational-consolidation.contracts';
import type { EnterpriseMemoryRecord } from './federated-enterprise-memory.contracts';

export interface IEnterpriseOrchestrationEnricher {
  pluginId: string;
  onDecisionRecorded?(decision: UnifiedOrchestrationDecision): void;
}

export interface IReplayOperationalPlugin {
  pluginId: string;
  enrichConsolidationScore?(score: ConsolidationDomainScore): Record<string, unknown>;
  isExplainable: true;
}

export interface IGovernanceFederationAdapter {
  pluginId: string;
  onRuleRegistered?(ruleId: string, scope: string): void;
  onNonGovernedDecisionDetected?(collectionId: string, ruleId: string): void;
}

export interface IOrchestrationTrustScoringPlugin {
  pluginId: string;
  contributeTrustScore?(dimension: string, collectionId: string): number | null;
}

export interface IFederatedEnterpriseIntelligenceEnricher {
  pluginId: string;
  onMemoryRecordAdded?(record: EnterpriseMemoryRecord): void;
}

export class NoOpUnifiedEnterpriseOrchestrationEnricher
  implements IEnterpriseOrchestrationEnricher, IGovernanceFederationAdapter, IOrchestrationTrustScoringPlugin {
  pluginId = 'noop-unified-enterprise-orchestration-enricher';
}
