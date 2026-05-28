import { randomUUID } from 'crypto';
import type {
  ReliabilityOverlayType,
  ReliabilityOverlayIndicator,
  ReliabilityGraphOverlay,
  ReliabilityOverlayInput,
  ICognitiveReliabilityGraphOverlayBuilder,
} from './contracts/reliability-graph-overlay.contracts';

const GOVERNANCE_NOTE = 'Advisory only — reliability overlays are additive badges; graph structure is never modified.';

function overlayTypeForMemory(memoryType: string): ReliabilityOverlayType {
  if (memoryType === 'retry-pattern') return 'retry-evolution-trail';
  if (memoryType === 'dependency-failure') return 'dependency-reliability';
  if (memoryType === 'sla-breach') return 'sla-optimization-signal';
  if (memoryType === 'remediation-outcome') return 'remediation-reasoning';
  if (memoryType === 'stabilization-event') return 'stabilization-history';
  return 'resilience-cognition';
}

function trendForScore(score: number): 'improving' | 'stable' | 'degrading' {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

export class ReliabilityGraphOverlayBuilder implements ICognitiveReliabilityGraphOverlayBuilder {
  build(collectionId: string, input: ReliabilityOverlayInput): ReliabilityGraphOverlay {
    const indicators: ReliabilityOverlayIndicator[] = [];

    for (const r of input.memoryRecords ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: r.stepId,
        overlayType: overlayTypeForMemory(r.memoryType),
        resilienceScore: r.confidence,
        reliabilityTrend: trendForScore(r.confidence),
        reasoningSummary: r.signal,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const t of input.explainabilityTrails ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: t.stepId,
        overlayType: 'resilience-cognition',
        resilienceScore: t.confidence,
        reliabilityTrend: trendForScore(t.confidence),
        reasoningSummary: `Explainability dimension: ${t.dimension}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const p of input.optimizationProposals ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: p.stepId,
        overlayType: 'sla-optimization-signal',
        resilienceScore: p.confidence,
        reliabilityTrend: trendForScore(p.confidence),
        reasoningSummary: `Optimization domain: ${p.domain}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const a of input.antiPatterns ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: a.stepId,
        overlayType: 'remediation-reasoning',
        resilienceScore: a.confidence,
        reliabilityTrend: 'degrading',
        reasoningSummary: `Anti-pattern severity: ${a.severity}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    const overallResilienceScore =
      indicators.length === 0
        ? 100
        : Math.round(indicators.reduce((s, i) => s + i.resilienceScore, 0) / indicators.length);

    const fabricHealthScore =
      indicators.length === 0
        ? 100
        : Math.round(
            indicators.filter(i => i.reliabilityTrend !== 'degrading').length / indicators.length * 100,
          );

    return {
      collectionId,
      indicators,
      overallResilienceScore,
      totalExplainableSignals: indicators.length,
      fabricHealthScore,
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalReliabilityGraphOverlayBuilder = new ReliabilityGraphOverlayBuilder();
