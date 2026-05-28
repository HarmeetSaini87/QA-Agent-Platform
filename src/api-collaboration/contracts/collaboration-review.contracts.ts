// src/api-collaboration/contracts/collaboration-review.contracts.ts
// Phase E Step 9: Review comments and orchestration review workflows.

export type ReviewCommentTarget = 'step' | 'dependency' | 'collection' | 'replay' | 'graph-node';

export type ReviewCommentStatus = 'open' | 'resolved' | 'wont-fix';

export interface ReviewComment {
  readonly commentId: string;
  readonly collectionId: string;
  readonly authorId: string;
  readonly targetType: ReviewCommentTarget;
  readonly targetId: string;
  readonly body: string;
  readonly status: ReviewCommentStatus;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly revisionId?: string;
  readonly tenantId?: string;
}

export interface ReviewThread {
  readonly threadId: string;
  readonly collectionId: string;
  readonly title: string;
  readonly comments: readonly ReviewComment[];
  readonly createdAt: string;
  readonly closedAt?: string;
  readonly tenantId?: string;
}

export interface ICollaborationReviewStore {
  addComment(comment: ReviewComment): void;
  resolveComment(commentId: string, actorId: string): boolean;
  listComments(collectionId: string, filter?: { targetType?: ReviewCommentTarget; status?: ReviewCommentStatus }): ReviewComment[];
  createThread(thread: ReviewThread): void;
  getThread(threadId: string): ReviewThread | null;
  listThreads(collectionId: string): ReviewThread[];
}
