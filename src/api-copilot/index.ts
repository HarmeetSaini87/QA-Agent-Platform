// src/api-copilot/index.ts
// Phase E Step 10: Enterprise AI QA Copilot, Predictive Intelligence & Controlled Autonomous Operations Foundation.

export * from './contracts/copilot-guidance.contracts';
export * from './contracts/predictive-intelligence.contracts';
export * from './contracts/replay-reasoning.contracts';
export * from './contracts/ai-graph-overlay.contracts';
export * from './contracts/autonomous-preparation.contracts';

export { CopilotGuidanceEngine, globalCopilotGuidanceEngine } from './copilot-guidance-engine';
export { PredictiveIntelligenceEngine, globalPredictiveIntelligenceEngine } from './predictive-intelligence-engine';
export { ReplayReasoningEngine, globalReplayReasoningEngine } from './replay-reasoning-engine';
export { AiGraphOverlayBuilder, globalAiGraphOverlayBuilder } from './ai-graph-overlay-builder';
export { AutonomousPreparationEngine, globalAutonomousPreparationEngine } from './autonomous-preparation-engine';
export { registerCopilotRoutes } from './routes/copilot.routes';
