import type { RegionalOrchestrationNode } from './multi-region-resilience.contracts';
import type { DisasterRecoveryPlan } from './disaster-recovery-orchestration.contracts';
import type { ContinuityMemoryRecord } from './federated-continuity-memory.contracts';

export interface IResilienceEnricher {
  pluginId: string;
  onNodeRegistered?(node: RegionalOrchestrationNode): void;
  onNodeDegraded?(nodeId: string, regionId: string): void;
}

export interface IReplayContinuityPlugin {
  pluginId: string;
  onRecoveryPlanCreated?(plan: DisasterRecoveryPlan): void;
  isExplainable: true;
}

export interface IDisasterRecoveryAdapter {
  pluginId: string;
  onPlanApproved?(planId: string): void;
  onPlanRejected?(planId: string, reason: string): void;
}

export interface ISurvivabilityScoringPlugin {
  pluginId: string;
  contributeSurvivabilityScore?(dimension: string, collectionId: string): number | null;
}

export interface IFederatedResilienceIntelligenceEnricher {
  pluginId: string;
  onContinuityRecordAdded?(record: ContinuityMemoryRecord): void;
}

export class NoOpFederatedResilienceEnricher
  implements IResilienceEnricher, IDisasterRecoveryAdapter, ISurvivabilityScoringPlugin {
  pluginId = 'noop-federated-resilience-enricher';
}
