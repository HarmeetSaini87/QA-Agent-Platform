// src/api-cognition/index.ts
// Phase E Step 14: Enterprise Operational Cognition Platform, Governed Self-Optimization & Global Reliability Governance Fabric.

export * from './contracts/cognition-layer.contracts';
export * from './contracts/replay-operational-reasoning.contracts';
export * from './contracts/governed-self-optimization.contracts';
export * from './contracts/federated-cognition-memory.contracts';
export * from './contracts/cognitive-graph-overlay.contracts';
export * from './contracts/cognition-plugin-extension.contracts';

export { CognitionLayerRegistry, globalCognitionLayerRegistry } from './cognition-layer-registry';
export { ReplayOperationalReasoningEngine, globalReplayOperationalReasoningEngine } from './replay-operational-reasoning-engine';
export { GovernedSelfOptimizationEngine, globalGovernedSelfOptimizationEngine } from './governed-self-optimization-engine';
export { FederatedCognitionMemory, globalFederatedCognitionMemory } from './federated-cognition-memory';
export { CognitiveGraphOverlayBuilder, globalCognitiveGraphOverlayBuilder } from './cognitive-graph-overlay-builder';
export { registerCognitionRoutes } from './routes/cognition.routes';
