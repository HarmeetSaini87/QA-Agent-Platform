/**
 * legacy-adapter.ts
 * Bidirectional conversion between existing ApiCollection and WorkflowEnvelope.
 *
 * Existing routes continue to call apiRunner.ts with ApiCollection — unchanged.
 * This adapter is available for Phase B+ when the coordinator takes over.
 *
 * INVARIANT: collectionToWorkflow(workflowToCollection(w)) round-trips losslessly.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ApiCollection } from '../data/types';
import type { WorkflowEnvelope, WorkflowNormalizationSource } from '../shared-core/contracts/workflow.contract';

export function collectionToWorkflow(collection: ApiCollection): WorkflowEnvelope {
  return {
    schemaVersion: '1.0',
    workflow: {
      id: collection.id,
      name: collection.name,
      legacyNodes: collection.steps,   // ApiTestStep[] preserved exactly
    },
    execution: {
      mode: collection.executionMode ?? 'sequential',
      maxConcurrency: collection.maxConcurrency,
      onFailure: collection.onFailure ?? 'stop',
      logLevel: collection.logLevel ?? 'standard',
      rateLimit: collection.rateLimit,
    },
    metadata: {
      createdAt: new Date().toISOString(),
      source: 'manual',
      collectionId: collection.id,
      projectId: collection.projectId,
      tags: collection.tags ?? [],
      version: '1.0',
      // Phase D Step 4: provenance fields
      metadataVersion: 1,
      metadataGeneratedAt: new Date().toISOString(),
      normalizationSource: 'legacy' as WorkflowNormalizationSource,
    },
  };
}

export function workflowToCollection(envelope: WorkflowEnvelope): ApiCollection {
  return {
    id: envelope.workflow.id,
    projectId: envelope.metadata.projectId,
    name: envelope.workflow.name,
    environmentId: '',           // caller must set — not carried in envelope
    steps: envelope.workflow.legacyNodes,
    variables: [],               // caller must merge environment variables
    onFailure: envelope.execution.onFailure ?? 'stop',
    executionMode: envelope.execution.mode,
    maxConcurrency: envelope.execution.maxConcurrency,
    logLevel: envelope.execution.logLevel,
    rateLimit: envelope.execution.rateLimit,
    tags: envelope.metadata.tags,
  };
}

/**
 * Wrap a bare ApiTestStep[] into a minimal WorkflowEnvelope.
 * Used by import engines (Phase D) until they produce envelopes natively.
 */
export function stepsToWorkflow(
  steps: ApiCollection['steps'],
  name: string,
  source: WorkflowEnvelope['metadata']['source'] = 'manual',
): WorkflowEnvelope {
  const id = uuidv4();
  return {
    schemaVersion: '1.0',
    workflow: { id, name, legacyNodes: steps },
    execution: { mode: 'sequential', onFailure: 'stop', logLevel: 'standard' },
    metadata: {
      createdAt: new Date().toISOString(),
      source,
      collectionId: id,
      metadataVersion: 1,
      metadataGeneratedAt: new Date().toISOString(),
      normalizationSource: (source === 'manual' ? 'manual' : 'legacy') as WorkflowNormalizationSource,
    },
  };
}
