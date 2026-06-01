export type ReliabilityOverlayType =
  | 'resilience-cognition'
  | 'stabilization-history'
  | 'retry-evolution-trail'
  | 'dependency-reliability'
  | 'sla-optimization-signal'
  | 'remediation-reasoning';

export interface ReliabilityOverlayIndicator {
  indicatorId: string;
  stepId: string;
  overlayType: ReliabilityOverlayType;
  resilienceScore: number;
  reliabilityTrend: 'improving' | 'stable' | 'degrading';
  reasoningSummary: string;
  isExplainable: true;
  governanceNote: string;
}

export interface ReliabilityGraphOverlay {
  collectionId: string;
  indicators: ReliabilityOverlayIndicator[];
  overallResilienceScore: number;
  totalExplainableSignals: number;
  fabricHealthScore: number;
  governanceNote: string;
}

export interface ReliabilityOverlayInput {
  memoryRecords?: Array<{ stepId: string; memoryType: string; confidence: number; signal: string }>;
  explainabilityTrails?: Array<{ stepId: string; dimension: string; confidence: number }>;
  optimizationProposals?: Array<{ stepId: string; domain: string; confidence: number }>;
  antiPatterns?: Array<{ stepId: string; severity: string; confidence: number }>;
}

export class NoOpResilienceOptimizationFabric {
  optimizeResilience(_collectionId: string): void { /* advisory no-op */ }
}

export class NoOpOperationalReliabilityPlatform {
  assessFabric(_orgId: string): void { /* advisory no-op */ }
}

export interface ICognitiveReliabilityGraphOverlayBuilder {
  build(collectionId: string, input: ReliabilityOverlayInput): ReliabilityGraphOverlay;
}
