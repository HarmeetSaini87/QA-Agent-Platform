// src/api-mesh/adaptive-graph-overlay-builder.ts
// Phase E Step 13: Adaptive mesh graph overlay builder. Additive indicators — graph never mutated.

import {
  AdaptiveMeshGraphOverlay,
  AdaptiveMeshOverlayIndicator,
  AdaptiveMeshOverlayType,
  IAdaptiveMeshGraphOverlayBuilder,
} from './contracts/adaptive-graph-overlay.contracts';

const GOVERNANCE_NOTE =
  'All adaptive mesh indicators are advisory. Graph structure and execution runtime are never modified.';

export class AdaptiveMeshGraphOverlayBuilder implements IAdaptiveMeshGraphOverlayBuilder {
  build(
    collectionId: string,
    input: {
      knowledgeEntries?: Array<{ stepId: string; memoryType: string; score: number }>;
      reliabilityScores?: Array<{ stepId: string; score: number; trend: 'improving' | 'stable' | 'degrading' }>;
      antiPatternAlerts?: Array<{ stepId: string; severity: string; patternKey: string }>;
    }
  ): AdaptiveMeshGraphOverlay {
    const indicators: AdaptiveMeshOverlayIndicator[] = [];

    for (const k of input.knowledgeEntries ?? []) {
      const overlayType: AdaptiveMeshOverlayType =
        k.memoryType === 'retry-optimization' ? 'replay-optimization-trail'
        : k.memoryType === 'dependency-instability' ? 'dependency-learning'
        : 'orchestration-memory';
      indicators.push({
        nodeId: k.stepId,
        overlayType,
        label: `${k.memoryType} memory (score: ${k.score})`,
        memoryScore: k.score,
        reliabilityTrend: k.score >= 75 ? 'improving' : k.score >= 50 ? 'stable' : 'degrading',
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    for (const r of input.reliabilityScores ?? []) {
      indicators.push({
        nodeId: r.stepId,
        overlayType: 'reliability-trend',
        label: `Reliability: ${r.score} (${r.trend})`,
        memoryScore: r.score,
        reliabilityTrend: r.trend,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    for (const a of input.antiPatternAlerts ?? []) {
      const memoryScore = a.severity === 'critical' ? 90
        : a.severity === 'high' ? 70
        : a.severity === 'medium' ? 50 : 30;
      indicators.push({
        nodeId: a.stepId,
        overlayType: 'anti-pattern-alert',
        label: `Anti-pattern: ${a.patternKey} [${a.severity}]`,
        memoryScore,
        reliabilityTrend: 'degrading',
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    const meshHealthScore = indicators.length > 0
      ? Math.round(indicators.reduce((s, i) => s + i.memoryScore, 0) / indicators.length)
      : 100;

    return {
      collectionId,
      indicators,
      meshHealthScore: Math.min(100, meshHealthScore),
      totalMemorySignals: indicators.length,
      generatedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalAdaptiveMeshGraphOverlayBuilder = new AdaptiveMeshGraphOverlayBuilder();
