export type ResilienceOverlayType =
  | 'regional-orchestration'
  | 'failover-reasoning-trail'
  | 'dependency-survivability'
  | 'recovery-overlay'
  | 'continuity-evolution-trail'
  | 'outage-pattern-signal';

export interface ResilienceOverlayIndicator {
  indicatorId: string;
  stepId: string;
  overlayType: ResilienceOverlayType;
  survivabilityScore: number;
  resilienceTrend: 'improving' | 'stable' | 'degrading';
  continuitySummary: string;
  isExplainable: true;
  governanceNote: string;
}

export interface ResilienceGraphOverlay {
  collectionId: string;
  indicators: ResilienceOverlayIndicator[];
  overallSurvivabilityScore: number;
  totalExplainableSignals: number;
  continuityHealthScore: number;
  governanceNote: string;
}

export interface ResilienceOverlayInput {
  failoverRecords?: Array<{ stepId: string; triggerReason: string; confidence: number }>;
  continuityMemory?: Array<{ stepId: string; memoryType: string; confidence: number; signal: string }>;
  survivabilityScores?: Array<{ stepId: string; dimension: string; score: number }>;
  outagePatterns?: Array<{ stepId: string; severity: string; confidence: number }>;
}

export class NoOpGlobalContinuityMesh {
  assessContinuity(_orgId: string): void { /* advisory no-op */ }
}

export class NoOpAdaptiveRecoveryFabric {
  evolveRecovery(_collectionId: string): void { /* advisory no-op */ }
}

export interface IResilienceGraphOverlayBuilder {
  build(collectionId: string, input: ResilienceOverlayInput): ResilienceGraphOverlay;
}
