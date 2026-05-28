// src/api-collaboration/routes/collaboration.routes.ts
// Phase E Step 9: Enterprise collaboration REST endpoints.

import { randomUUID } from 'crypto';
import type { Express, Request, Response } from 'express';
import { globalWorkflowVersionStore } from '../workflow-version-store';
import { globalCollaborationReviewStore } from '../collaboration-review-store';
import { globalOrganizationTemplateRegistry } from '../organization-template-registry';
import { globalReplayKnowledgeStore } from '../replay-knowledge-store';
import { globalGraphCollaborationOverlayBuilder } from '../graph-collaboration-overlay-builder';

export function registerCollaborationRoutes(app: Express): void {

  // ── Workflow versions ─────────────────────────────────────────────────────

  // GET /api/collaboration/:collectionId/revisions
  app.get('/api/collaboration/:collectionId/revisions', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    res.json({ collectionId, revisions: globalWorkflowVersionStore.listRevisions(collectionId) });
  });

  // POST /api/collaboration/:collectionId/revisions
  app.post('/api/collaboration/:collectionId/revisions', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const { authorId, description, stepSnapshot, status, tenantId } = req.body as {
      authorId?: string; description?: string;
      stepSnapshot?: Array<{ stepId: string; dependsOn: string[] }>;
      status?: string; tenantId?: string;
    };
    if (!authorId || !Array.isArray(stepSnapshot)) {
      res.status(400).json({ error: 'authorId and stepSnapshot required' });
      return;
    }
    const existing = globalWorkflowVersionStore.listRevisions(collectionId);
    const revision = {
      revisionId: randomUUID(),
      collectionId,
      revisionNumber: existing.length + 1,
      status: (status ?? 'draft') as never,
      authorId,
      createdAt: new Date().toISOString(),
      description: description ?? '',
      stepSnapshot,
      linkedRunIds: [] as string[],
      ...(tenantId && { tenantId }),
    };
    globalWorkflowVersionStore.saveRevision(revision);
    res.status(201).json(revision);
  });

  // POST /api/collaboration/:collectionId/revisions/rollback
  app.post('/api/collaboration/:collectionId/revisions/rollback', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const { toRevisionId, actorId } = req.body as { toRevisionId?: string; actorId?: string };
    if (!toRevisionId || !actorId) { res.status(400).json({ error: 'toRevisionId and actorId required' }); return; }
    const result = globalWorkflowVersionStore.rollback(collectionId, toRevisionId, actorId);
    if (!result) { res.status(404).json({ error: 'Revision not found.' }); return; }
    res.json(result);
  });

  // POST /api/collaboration/:collectionId/revisions/diff
  app.post('/api/collaboration/:collectionId/revisions/diff', (req: Request, res: Response) => {
    const { fromRevisionId, toRevisionId } = req.body as { fromRevisionId?: string; toRevisionId?: string };
    if (!fromRevisionId || !toRevisionId) { res.status(400).json({ error: 'fromRevisionId and toRevisionId required' }); return; }
    const diff = globalWorkflowVersionStore.diff(fromRevisionId, toRevisionId);
    if (!diff) { res.status(404).json({ error: 'One or both revisions not found.' }); return; }
    res.json(diff);
  });

  // ── Review comments ───────────────────────────────────────────────────────

  // GET /api/collaboration/:collectionId/comments
  app.get('/api/collaboration/:collectionId/comments', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const { targetType, status } = req.query as { targetType?: string; status?: string };
    res.json({ comments: globalCollaborationReviewStore.listComments(collectionId, { targetType: targetType as never, status: status as never }) });
  });

  // POST /api/collaboration/:collectionId/comments
  app.post('/api/collaboration/:collectionId/comments', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const { authorId, targetType, targetId, body, revisionId } = req.body as {
      authorId?: string; targetType?: string; targetId?: string; body?: string; revisionId?: string;
    };
    if (!authorId || !targetType || !targetId || !body) {
      res.status(400).json({ error: 'authorId, targetType, targetId, body required' }); return;
    }
    const comment = {
      commentId: randomUUID(), collectionId, authorId,
      targetType: targetType as never, targetId, body,
      status: 'open' as const, createdAt: new Date().toISOString(),
      ...(revisionId && { revisionId }),
    };
    globalCollaborationReviewStore.addComment(comment);
    res.status(201).json(comment);
  });

  // POST /api/collaboration/comments/:commentId/resolve
  app.post('/api/collaboration/comments/:commentId/resolve', (req: Request, res: Response) => {
    const { commentId } = req.params as { commentId: string };
    const { actorId } = req.body as { actorId?: string };
    const ok = globalCollaborationReviewStore.resolveComment(commentId, actorId ?? 'unknown');
    if (!ok) { res.status(404).json({ error: 'Comment not found.' }); return; }
    res.json({ resolved: true, commentId });
  });

  // ── Templates ─────────────────────────────────────────────────────────────

  // GET /api/collaboration/templates
  app.get('/api/collaboration/templates', (req: Request, res: Response) => {
    const { category, tenantId, visibility } = req.query as { category?: string; tenantId?: string; visibility?: string };
    res.json({ templates: globalOrganizationTemplateRegistry.list({ category: category as never, tenantId, visibility: visibility as never }) });
  });

  // POST /api/collaboration/templates/:templateId/instantiate
  app.post('/api/collaboration/templates/:templateId/instantiate', (req: Request, res: Response) => {
    const { templateId } = req.params as { templateId: string };
    const { collectionId, actorId } = req.body as { collectionId?: string; actorId?: string };
    if (!collectionId || !actorId) { res.status(400).json({ error: 'collectionId and actorId required' }); return; }
    const result = globalOrganizationTemplateRegistry.instantiate(templateId, collectionId, actorId);
    if (!result) { res.status(404).json({ error: 'Template not found.' }); return; }
    res.json(result);
  });

  // ── Replay knowledge ──────────────────────────────────────────────────────

  // POST /api/collaboration/replay/:runId/annotations
  app.post('/api/collaboration/replay/:runId/annotations', (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    const { collectionId, authorId, body, stepId, eventSeq } = req.body as {
      collectionId?: string; authorId?: string; body?: string; stepId?: string; eventSeq?: number;
    };
    if (!collectionId || !authorId || !body) { res.status(400).json({ error: 'collectionId, authorId, body required' }); return; }
    const annotation = { annotationId: randomUUID(), runId, collectionId, authorId, body, createdAt: new Date().toISOString(), ...(stepId && { stepId }), ...(eventSeq !== undefined && { eventSeq }) };
    globalReplayKnowledgeStore.addAnnotation(annotation);
    res.status(201).json(annotation);
  });

  // GET /api/collaboration/replay/:runId/annotations
  app.get('/api/collaboration/replay/:runId/annotations', (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    res.json({ runId, annotations: globalReplayKnowledgeStore.listAnnotations(runId) });
  });

  // POST /api/collaboration/:collectionId/graph-overlay
  app.post('/api/collaboration/:collectionId/graph-overlay', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const { comments = [], ownershipClaims = [], knowledgeLinks = [] } = req.body ?? {};
    res.json(globalGraphCollaborationOverlayBuilder.build(collectionId, { comments, ownershipClaims, knowledgeLinks }));
  });
}
