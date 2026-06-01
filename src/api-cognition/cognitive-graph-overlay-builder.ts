// src/api-cognition/cognitive-graph-overlay-builder.ts
// Phase E Step 14: Cognitive graph overlay builder. Explainable, additive indicators — graph never mutated.

import {
  CognitiveGraphOverlay,
  CognitiveOverlayIndicator,
  CognitiveOverlayType,
  ICognitiveGraphOverlayBuilder,
} from './contracts/cognitive-graph-overlay.contracts';

const GOVERNANCE_NOTE =
  'All cognitive overlay indicators are explainable and advisory. Graph structure and runtime are never modified.';

export class CognitiveGraphOverlayBuilder implements ICognitiveGraphOverlayBuilder {
  build(
    collectionId: string,
    input: {
      cognitionRecords?: Array<{ stepId: string; memoryType: string; confidence: number; signal: string }>;
      reasoningTrails?: Array<{ stepId: string; conclusion: string; confidence: number }>;
      optimizationProposals?: Array<{ stepId: string; domain: string; confidence: number }>;
    }
  ): CognitiveGraphOverlay {
    const indicators: CognitiveOverlayIndicator[] = [];

    for (const r of input.cognitionRecords ?? []) {
      const overlayType: CognitiveOverlayType =
        r.memoryType === 'reliability-cognition' ? 'reliability-cognition'
        : r.memoryType === 'remediation-trail' ? 'stabilization-history'
        : 'cognition-memory';
      indicators.push({
        nodeId: r.stepId,
        overlayType,
        label: `${r.memoryType} (conf: ${r.confidence})`,
        cognitionScore: r.confidence,
        reasoningSummary: r.signal.slice(0, 80),
        isExplainable: true,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    for (const t of input.reasoningTrails ?? []) {
      indicators.push({
        nodeId: t.stepId,
        overlayType: 'reasoning-trail',
        label: `Reasoning trail (conf: ${t.confidence})`,
        cognitionScore: t.confidence,
        reasoningSummary: t.conclusion.slice(0, 80),
        isExplainable: true,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    for (const opt of input.optimizationProposals ?? []) {
      indicators.push({
        nodeId: opt.stepId,
        overlayType: 'optimization-cognition',
        label: `Optimization: ${opt.domain} (conf: ${opt.confidence})`,
        cognitionScore: opt.confidence,
        reasoningSummary: `Self-optimization proposal for ${opt.domain}.`,
        isExplainable: true,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    const overallScore = indicators.length > 0
      ? Math.round(indicators.reduce((s, i) => s + i.cognitionScore, 0) / indicators.length)
      : 100;

    return {
      collectionId,
      indicators,
      overallCognitionScore: Math.min(100, overallScore),
      totalExplainableSignals: indicators.length,
      generatedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalCognitiveGraphOverlayBuilder = new CognitiveGraphOverlayBuilder();
