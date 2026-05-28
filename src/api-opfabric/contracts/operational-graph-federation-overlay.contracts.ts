export type OperationalFederationOverlayType =
  | 'orchestration-federation'
  | 'replay-optimization-reasoning'
  | 'adaptive-stabilization-federation'
  | 'resilience-federation-cognition'
  | 'explainable-governance-trail'
  | 'dependency-federation-intelligence';

export interface OperationalFederationOverlayIndicator {
  indicatorId: string;
  stepId: string;
  overlayType: OperationalFederationOverlayType;
  federationScore: number;
  governanceTrend: 'improving' | 'stable' | 'degrading';
  reasoningSummary: string;
  isExplainable: true;
  governanceNote: string;
}

export interface OperationalFederationGraphOverlay {
  collectionId: string;
  indicators: OperationalFederationOverlayIndicator[];
  overallFederationScore: number;
  totalExplainableSignals: number;
  fabricGovernanceScore: number;
  governanceNote: string;
}

export interface FederationOverlayInput {
  propagations?: Array<{ stepId: string; scope: string; confidence: number }>;
  memoryEntries?: Array<{ stepId: string; federationType: string; confidence: number; signal: string }>;
  federationProposals?: Array<{ stepId: string; domain: string; confidence: number }>;
  antiPatterns?: Array<{ stepId: string; severity: string; confidence: number }>;
}

export class NoOpOperationalFederationRouter {
  routeIntelligence(_orgId: string): void { /* advisory no-op */ }
}

export class NoOpGlobalOperationalGovernanceMesh {
  assessMesh(_orgId: string): void { /* advisory no-op */ }
}

export interface IOperationalFederationGraphOverlayBuilder {
  build(collectionId: string, input: FederationOverlayInput): OperationalFederationGraphOverlay;
}
