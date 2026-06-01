import type { GovernanceAutomationDecision } from './governance-automation.contracts';
import type { ComplianceEvaluationResult } from './compliance-intelligence.contracts';
import type { GovernanceMemoryRecord } from './federated-governance-memory.contracts';

export interface IGovernanceEnricher {
  pluginId: string;
  onDecisionRecorded?(decision: GovernanceAutomationDecision): void;
}

export interface IReplayCompliancePlugin {
  pluginId: string;
  enrichComplianceEvaluation?(result: ComplianceEvaluationResult): Record<string, unknown>;
  isExplainable: true;
}

export interface IPolicyAutomationAdapter {
  pluginId: string;
  onRuleRegistered?(ruleId: string, scope: string): void;
  onComplianceViolationDetected?(collectionId: string, ruleId: string): void;
}

export interface IOrchestrationTrustScoringPlugin {
  pluginId: string;
  contributeTrustScore?(dimension: string, collectionId: string): number | null;
}

export interface IFederatedGovernanceIntelligenceEnricher {
  pluginId: string;
  onMemoryRecordAdded?(record: GovernanceMemoryRecord): void;
}

export class NoOpFederatedGovernanceEnricher
  implements IGovernanceEnricher, IPolicyAutomationAdapter, IOrchestrationTrustScoringPlugin {
  pluginId = 'noop-federated-governance-enricher';
}
