// src/api-collaboration/index.ts
// Phase E Step 9: Enterprise Collaboration Platform, Shared Workflow Intelligence & Organization-Scale QA Operations.

export * from './contracts/workflow-version.contracts';
export * from './contracts/collaboration-review.contracts';
export * from './contracts/organization-template.contracts';
export * from './contracts/replay-knowledge.contracts';
export * from './contracts/graph-collaboration-overlay.contracts';
export * from './contracts/realtime-collaboration.contracts';

export { WorkflowVersionStore, globalWorkflowVersionStore } from './workflow-version-store';
export { CollaborationReviewStore, globalCollaborationReviewStore } from './collaboration-review-store';
export { OrganizationTemplateRegistry, globalOrganizationTemplateRegistry } from './organization-template-registry';
export { ReplayKnowledgeStore, globalReplayKnowledgeStore } from './replay-knowledge-store';
export { GraphCollaborationOverlayBuilder, globalGraphCollaborationOverlayBuilder } from './graph-collaboration-overlay-builder';
export { registerCollaborationRoutes } from './routes/collaboration.routes';
