// src/workflow-graph/projection/legacy-node-shim.ts
import type { ApiTestStep } from '../../data/types';
import type { WorkflowNode } from '../../shared-core/contracts/workflow.contract';

/**
 * Maps ApiTestStep[] to minimal WorkflowNode[] for projection.
 * Used when WorkflowEnvelope has only legacyNodes and no nodes[].
 */
export function shimLegacyNodes(steps: ApiTestStep[]): WorkflowNode[] {
  return steps.map((step) => ({
    nodeType: 'HTTP' as const,
    step,
    dependsOn: step.dependsOn ?? [],
    hierarchyPath: [],
  }));
}
