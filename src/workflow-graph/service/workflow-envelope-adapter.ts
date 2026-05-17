// src/workflow-graph/service/workflow-envelope-adapter.ts
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';
import { findById, API_COLLECTIONS } from '../../data/store';
import { collectionToWorkflow } from '../../workflow-dsl/legacy-adapter';
import type { ApiCollection } from '../../data/types';

/**
 * Resolve a WorkflowEnvelope from a collectionId.
 * Returns undefined when the collection does not exist.
 */
export function getWorkflowEnvelope(collectionId: string): WorkflowEnvelope | undefined {
  const collection = findById<ApiCollection>(API_COLLECTIONS, collectionId);
  if (!collection) return undefined;
  return collectionToWorkflow(collection);
}
