// src/api-collaboration/contracts/realtime-collaboration.contracts.ts
// Phase E Step 9: Future real-time collaboration extension points. Stubs only.

export interface ICollaborativeCursorBroadcast {
  /** Broadcast cursor position to other editors (stub). */
  broadcast(sessionId: string, actorId: string, nodeId: string): void;
  /** Subscribe to cursor updates (stub). */
  subscribe(sessionId: string, callback: (actorId: string, nodeId: string) => void): () => void;
}

export interface IWorkflowPublishingPipeline {
  /** Submit workflow revision for org-level publication review (stub). */
  submitForReview(collectionId: string, revisionId: string, actorId: string): Promise<{ submitted: boolean; reviewId?: string }>;
  /** Approve and publish a revision (stub). */
  approve(reviewId: string, approverId: string): Promise<{ published: boolean }>;
}

export interface ICrossTeamOrchestrationFederation {
  /** Register a collection as shareable across teams (stub). */
  share(collectionId: string, targetTeamIds: string[], actorId: string): Promise<{ shared: boolean }>;
  /** List collections shared with a team (stub). */
  listSharedWith(teamId: string): Promise<string[]>;
}

export class NoOpCollaborativeCursorBroadcast implements ICollaborativeCursorBroadcast {
  broadcast(_sessionId: string, _actorId: string, _nodeId: string): void { /* no-op */ }
  subscribe(_sessionId: string, _callback: (actorId: string, nodeId: string) => void): () => void { return () => { /* no-op */ }; }
}

export class NoOpWorkflowPublishingPipeline implements IWorkflowPublishingPipeline {
  async submitForReview(_collectionId: string, _revisionId: string, _actorId: string) { return { submitted: false }; }
  async approve(_reviewId: string, _approverId: string) { return { published: false }; }
}
