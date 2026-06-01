// src/api-mesh/index.ts
// Phase E Step 13: Enterprise QA Operating Mesh, Autonomous Knowledge Fabric & Adaptive Global Reliability Intelligence.

export * from './contracts/mesh-intelligence.contracts';
export * from './contracts/replay-knowledge-fabric.contracts';
export * from './contracts/adaptive-reliability.contracts';
export * from './contracts/federated-operational-memory.contracts';
export * from './contracts/adaptive-graph-overlay.contracts';
export * from './contracts/mesh-plugin-extension.contracts';

export { MeshIntelligenceRegistry, globalMeshIntelligenceRegistry } from './mesh-intelligence-registry';
export { ReplayKnowledgeFabric, globalReplayKnowledgeFabric } from './replay-knowledge-fabric';
export { AdaptiveReliabilityIntelligence, globalAdaptiveReliabilityIntelligence } from './adaptive-reliability-intelligence';
export { FederatedOperationalMemory, globalFederatedOperationalMemory } from './federated-operational-memory';
export { AdaptiveMeshGraphOverlayBuilder, globalAdaptiveMeshGraphOverlayBuilder } from './adaptive-graph-overlay-builder';
export { registerMeshRoutes } from './routes/mesh.routes';
