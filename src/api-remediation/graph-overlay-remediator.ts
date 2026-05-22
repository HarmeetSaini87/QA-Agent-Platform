// Pure function — augments an existing AiGraphOverlayBundle with proposal badges.
// Does NOT modify the original bundle; returns a new object.

import type {
  AiGraphOverlayBundle,
  AiGraphAnnotation,
  AiOverlayBadge,
} from '../api-intelligence/contracts/graph-overlay-ai.contracts';
import type { RemediationProposal } from './contracts/remediation-proposal.contracts';

export function annotateOverlayWithProposals(
  bundle: AiGraphOverlayBundle,
  proposals: RemediationProposal[],
): AiGraphOverlayBundle {
  if (proposals.length === 0) return { ...bundle };

  // Deep-copy annotations so original bundle is untouched
  const annotationsMap = new Map<string, AiGraphAnnotation>(
    bundle.annotations.map(a => [a.stepId, { ...a, badges: [...a.badges] }]),
  );

  for (const proposal of proposals) {
    if (!proposal.stepId) continue;

    const badgeType = proposal.status === 'pending-approval' ? 'approval-pending' : 'remediation-proposed';
    const badge: AiOverlayBadge = {
      type: badgeType,
      label: proposal.type,
      confidence: proposal.confidence,
      detail: proposal.title,
    };

    const existing = annotationsMap.get(proposal.stepId);
    if (existing) {
      existing.badges.push(badge);
    } else {
      annotationsMap.set(proposal.stepId, {
        // nodeId assumed equal to stepId when no existing annotation provides the graph nodeId
        nodeId: proposal.stepId,
        stepId: proposal.stepId,
        badges: [badge],
      });
    }
  }

  return { ...bundle, annotations: Array.from(annotationsMap.values()) };
}
