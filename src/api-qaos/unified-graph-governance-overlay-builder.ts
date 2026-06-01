import { randomUUID } from 'crypto';
import type {
  UnifiedGovernanceOverlayType, UnifiedGovernanceOverlayIndicator, UnifiedGovernanceGraphOverlay,
  UnifiedGovernanceOverlayInput, IUnifiedGovernanceGraphOverlayBuilder
} from './contracts/unified-graph-governance-overlay.contracts';

const GOVERNANCE_NOTE = 'Unified governance graph overlay — advisory only, additive badges, graph never mutated.';

function trendForScore(score: number): UnifiedGovernanceOverlayIndicator['governanceTrend'] {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

function overlayTypeForScope(scope: string): UnifiedGovernanceOverlayType {
  if (scope.includes('replay')) return 'replay-governance-reasoning-trail';
  if (scope.includes('trust')) return 'orchestration-trust-overlay';
  if (scope.includes('platform') || scope.includes('consolidation')) return 'platform-consolidation-signal';
  if (scope.includes('dependency')) return 'dependency-continuity';
  if (scope.includes('cognition')) return 'unified-operational-evolution-trail';
  return 'enterprise-orchestration';
}

function overlayTypeForDomain(domain: string): UnifiedGovernanceOverlayType {
  if (domain.includes('replay')) return 'replay-governance-reasoning-trail';
  if (domain.includes('trust')) return 'orchestration-trust-overlay';
  if (domain.includes('cognition')) return 'unified-operational-evolution-trail';
  if (domain.includes('dependency') || domain.includes('operational-memory')) return 'dependency-continuity';
  return 'platform-consolidation-signal';
}

export class UnifiedGraphGovernanceOverlayBuilder implements IUnifiedGovernanceGraphOverlayBuilder {
  _reset(): void { /* stateless */ }

  build(collectionId: string, input: UnifiedGovernanceOverlayInput): UnifiedGovernanceGraphOverlay {
    const indicators: UnifiedGovernanceOverlayIndicator[] = [];

    (input.orchestrationDecisions ?? []).forEach(d => {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: d.stepId,
        overlayType: overlayTypeForScope(d.scope),
        platformScore: d.governanceScore,
        governanceTrend: trendForScore(d.governanceScore),
        unificationSummary: `Orchestration decision: ${d.status}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    });

    (input.consolidationScores ?? []).forEach(s => {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: s.stepId,
        overlayType: overlayTypeForDomain(s.domain),
        platformScore: s.unificationScore,
        governanceTrend: trendForScore(s.unificationScore),
        unificationSummary: `Consolidation domain: ${s.domain}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    });

    (input.enterpriseMemory ?? []).forEach(m => {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: m.stepId,
        overlayType: overlayTypeForDomain(m.memoryType),
        platformScore: Math.round(m.confidence * 100),
        governanceTrend: trendForScore(m.confidence * 100),
        unificationSummary: `Enterprise memory signal: ${m.signal}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    });

    (input.orchestrationAntiPatterns ?? []).forEach(a => {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: a.stepId,
        overlayType: 'unified-operational-evolution-trail',
        platformScore: Math.round(a.confidence * 100),
        governanceTrend: 'degrading',
        unificationSummary: `Anti-pattern severity: ${a.severity}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    });

    const overall = indicators.length
      ? Math.round(indicators.reduce((s, i) => s + i.platformScore, 0) / indicators.length)
      : 100;

    const nonDegrading = indicators.filter(i => i.governanceTrend !== 'degrading').length;
    const platformHealthScore = indicators.length
      ? Math.round((nonDegrading / indicators.length) * 100)
      : 100;

    return {
      collectionId,
      indicators,
      overallPlatformScore: overall,
      totalExplainableSignals: indicators.length,
      platformHealthScore,
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalUnifiedGraphGovernanceOverlayBuilder = new UnifiedGraphGovernanceOverlayBuilder();
