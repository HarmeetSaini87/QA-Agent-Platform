// src/api-federation/index.ts
// Phase E Step 12: Enterprise Federated QA Platform, Cross-Organization Intelligence & Global Orchestration Fabric.

export * from './contracts/federation-orchestration.contracts';
export * from './contracts/cross-org-intelligence.contracts';
export * from './contracts/federated-governance.contracts';
export * from './contracts/federated-replay-intelligence.contracts';
export * from './contracts/federated-graph-overlay.contracts';
export * from './contracts/federation-plugin-extension.contracts';

export { FederationOrchestrationRegistry, globalFederationOrchestrationRegistry } from './federation-orchestration-registry';
export { CrossOrgIntelligenceHub, globalCrossOrgIntelligenceHub } from './cross-org-intelligence-hub';
export { FederatedGovernanceRegistry, globalFederatedGovernanceRegistry } from './federated-governance-registry';
export { FederatedReplayIntelligenceEngine, globalFederatedReplayIntelligenceEngine } from './federated-replay-intelligence-engine';
export { FederatedGraphOverlayBuilder, globalFederatedGraphOverlayBuilder } from './federated-graph-overlay-builder';
export { registerFederationRoutes } from './routes/federation.routes';
