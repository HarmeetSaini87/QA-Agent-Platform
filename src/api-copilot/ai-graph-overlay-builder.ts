// src/api-copilot/ai-graph-overlay-builder.ts
// Phase E Step 10: AI graph overlay builder. Additive indicators only — graph never mutated.

import {
  AiGraphOverlay,
  AiOverlayIndicatorType,
  DependencyRiskOverlay,
  IAiGraphOverlayBuilder,
  PredictiveInstabilityIndicator,
} from './contracts/ai-graph-overlay.contracts';

const ADVISORY_NOTE =
  'All indicators are advisory only. Graph structure and execution runtime are never modified.';

export class AiGraphOverlayBuilder implements IAiGraphOverlayBuilder {
  build(
    collectionId: string,
    context: {
      flakinessForecast?: { stepId: string; score: number; confidence: number }[];
      retryHotspots?: { stepId: string; retryRate: number }[];
      rcaCorrelations?: { stepId: string; confidence: number; hypothesis: string }[];
      dependencyEdges?: { from: string; to: string }[];
    }
  ): AiGraphOverlay {
    const indicators: PredictiveInstabilityIndicator[] = [];

    for (const f of context.flakinessForecast ?? []) {
      indicators.push({
        nodeId: f.stepId,
        indicatorType: 'predicted-flakiness' as AiOverlayIndicatorType,
        score: f.score,
        confidence: f.confidence,
        label: `Predicted flakiness: ${f.score}`,
        advisoryNote: ADVISORY_NOTE,
        evidenceRefs: [],
      });
    }

    for (const r of context.retryHotspots ?? []) {
      indicators.push({
        nodeId: r.stepId,
        indicatorType: 'retry-storm-risk' as AiOverlayIndicatorType,
        score: Math.round(r.retryRate * 100),
        confidence: 70,
        label: `Retry rate: ${(r.retryRate * 100).toFixed(0)}%`,
        advisoryNote: ADVISORY_NOTE,
        evidenceRefs: [],
      });
    }

    for (const c of context.rcaCorrelations ?? []) {
      indicators.push({
        nodeId: c.stepId,
        indicatorType: 'rca-hotspot' as AiOverlayIndicatorType,
        score: c.confidence,
        confidence: c.confidence,
        label: c.hypothesis.slice(0, 80),
        advisoryNote: ADVISORY_NOTE,
        evidenceRefs: [],
      });
    }

    const riskEdges = (context.dependencyEdges ?? []).map((e) => ({
      fromStepId: e.from,
      toStepId: e.to,
      riskScore: 30,
      riskReason: 'Dependency chain — inspect for cascading failures.',
    }));

    const dependencyRisk: DependencyRiskOverlay = {
      collectionId,
      riskEdges,
      generatedAt: new Date().toISOString(),
    };

    return {
      collectionId,
      indicators,
      dependencyRisk,
      generatedAt: new Date().toISOString(),
      advisoryNote: ADVISORY_NOTE,
    };
  }
}

export const globalAiGraphOverlayBuilder = new AiGraphOverlayBuilder();
