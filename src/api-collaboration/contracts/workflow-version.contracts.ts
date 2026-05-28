// src/api-collaboration/contracts/workflow-version.contracts.ts
// Phase E Step 9: Controlled workflow versioning. WorkflowEnvelope remains authoritative.

export type WorkflowRevisionStatus = 'draft' | 'review' | 'published' | 'archived' | 'rolled-back';

export interface WorkflowRevision {
  readonly revisionId: string;
  readonly collectionId: string;
  readonly revisionNumber: number;
  readonly status: WorkflowRevisionStatus;
  readonly authorId: string;
  readonly createdAt: string;
  readonly publishedAt?: string;
  readonly description: string;
  /** Snapshot of step IDs + dependsOn at revision time — NOT full WorkflowEnvelope. */
  readonly stepSnapshot: Array<{ stepId: string; dependsOn: string[] }>;
  readonly linkedRunIds: readonly string[];
  readonly tenantId?: string;
}

export interface WorkflowRevisionDiff {
  readonly fromRevisionId: string;
  readonly toRevisionId: string;
  readonly stepsAdded: readonly string[];
  readonly stepsRemoved: readonly string[];
  readonly dependenciesChanged: Array<{ stepId: string; before: string[]; after: string[] }>;
  readonly diffGeneratedAt: string;
}

export interface IWorkflowVersionStore {
  saveRevision(revision: WorkflowRevision): void;
  getRevision(revisionId: string): WorkflowRevision | null;
  listRevisions(collectionId: string): WorkflowRevision[];
  /** Returns the latest published revision. */
  getLatestPublished(collectionId: string): WorkflowRevision | null;
  diff(fromRevisionId: string, toRevisionId: string): WorkflowRevisionDiff | null;
  rollback(collectionId: string, toRevisionId: string, actorId: string): WorkflowRevision | null;
}
