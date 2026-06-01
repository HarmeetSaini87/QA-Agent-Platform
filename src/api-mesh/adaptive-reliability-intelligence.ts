// src/api-mesh/adaptive-reliability-intelligence.ts
// Phase E Step 13: Adaptive reliability intelligence. Advisory scoring — never mutates runtime.

import {
  ReliabilityScore,
  ReliabilityDimension,
  ReliabilityDimensionScore,
  PredictiveReliabilityForecast,
  SlaReliabilityIntelligence,
  IAdaptiveReliabilityIntelligence,
} from './contracts/adaptive-reliability.contracts';

const GOVERNANCE_NOTE = 'Reliability scores are advisory. No execution runtime is altered automatically.';
const ADVISORY_NOTE = 'Forecast is probabilistic and advisory only.';

const DIMENSION_WEIGHTS: Record<ReliabilityDimension, number> = {
  'orchestration-stability': 0.25,
  'retry-effectiveness': 0.20,
  'sla-compliance': 0.20,
  'dependency-health': 0.15,
  'environment-stability': 0.10,
  'remediation-velocity': 0.10,
};

function _trend(score: number): 'improving' | 'stable' | 'degrading' {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

export class AdaptiveReliabilityIntelligence implements IAdaptiveReliabilityIntelligence {
  scoreReliability(
    collectionId: string,
    inputs: Partial<Record<ReliabilityDimension, number>>
  ): ReliabilityScore {
    const allDimensions: ReliabilityDimension[] = Object.keys(DIMENSION_WEIGHTS) as ReliabilityDimension[];
    const dimensions: ReliabilityDimensionScore[] = allDimensions.map((dim) => {
      const score = inputs[dim] ?? 70;   // default baseline when not provided
      return {
        dimension: dim,
        score,
        trend: _trend(score),
        confidence: inputs[dim] !== undefined ? 80 : 50,
        advisoryNote: GOVERNANCE_NOTE,
      };
    });

    const composite = Math.round(
      allDimensions.reduce((sum, dim) => {
        const dimScore = dimensions.find((d) => d.dimension === dim)!.score;
        return sum + dimScore * DIMENSION_WEIGHTS[dim];
      }, 0)
    );

    return {
      collectionId,
      compositeScore: composite,
      dimensions,
      scoredAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  forecastReliability(
    collectionId: string,
    currentScore: ReliabilityScore,
    forecastWindowHours: number
  ): PredictiveReliabilityForecast {
    const degradingDims = currentScore.dimensions.filter((d) => d.trend === 'degrading');
    const riskFactors = degradingDims.map((d) => `${d.dimension} is degrading (score: ${d.score})`);
    const improvingDims = currentScore.dimensions.filter((d) => d.trend === 'improving');
    const opportunities = improvingDims.map((d) => `Leverage ${d.dimension} improvement trend`);

    const decayFactor = 1 - degradingDims.length * 0.03;
    const predicted = Math.max(0, Math.round(currentScore.compositeScore * decayFactor));

    return {
      collectionId,
      forecastWindowHours,
      predictedCompositeScore: predicted,
      riskFactors,
      improvementOpportunities: opportunities.length > 0 ? opportunities : ['No immediate improvement opportunities identified'],
      confidence: 65,
      forecastedAt: new Date().toISOString(),
      advisoryNote: ADVISORY_NOTE,
    };
  }

  assessSlaAlignment(
    collectionId: string,
    slaMetric: string,
    currentScore: number,
    slaTarget: number
  ): SlaReliabilityIntelligence {
    const gap = slaTarget - currentScore;
    const alignmentScore = Math.max(0, Math.round(100 - Math.abs(gap)));
    const breachRiskScore = gap > 0 ? Math.min(100, Math.round(gap * 1.5)) : 0;

    const hints: string[] = [];
    if (gap > 20) hints.push('Critical SLA gap — review dependency health and retry policies.');
    else if (gap > 5) hints.push('Moderate SLA gap — inspect environment stability and remediation velocity.');
    else hints.push('SLA target within reach — maintain current reliability trajectory.');

    return {
      collectionId,
      slaMetric,
      currentReliabilityScore: currentScore,
      slaAlignmentScore: alignmentScore,
      breachRiskScore,
      adaptationHints: hints,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const globalAdaptiveReliabilityIntelligence = new AdaptiveReliabilityIntelligence();
