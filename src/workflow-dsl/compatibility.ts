/**
 * compatibility.ts
 * Backward compatibility shim for WorkflowEnvelope.
 *
 * promoteToNodes() — promotes legacy envelope (legacyNodes only) to enhanced
 * shape (nodes present) without mutation. legacyNodes always preserved.
 *
 * Phase C: coordinator calls promoteToNodes() before dispatching to workflow-engine.
 * Phase A–B: available but not called — safe to import anywhere.
 */

import type { WorkflowEnvelope } from '../shared-core/contracts/workflow.contract';

/**
 * Promotes a legacy WorkflowEnvelope to enhanced shape.
 * Pure function — original envelope unchanged, legacyNodes intact.
 * If nodes already populated, returns envelope as-is (idempotent).
 */
export function promoteToNodes(envelope: WorkflowEnvelope): WorkflowEnvelope {
  if (envelope.workflow.nodes?.length) return envelope;
  return {
    ...envelope,
    workflow: {
      ...envelope.workflow,
      nodes: envelope.workflow.legacyNodes.map(step => ({
        nodeType: 'HTTP' as const,
        step,
        dependsOn: step.dependsOn,
      })),
    },
  };
}

/**
 * Detects which envelope tier an envelope belongs to.
 * Used by future runtime to choose execution path.
 *
 *   legacy   — legacyNodes only, source='manual'
 *   enhanced — nodes present, source='openapi'|'postman'|'curl'
 *   ai       — nodes present, source='ai'
 */
export function detectEnvelopeTier(
  envelope: WorkflowEnvelope
): 'legacy' | 'enhanced' | 'ai' {
  if (envelope.metadata.source === 'ai') return 'ai';
  if (envelope.workflow.nodes?.length) return 'enhanced';
  return 'legacy';
}
