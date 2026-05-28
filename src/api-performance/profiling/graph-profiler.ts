// src/api-performance/profiling/graph-profiler.ts
// Phase E Step 1: Graph projection cost measurement.
// Wraps projection calls to record node/edge counts and projection duration.

import type { GraphProjection } from '../../workflow-graph/contracts/graph.contracts';
import { withProfilingSync } from './execution-profiler';

export function profiledProjection(
  collectionId: string,
  projectFn: () => GraphProjection
): GraphProjection {
  return withProfilingSync(
    'graph-projection',
    `project:${collectionId}`,
    projectFn,
    { collectionId }
  );
}

export interface GraphProjectionCostReport {
  readonly collectionId: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly clusterCount: number;
  readonly hasHierarchy: boolean;
  readonly projectionStrategy: string;
  readonly durationMs: number;
}

export function buildProjectionCostReport(
  collectionId: string,
  projection: GraphProjection,
  durationMs: number
): GraphProjectionCostReport {
  return {
    collectionId,
    nodeCount: projection.nodes.length,
    edgeCount: projection.edges.length,
    clusterCount: projection.clusters.length,
    hasHierarchy: projection.meta.hasHierarchy,
    projectionStrategy: projection.meta.projectionStrategy,
    durationMs,
  };
}
