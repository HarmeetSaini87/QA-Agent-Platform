export type ComplianceDimension =
  | 'replay-traceability'
  | 'policy-adherence'
  | 'audit-continuity'
  | 'execution-governance'
  | 'remediation-compliance'
  | 'trust-integrity';

export interface ComplianceEvaluationResult {
  evaluationId: string;
  collectionId: string;
  dimension: ComplianceDimension;
  score: number;
  trend: 'improving' | 'stable' | 'degrading';
  evidenceSignals: string[];
  complianceGap: string;
  isExplainable: true;
  evaluatedAt: string;
  governanceNote: string;
}

export interface OrchestrationComplianceScorecard {
  scorecardId: string;
  collectionId: string;
  dimensionScores: ComplianceEvaluationResult[];
  overallComplianceScore: number;
  complianceLevel: 'fully-compliant' | 'substantially-compliant' | 'partially-compliant' | 'non-compliant';
  criticalGaps: string[];
  governanceNote: string;
  scoredAt: string;
}

export interface ExecutionGovernanceScore {
  scoreId: string;
  collectionId: string;
  runId: string;
  governanceScore: number;
  trustIndicators: string[];
  policyViolations: string[];
  isExplainable: true;
  governanceNote: string;
}

export interface EnterpriseTrustIntelligence {
  trustId: string;
  orgId: string;
  trustScore: number;
  trustFactors: string[];
  riskSignals: string[];
  trustLevel: 'high' | 'medium' | 'low' | 'critical';
  isExplainable: true;
  assessedAt: string;
}

export interface IComplianceIntelligenceEngine {
  evaluateDimension(collectionId: string, dimension: ComplianceDimension, signals: string[]): ComplianceEvaluationResult;
  buildScorecard(collectionId: string): OrchestrationComplianceScorecard;
  scoreExecutionGovernance(collectionId: string, runId: string, signals: string[]): ExecutionGovernanceScore;
  assessEnterpriseTrust(orgId: string, collectionIds: string[]): EnterpriseTrustIntelligence;
}
