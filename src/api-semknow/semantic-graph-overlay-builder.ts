import { randomUUID } from 'crypto';
import type {
  SemanticOverlayType,
  SemanticOverlayIndicator,
  SemanticGraphOverlay,
  SemanticOverlayInput,
  ISemanticGraphOverlayBuilder,
} from './contracts/semantic-graph-overlay.contracts';

const GOVERNANCE_NOTE = 'Advisory only — semantic overlays are additive indicators; graph structure and execution semantics are never modified.';

function overlayTypeForNodeType(nodeType: string): SemanticOverlayType {
  if (nodeType === 'orchestration-step') return 'orchestration-semantic';
  if (nodeType === 'dependency') return 'dependency-semantic';
  if (nodeType === 'retry-pattern') return 'retry-semantic-cluster';
  if (nodeType === 'remediation-action') return 'remediation-semantic';
  if (nodeType === 'sla-constraint') return 'operational-intent';
  return 'semantic-evolution-trail';
}

function overlayTypeForCategory(category: string): SemanticOverlayType {
  if (category === 'dependency-semantic') return 'dependency-semantic';
  if (category === 'retry-semantic') return 'retry-semantic-cluster';
  if (category === 'remediation-cluster') return 'remediation-semantic';
  if (category === 'orchestration-intent') return 'operational-intent';
  if (category === 'sla-semantic') return 'semantic-evolution-trail';
  return 'orchestration-semantic';
}

function trendForScore(score: number): 'improving' | 'stable' | 'degrading' {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

export class SemanticGraphOverlayBuilder implements ISemanticGraphOverlayBuilder {
  build(collectionId: string, input: SemanticOverlayInput): SemanticGraphOverlay {
    const indicators: SemanticOverlayIndicator[] = [];

    for (const n of input.knowledgeNodes ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: n.stepId,
        overlayType: overlayTypeForNodeType(n.nodeType),
        semanticScore: n.confidence,
        semanticTrend: trendForScore(n.confidence),
        semanticSummary: n.label,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const c of input.replayCorrelations ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: c.stepId,
        overlayType: overlayTypeForCategory(c.category),
        semanticScore: c.confidence,
        semanticTrend: trendForScore(c.confidence),
        semanticSummary: `Replay semantic category: ${c.category}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const t of input.reasoningTrails ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: t.stepId,
        overlayType: 'semantic-evolution-trail',
        semanticScore: t.confidence,
        semanticTrend: trendForScore(t.confidence),
        semanticSummary: `Contextual reasoning dimension: ${t.dimension}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const a of input.antiPatterns ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: a.stepId,
        overlayType: 'remediation-semantic',
        semanticScore: a.confidence,
        semanticTrend: 'degrading',
        semanticSummary: `Semantic anti-pattern severity: ${a.severity}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    const overallSemanticScore =
      indicators.length === 0
        ? 100
        : Math.round(indicators.reduce((s, i) => s + i.semanticScore, 0) / indicators.length);

    const semanticHealthScore =
      indicators.length === 0
        ? 100
        : Math.round(
            indicators.filter(i => i.semanticTrend !== 'degrading').length / indicators.length * 100,
          );

    return {
      collectionId,
      indicators,
      overallSemanticScore,
      totalExplainableSignals: indicators.length,
      semanticHealthScore,
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalSemanticGraphOverlayBuilder = new SemanticGraphOverlayBuilder();
