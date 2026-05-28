export type UnifiedGovernanceOverlayType =
  | 'enterprise-orchestration'
  | 'replay-governance-reasoning-trail'
  | 'dependency-continuity'
  | 'orchestration-trust-overlay'
  | 'unified-operational-evolution-trail'
  | 'platform-consolidation-signal';

export interface UnifiedGovernanceOverlayIndicator {
  indicatorId: string;
  stepId: string;
  overlayType: UnifiedGovernanceOverlayType;
  platformScore: number;
  governanceTrend: 'improving' | 'stable' | 'degrading';
  unificationSummary: string;
  isExplainable: true;
  governanceNote: string;
}

export interface UnifiedGovernanceGraphOverlay {
  collectionId: string;
  indicators: UnifiedGovernanceOverlayIndicator[];
  overallPlatformScore: number;
  totalExplainableSignals: number;
  platformHealthScore: number;
  governanceNote: string;
}

export interface UnifiedGovernanceOverlayInput {
  orchestrationDecisions?: Array<{ stepId: string; scope: string; governanceScore: number; status: string }>;
  consolidationScores?: Array<{ stepId: string; domain: string; unificationScore: number }>;
  enterpriseMemory?: Array<{ stepId: string; memoryType: string; confidence: number; signal: string }>;
  orchestrationAntiPatterns?: Array<{ stepId: string; severity: string; confidence: number }>;
}

export class NoOpEnterpriseOrchestrationCognitionFabric {
  assessCognition(_orgId: string): void { /* advisory no-op */ }
}

export class NoOpGovernedSelfEvolvingQAEcosystem {
  assessEvolution(_orgId: string): void { /* advisory no-op */ }
}

export class NoOpAiAssistedEnterpriseOrchestrationGovernance {
  assessGovernance(_orgId: string): void { /* advisory no-op */ }
}

export interface IUnifiedGovernanceGraphOverlayBuilder {
  build(collectionId: string, input: UnifiedGovernanceOverlayInput): UnifiedGovernanceGraphOverlay;
}
