// src/workflow-graph/service/projection-service.ts
import type { GraphProjection } from '../contracts/graph.contracts';
import { buildGraphProjection } from '../projection/graph-projection-builder';
import { getWorkflowEnvelope } from './workflow-envelope-adapter';
// Phase E Step 1: Projection cache integration — TTL-based, non-breaking.
import { globalProjectionCache } from '../../api-performance/optimization/graph-projection-cache';

export type ProjectionResult =
  | { ok: true; projection: GraphProjection; cached?: boolean }
  | { ok: false; status: 404 | 500; code: string; message: string };

export function getProjection(collectionId: string): ProjectionResult {
  // Phase E Step 1: Check cache first — avoids re-running full projection for hot collections.
  const cached = globalProjectionCache.get(collectionId);
  if (cached) return { ok: true, projection: cached, cached: true };

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
    // Phase E Step 1: Populate cache for subsequent requests within TTL window.
    globalProjectionCache.set(collectionId, projection);
    return { ok: true, projection, cached: false };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      code: 'GRAPH_PROJECTION_FAILED',
      message: err instanceof Error ? err.message : 'Unknown projection error',
    };
  }
}
