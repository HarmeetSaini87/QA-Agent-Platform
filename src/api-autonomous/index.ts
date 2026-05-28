// src/api-autonomous/index.ts
// Phase E Step 11: Autonomous Enterprise QA Operations, Policy-Governed Self-Healing & Adaptive Orchestration.

export * from './contracts/autonomous-governance.contracts';
export * from './contracts/controlled-remediation.contracts';
export * from './contracts/adaptive-retry.contracts';
export * from './contracts/replay-autonomous-intelligence.contracts';
export * from './contracts/autonomous-graph-overlay.contracts';
export * from './contracts/plugin-autonomous-extension.contracts';

export { AutonomyGovernanceRegistry, globalAutonomyGovernanceRegistry } from './autonomous-governance-registry';
export { ControlledRemediationExecutor, globalControlledRemediationExecutor } from './controlled-remediation-executor';
export { AdaptiveRetryIntelligence, globalAdaptiveRetryIntelligence } from './adaptive-retry-intelligence';
export { ReplayAutonomousIntelligenceEngine, globalReplayAutonomousIntelligenceEngine } from './replay-autonomous-intelligence-engine';
export { AutonomousGraphOverlayBuilder, globalAutonomousGraphOverlayBuilder } from './autonomous-graph-overlay-builder';
export { registerAutonomousRoutes } from './routes/autonomous.routes';
