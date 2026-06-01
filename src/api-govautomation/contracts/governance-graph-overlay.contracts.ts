export type GovernanceOverlayType =
  | 'policy-orchestration'
  | 'compliance-reasoning-trail'
  | 'dependency-compliance'
  | 'trust-overlay'
  | 'governance-evolution-trail'
  | 'audit-signal';

export interface GovernanceOverlayIndicator {
  indicatorId: string;
  stepId: string;
  overlayType: GovernanceOverlayType;
  complianceScore: number;
  governanceTrend: 'improving' | 'stable' | 'degrading';
  trustSummary: string;
  isExplainable: true;
  governanceNote: string;
}

export interface GovernanceGraphOverlay {
  collectionId: string;
  indicators: GovernanceOverlayIndicator[];
  overallComplianceScore: number;
  totalExplainableSignals: number;
  trustHealthScore: number;
  governanceNote: string;
}

export interface GovernanceOverlayInput {
  automationDecisions?: Array<{ stepId: string; scope: string; complianceScore: number; status: string }>;
  complianceEvaluations?: Array<{ stepId: string; dimension: string; score: number }>;
  governanceMemory?: Array<{ stepId: string; memoryType: string; confidence: number; signal: string }>;
  antiPatterns?: Array<{ stepId: string; severity: string; confidence: number }>;
}

export class NoOpEnterpriseComplianceFabric {
  assessCompliance(_orgId: string): void { /* advisory no-op */ }
}

export class NoOpGlobalTrustOrchestrationMesh {
  assessTrust(_orgId: string): void { /* advisory no-op */ }
}

export interface IGovernanceGraphOverlayBuilder {
  build(collectionId: string, input: GovernanceOverlayInput): GovernanceGraphOverlay;
}
