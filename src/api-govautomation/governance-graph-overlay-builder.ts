import { randomUUID } from 'crypto';
import type {
  GovernanceOverlayType, GovernanceOverlayIndicator, GovernanceGraphOverlay,
  GovernanceOverlayInput, IGovernanceGraphOverlayBuilder
} from './contracts/governance-graph-overlay.contracts';

const GOVERNANCE_NOTE = 'Governance graph overlay — advisory only, additive badges, graph never mutated.';

function trendForScore(score: number): GovernanceOverlayIndicator['governanceTrend'] {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

function overlayTypeForScope(scope: string): GovernanceOverlayType {
  if (scope.includes('replay')) return 'compliance-reasoning-trail';
  if (scope.includes('audit')) return 'audit-signal';
  if (scope.includes('trust')) return 'trust-overlay';
  if (scope.includes('retention')) return 'governance-evolution-trail';
  if (scope.includes('dependency')) return 'dependency-compliance';
  return 'policy-orchestration';
}

function overlayTypeForDimension(dimension: string): GovernanceOverlayType {
  if (dimension.includes('audit')) return 'audit-signal';
  if (dimension.includes('trust')) return 'trust-overlay';
  if (dimension.includes('dependency')) return 'dependency-compliance';
  if (dimension.includes('retry')) return 'compliance-reasoning-trail';
  if (dimension.includes('anomaly')) return 'governance-evolution-trail';
  return 'policy-orchestration';
}

export class GovernanceGraphOverlayBuilder implements IGovernanceGraphOverlayBuilder {
  _reset(): void { /* stateless */ }

  build(collectionId: string, input: GovernanceOverlayInput): GovernanceGraphOverlay {
    const indicators: GovernanceOverlayIndicator[] = [];

    (input.automationDecisions ?? []).forEach(d => {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: d.stepId,
        overlayType: overlayTypeForScope(d.scope),
        complianceScore: d.complianceScore,
        governanceTrend: trendForScore(d.complianceScore),
        trustSummary: `Governance decision: ${d.status}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    });

    (input.complianceEvaluations ?? []).forEach(e => {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: e.stepId,
        overlayType: overlayTypeForDimension(e.dimension),
        complianceScore: e.score,
        governanceTrend: trendForScore(e.score),
        trustSummary: `Compliance dimension: ${e.dimension}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    });

    (input.governanceMemory ?? []).forEach(m => {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: m.stepId,
        overlayType: overlayTypeForDimension(m.memoryType),
        complianceScore: Math.round(m.confidence * 100),
        governanceTrend: trendForScore(m.confidence * 100),
        trustSummary: `Memory signal: ${m.signal}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    });

    (input.antiPatterns ?? []).forEach(a => {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: a.stepId,
        overlayType: 'governance-evolution-trail',
        complianceScore: Math.round(a.confidence * 100),
        governanceTrend: 'degrading',
        trustSummary: `Anti-pattern severity: ${a.severity}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    });

    const overall = indicators.length
      ? Math.round(indicators.reduce((s, i) => s + i.complianceScore, 0) / indicators.length)
      : 100;

    const nonDegrading = indicators.filter(i => i.governanceTrend !== 'degrading').length;
    const trustHealthScore = indicators.length
      ? Math.round((nonDegrading / indicators.length) * 100)
      : 100;

    return {
      collectionId,
      indicators,
      overallComplianceScore: overall,
      totalExplainableSignals: indicators.length,
      trustHealthScore,
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalGovernanceGraphOverlayBuilder = new GovernanceGraphOverlayBuilder();
