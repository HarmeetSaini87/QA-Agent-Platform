/**
 * metadata-sanitizer.ts
 * Phase D Step 4 — strips execution-agnostic metadata from WorkflowEnvelope.
 *
 * CONTRACT (frozen — infrastructure-critical):
 *   - MUST be deterministic: same input always produces same output.
 *   - MUST be side-effect free: no I/O, no mutation, no external calls.
 *   - MUST NOT throw: invalid/partial envelopes pass through safely.
 *
 * Replay systems, worker transfers, and distributed orchestration rely on this.
 * Do not weaken this contract.
 */

import type { WorkflowEnvelope, WorkflowNode } from '../shared-core/contracts/workflow.contract';

function stripNodeMetadata(node: WorkflowNode): WorkflowNode {
  const { position: _p, visualGroup: _v, hierarchyPath: _h, ...rest } = node;
  return rest;
}

/**
 * Returns a new WorkflowEnvelope with all execution-agnostic metadata removed.
 * Preserves metadataVersion and normalizationSource (provenance, not display).
 * Original envelope is never mutated.
 *
 * Field ordering is deterministic — stable for snapshot diffing and replay debugging.
 */
export function stripExecutionMetadata(envelope: WorkflowEnvelope): WorkflowEnvelope {
  const {
    folderHierarchy: _f,
    graphHints: _g,
    aiReadiness: _a,
    ...restMetadata
  } = envelope.metadata;

  // NOTE: orderedMetadata must be updated when WorkflowMetadata gains new required fields.
  // TypeScript will flag missing required fields at compile time, but ordering won't be
  // automatically correct — add new required fields explicitly in the block below.

  // Explicit field ordering — deterministic for snapshot diff and replay debugging
  const orderedMetadata: typeof restMetadata = {
    createdAt: restMetadata.createdAt,
    source: restMetadata.source,
    collectionId: restMetadata.collectionId,
    ...(restMetadata.projectId !== undefined && { projectId: restMetadata.projectId }),
    ...(restMetadata.tags !== undefined && { tags: restMetadata.tags }),
    ...(restMetadata.version !== undefined && { version: restMetadata.version }),
    ...(restMetadata.description !== undefined && { description: restMetadata.description }),
    ...(restMetadata.metadataVersion !== undefined && { metadataVersion: restMetadata.metadataVersion }),
    ...(restMetadata.metadataGeneratedAt !== undefined && { metadataGeneratedAt: restMetadata.metadataGeneratedAt }),
    ...(restMetadata.normalizationSource !== undefined && { normalizationSource: restMetadata.normalizationSource }),
  };

  return {
    schemaVersion: envelope.schemaVersion,
    workflow: {
      ...envelope.workflow,
      legacyNodes: envelope.workflow.legacyNodes ? [...envelope.workflow.legacyNodes] : envelope.workflow.legacyNodes,
      nodes: envelope.workflow.nodes?.map(stripNodeMetadata),
    },
    execution: envelope.execution,
    metadata: orderedMetadata,
    ...(envelope.contracts !== undefined && { contracts: envelope.contracts }),
  };
}
