// src/api-mesh/contracts/adaptive-reliability.contracts.ts
// Phase E Step 13: Adaptive reliability intelligence contracts. Advisory scoring — never mutates runtime.

export type ReliabilityDimension =
  | 'orchestration-stability'
  | 'retry-effectiveness'
  | 'sla-compliance'
  | 'dependency-health'
  | 'environment-stability'
  | 'remediation-velocity';

export interface ReliabilityDimensionScore {
  readonly dimension: ReliabilityDimension;
  readonly score: number;          // 0–100
  readonly trend: 'improving' | 'stable' | 'degrading';
  readonly confidence: number;     // 0–100
  readonly advisoryNote: string;
}

export interface ReliabilityScore {
  readonly collectionId: string;
  readonly compositeScore: number;        // 0–100 weighted average
  readonly dimensions: readonly ReliabilityDimensionScore[];
  readonly scoredAt: string;
  readonly governanceNote: string;
}

export interface PredictiveReliabilityForecast {
  readonly collectionId: string;
  readonly forecastWindowHours: number;
  readonly predictedCompositeScore: number;
  readonly riskFactors: readonly string[];
  readonly improvementOpportunities: readonly string[];
  readonly confidence: number;
  readonly forecastedAt: string;
  readonly advisoryNote: string;
}

export interface SlaReliabilityIntelligence {
  readonly collectionId: string;
  readonly slaMetric: string;
  readonly currentReliabilityScore: number;
  readonly slaAlignmentScore: number;     // 0–100: how well current state maps to SLA
  readonly breachRiskScore: number;       // 0–100
  readonly adaptationHints: readonly string[];
  readonly generatedAt: string;
}

export interface IAdaptiveReliabilityIntelligence {
  scoreReliability(
    collectionId: string,
    inputs: Partial<Record<ReliabilityDimension, number>>
  ): ReliabilityScore;
  forecastReliability(
    collectionId: string,
    currentScore: ReliabilityScore,
    forecastWindowHours: number
  ): PredictiveReliabilityForecast;
  assessSlaAlignment(
    collectionId: string,
    slaMetric: string,
    currentScore: number,
    slaTarget: number
  ): SlaReliabilityIntelligence;
}
