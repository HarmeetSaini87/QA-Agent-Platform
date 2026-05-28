// src/api-collaboration/collaboration-review-store.ts
// Phase E Step 9: Review comments and threads. Append-only comments — no deletion.

import type {
  ICollaborationReviewStore,
  ReviewComment,
  ReviewThread,
  ReviewCommentTarget,
  ReviewCommentStatus,
} from './contracts/collaboration-review.contracts';

export class CollaborationReviewStore implements ICollaborationReviewStore {
  private readonly _comments = new Map<string, ReviewComment>();
  private readonly _threads = new Map<string, ReviewThread>();
  private readonly _commentsByCollection = new Map<string, string[]>();

  addComment(comment: ReviewComment): void {
    this._comments.set(comment.commentId, comment);
    const list = this._commentsByCollection.get(comment.collectionId) ?? [];
    list.push(comment.commentId);
    this._commentsByCollection.set(comment.collectionId, list);
  }

  resolveComment(commentId: string, _actorId: string): boolean {
    const comment = this._comments.get(commentId);
    if (!comment) return false;
    this._comments.set(commentId, { ...comment, status: 'resolved', resolvedAt: new Date().toISOString() });
    return true;
  }

  listComments(
    collectionId: string,
    filter?: { targetType?: ReviewCommentTarget; status?: ReviewCommentStatus },
  ): ReviewComment[] {
    const ids = this._commentsByCollection.get(collectionId) ?? [];
    let results = ids.map(id => this._comments.get(id)!).filter(Boolean);
    if (filter?.targetType) results = results.filter(c => c.targetType === filter.targetType);
    if (filter?.status) results = results.filter(c => c.status === filter.status);
    return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  createThread(thread: ReviewThread): void {
    this._threads.set(thread.threadId, thread);
  }

  getThread(threadId: string): ReviewThread | null {
    return this._threads.get(threadId) ?? null;
  }

  listThreads(collectionId: string): ReviewThread[] {
    return Array.from(this._threads.values())
      .filter(t => t.collectionId === collectionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export const globalCollaborationReviewStore = new CollaborationReviewStore();
