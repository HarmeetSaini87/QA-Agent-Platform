// src/api-autonomous/autonomous-graph-overlay-builder.ts
// Phase E Step 11: Autonomous graph overlay builder. Additive indicators only — graph never mutated.

import {
  AutonomousGraphOverlay,
  AutonomousOverlayIndicator,
  AutonomousOverlayType,
  IAutonomousGraphOverlayBuilder,
} from './contracts/autonomous-graph-overlay.contracts';

const GOVERNANCE_NOTE =
  'All autonomous overlay indicators are advisory. Graph structure and execution runtime are never modified.';

export class AutonomousGraphOverlayBuilder implements IAutonomousGraphOverlayBuilder {
  build(
    collectionId: string,
    input: {
      remediationPlans?: Array<{ stepId: string; planId: string; status: string; confidence: number }>;
      stabilizationInsights?: Array<{ stepId: string; instabilityScore: number }>;
      retryAdaptations?: Array<{ stepId: string; confidence: number }>;
    }
  ): AutonomousGraphOverlay {
    const indicators: AutonomousOverlayIndicator[] = [];

    for (const plan of input.remediationPlans ?? []) {
      const overlayType: AutonomousOverlayType =
        plan.status === 'approved' ? 'remediation-approved' : 'remediation-pending';
      indicators.push({
        nodeId: plan.stepId,
        overlayType,
        label: `Remediation ${plan.status} (confidence: ${plan.confidence})`,
        stabilizationConfidence: plan.confidence,
        linkedPlanId: plan.planId,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    for (const insight of input.stabilizationInsights ?? []) {
      indicators.push({
        nodeId: insight.stepId,
        overlayType: 'stabilization-candidate',
        label: `Instability score: ${insight.instabilityScore}`,
        stabilizationConfidence: Math.max(0, 100 - insight.instabilityScore),
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    for (const retry of input.retryAdaptations ?? []) {
      indicators.push({
        nodeId: retry.stepId,
        overlayType: 'retry-adaptation-hint',
        label: `Retry adaptation (confidence: ${retry.confidence})`,
        stabilizationConfidence: retry.confidence,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    const totalRemediationPending = indicators.filter(
      (i) => i.overlayType === 'remediation-pending'
    ).length;
    const totalStabilizationCandidates = indicators.filter(
      (i) => i.overlayType === 'stabilization-candidate'
    ).length;

    return {
      collectionId,
      indicators,
      totalRemediationPending,
      totalStabilizationCandidates,
      generatedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalAutonomousGraphOverlayBuilder = new AutonomousGraphOverlayBuilder();
