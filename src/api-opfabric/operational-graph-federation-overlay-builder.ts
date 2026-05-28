import { randomUUID } from 'crypto';
import type {
  OperationalFederationOverlayType,
  OperationalFederationOverlayIndicator,
  OperationalFederationGraphOverlay,
  FederationOverlayInput,
  IOperationalFederationGraphOverlayBuilder,
} from './contracts/operational-graph-federation-overlay.contracts';

const GOVERNANCE_NOTE = 'Advisory only — federation overlays are additive indicators; graph structure and execution semantics are never modified.';

function overlayTypeForScope(scope: string): OperationalFederationOverlayType {
  if (scope === 'orchestration-governance') return 'orchestration-federation';
  if (scope === 'replay-governance') return 'replay-optimization-reasoning';
  if (scope === 'remediation-federation') return 'explainable-governance-trail';
  if (scope === 'reliability-governance') return 'resilience-federation-cognition';
  if (scope === 'resilience-intelligence') return 'adaptive-stabilization-federation';
  return 'dependency-federation-intelligence';
}

function overlayTypeForFederationType(federationType: string): OperationalFederationOverlayType {
  if (federationType === 'retry-stabilization') return 'adaptive-stabilization-federation';
  if (federationType === 'dependency-resilience') return 'dependency-federation-intelligence';
  if (federationType === 'orchestration-reasoning') return 'orchestration-federation';
  if (federationType === 'sla-governance') return 'resilience-federation-cognition';
  if (federationType === 'remediation-memory') return 'explainable-governance-trail';
  return 'replay-optimization-reasoning';
}

function trendForScore(score: number): 'improving' | 'stable' | 'degrading' {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

export class OperationalFederationGraphOverlayBuilder
  implements IOperationalFederationGraphOverlayBuilder {
  build(collectionId: string, input: FederationOverlayInput): OperationalFederationGraphOverlay {
    const indicators: OperationalFederationOverlayIndicator[] = [];

    for (const p of input.propagations ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: p.stepId,
        overlayType: overlayTypeForScope(p.scope),
        federationScore: p.confidence,
        governanceTrend: trendForScore(p.confidence),
        reasoningSummary: `Governance scope: ${p.scope}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const m of input.memoryEntries ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: m.stepId,
        overlayType: overlayTypeForFederationType(m.federationType),
        federationScore: m.confidence,
        governanceTrend: trendForScore(m.confidence),
        reasoningSummary: m.signal,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const fp of input.federationProposals ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: fp.stepId,
        overlayType: 'explainable-governance-trail',
        federationScore: fp.confidence,
        governanceTrend: trendForScore(fp.confidence),
        reasoningSummary: `Federation optimization domain: ${fp.domain}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    for (const a of input.antiPatterns ?? []) {
      indicators.push({
        indicatorId: randomUUID(),
        stepId: a.stepId,
        overlayType: 'resilience-federation-cognition',
        federationScore: a.confidence,
        governanceTrend: 'degrading',
        reasoningSummary: `Anti-pattern severity: ${a.severity}`,
        isExplainable: true,
        governanceNote: GOVERNANCE_NOTE,
      });
    }

    const overallFederationScore =
      indicators.length === 0
        ? 100
        : Math.round(indicators.reduce((s, i) => s + i.federationScore, 0) / indicators.length);

    const fabricGovernanceScore =
      indicators.length === 0
        ? 100
        : Math.round(
            indicators.filter(i => i.governanceTrend !== 'degrading').length / indicators.length * 100,
          );

    return {
      collectionId,
      indicators,
      overallFederationScore,
      totalExplainableSignals: indicators.length,
      fabricGovernanceScore,
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalOperationalFederationGraphOverlayBuilder = new OperationalFederationGraphOverlayBuilder();
