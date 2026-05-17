// src/workflow-graph/index.ts
export { registerWorkflowGraphRoutes } from './routes/workflow-graph.routes';
export { getProjection } from './service/projection-service';
export { buildGraphProjection } from './projection/graph-projection-builder';
export type { GraphProjection, VisualNode, VisualEdge, ProjectionMeta, ProjectionWarning, ProjectionStrategy } from './contracts/graph.contracts';
