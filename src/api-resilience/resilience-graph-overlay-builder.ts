import { randomUUID } from 'crypto';
import type {
  ResilienceOverlayType,
  ResilienceOverlayIndicator,
  ResilienceGraphOverlay,
  ResilienceOverlayInput,
  IResilienceGraphOverlayBuilder,
} from './contracts/resilience-graph-overlay.contracts';

const GOVERNANCE_NOTE = 'Advisory only — resilience overlays are additive indicators; graph structure and execution semantics are never modified.';

function overlayTypeForMemoryType(memoryType: string): ResilienceOverlayType {
  if (memoryType === 'failover-event') return 'failover-reasoning-trail';
  if (memoryType === 'replay-continuity') return 'continuity-evolution-trail';
  if (memoryType === 'worker-recovery') return 'recovery-overlay';
  if (memoryType === 'queue-recovery') return 'recovery-overlay';
  if (memoryType === 'outage-pattern') return 'outage-pattern-signal';
  return 'regional-orchestration';
}

function overlayTypeForDimension(dimension: string): ResilienceOverlayType {
  if (dimension === 'orchestration-continuity') return 'regional-orchestration';
  if (dimension === 'replay-safety') return 'continuity-evolution-trail';
  if (dimension === 'dependency-resilience') return 'dependency-survivability';
  if (dimension === 'regional-isolation') return 'regional-orchestration';
  return 'failover-reasoning-trail';
}

function trendForScore(score: number): 'improving' | 'stable' | 'degrading' {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

export class ResilienceGraphOverlayBuilder implements IResilienceGraphOverlayBuilder {
  build(collectionId: string, input: ResilienceOverlayInput): ResilienceGraphOverlay {
    const indicators: ResilienceOverlayIndicator[] = [];

    for (const f of input.failoverRecords ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: f.stepId,
        overlayType: 'failover-reasoning-trail',
        survivabilityScore: f.confidence,
        resilienceTrend: trendForScore(f.confidence),
        continuitySummary: `Failover trigger: ${f.triggerReason}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const m of input.continuityMemory ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: m.stepId,
        overlayType: overlayTypeForMemoryType(m.memoryType),
        survivabilityScore: m.confidence,
        resilienceTrend: trendForScore(m.confidence),
        continuitySummary: m.signal,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const s of input.survivabilityScores ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: s.stepId,
        overlayType: overlayTypeForDimension(s.dimension),
        survivabilityScore: s.score,
        resilienceTrend: trendForScore(s.score),
        continuitySummary: `Survivability dimension: ${s.dimension}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const o of input.outagePatterns ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: o.stepId,
        overlayType: 'outage-pattern-signal',
        survivabilityScore: o.confidence,
        resilienceTrend: 'degrading',
        continuitySummary: `Outage pattern severity: ${o.severity}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    const overallSurvivabilityScore =
      indicators.length === 0
        ? 100
        : Math.round(indicators.reduce((s, i) => s + i.survivabilityScore, 0) / indicators.length);

    const continuityHealthScore =
      indicators.length === 0
        ? 100
        : Math.round(
            indicators.filter(i => i.resilienceTrend !== 'degrading').length / indicators.length * 100,
          );

    return {
      collectionId,
      indicators,
      overallSurvivabilityScore,
      totalExplainableSignals: indicators.length,
      continuityHealthScore,
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalResilienceGraphOverlayBuilder = new ResilienceGraphOverlayBuilder();
