// src/workflow-graph/service/projection-service.ts
import type { GraphProjection } from '../contracts/graph.contracts';
import { buildGraphProjection } from '../projection/graph-projection-builder';
import { getWorkflowEnvelope } from './workflow-envelope-adapter';

export type ProjectionResult =
  | { ok: true; projection: GraphProjection }
  | { ok: false; status: 404 | 500; code: string; message: string };

export function getProjection(collectionId: string): ProjectionResult {
  let envelope;
  try {
    envelope = getWorkflowEnvelope(collectionId);
  } catch (err) {
    return {
      ok: false,
      status: 500,
      code: 'GRAPH_PROJECTION_FAILED',
      message: err instanceof Error ? err.message : 'Unknown error resolving envelope',
    };
  }

  if (!envelope) {
    return { ok: false, status: 404, code: 'COLLECTION_NOT_FOUND', message: `Collection ${collectionId} not found` };
  }

  try {
    const projection = buildGraphProjection(envelope, { projectedAt: new Date().toISOString() });
    return { ok: true, projection };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      code: 'GRAPH_PROJECTION_FAILED',
      message: err instanceof Error ? err.message : 'Unknown projection error',
    };
  }
}
