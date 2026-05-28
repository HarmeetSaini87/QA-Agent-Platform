// src/api-graph-editor/contracts/collaborative-editor.contracts.ts
// Phase E Step 5: Future collaborative editing extension points.
// No implementation today — stubs only. Wire in Phase E Step 8+ or collaborative editing track.

export interface CollaborativeEditSession {
  readonly sessionId: string;
  readonly collectionId: string;
  readonly participants: readonly string[];
  readonly startedAt: string;
}

export interface ICollaborativeGraphEditor {
  /** Start a collaborative editing session (stub). */
  startSession(collectionId: string, actorIds: string[]): CollaborativeEditSession;
  /** Broadcast an edit to all session participants (stub). */
  broadcastEdit(sessionId: string, editId: string): void;
  /** End and archive the session (stub). */
  endSession(sessionId: string): void;
}

export interface IWorkflowTemplateRegistry {
  /** List available workflow templates (stub). */
  listTemplates(): string[];
  /** Instantiate a template into a new WorkflowEnvelope scaffold (stub). */
  instantiate(templateId: string, collectionId: string): Record<string, unknown>;
}

/** No-op stubs for future collaborative editing. */
export class NoOpCollaborativeGraphEditor implements ICollaborativeGraphEditor {
  startSession(collectionId: string, actorIds: string[]): CollaborativeEditSession {
    return { sessionId: 'noop', collectionId, participants: actorIds, startedAt: new Date().toISOString() };
  }
  broadcastEdit(_sessionId: string, _editId: string): void { /* no-op */ }
  endSession(_sessionId: string): void { /* no-op */ }
}

export class NoOpWorkflowTemplateRegistry implements IWorkflowTemplateRegistry {
  listTemplates(): string[] { return []; }
  instantiate(_templateId: string, _collectionId: string): Record<string, unknown> { return {}; }
}
