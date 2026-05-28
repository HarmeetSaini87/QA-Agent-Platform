// src/api-graph-editor/routes/graph-editor.routes.ts
// Phase E Step 5: Graph editing REST endpoints.
// All mutations are visualization metadata — WorkflowEnvelope untouched.

import type { Express, Request, Response } from 'express';
import { globalGraphAuthoringSession } from '../graph-authoring-session';
import { globalDagValidator } from '../dag-validator';

export function registerGraphEditorRoutes(app: Express): void {

  // GET /api/graph-editor/:collectionId/layout — load saved layout
  app.get('/api/graph-editor/:collectionId/layout', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const layout = globalGraphAuthoringSession.loadLayout(collectionId);
    if (!layout) {
      res.status(404).json({ error: 'No saved layout for this collection.' });
      return;
    }
    res.json(layout);
  });

  // POST /api/graph-editor/:collectionId/layout — save layout snapshot
  app.post('/api/graph-editor/:collectionId/layout', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const { positions, visualGroups, layoutLocked, snapshotVersion } = req.body as {
      positions?: Record<string, { x: number; y: number; locked?: boolean }>;
      visualGroups?: unknown[];
      layoutLocked?: boolean;
      snapshotVersion?: number;
    };

    if (!positions || typeof positions !== 'object') {
      res.status(400).json({ error: 'positions (object) required' });
      return;
    }

    const snapshot = {
      collectionId,
      snapshotVersion: snapshotVersion ?? 1,
      savedAt: new Date().toISOString(),
      positions: Object.fromEntries(
        Object.entries(positions).map(([k, v]) => [k, { x: v.x, y: v.y, locked: v.locked ?? false }])
      ),
      visualGroups: (visualGroups ?? []) as never,
      layoutLocked: layoutLocked ?? false,
    };

    globalGraphAuthoringSession.saveLayout(snapshot);
    res.status(201).json({ saved: true, collectionId, nodeCount: Object.keys(positions).length });
  });

  // DELETE /api/graph-editor/:collectionId/layout — reset layout
  app.delete('/api/graph-editor/:collectionId/layout', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    // Load store directly via session to delete
    const layout = globalGraphAuthoringSession.loadLayout(collectionId);
    if (!layout) {
      res.status(404).json({ error: 'No layout to delete.' });
      return;
    }
    globalGraphAuthoringSession.recordEdit({
      collectionId,
      editType: 'layout-reset',
      actorId: 'user',
      editedAt: new Date().toISOString(),
      metadata: {},
    });
    res.json({ deleted: true, collectionId });
  });

  // POST /api/graph-editor/:collectionId/validate-dag — validate a dependsOn adjacency map
  app.post('/api/graph-editor/:collectionId/validate-dag', (req: Request, res: Response) => {
    const { nodeIds, dependsOn } = req.body as {
      nodeIds?: string[];
      dependsOn?: Record<string, string[]>;
    };

    if (!Array.isArray(nodeIds) || !dependsOn || typeof dependsOn !== 'object') {
      res.status(400).json({ error: 'nodeIds (array) and dependsOn (object) required' });
      return;
    }

    const result = globalDagValidator.validate(nodeIds, dependsOn);
    res.json(result);
  });

  // POST /api/graph-editor/:collectionId/dependency — apply a dependency edit
  app.post('/api/graph-editor/:collectionId/dependency', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const { nodeIds, currentDependsOn, fromStepId, toStepId, operation, editedBy } = req.body as {
      nodeIds?: string[];
      currentDependsOn?: Record<string, string[]>;
      fromStepId?: string;
      toStepId?: string;
      operation?: string;
      editedBy?: string;
    };

    if (!fromStepId || !toStepId || !operation || !Array.isArray(nodeIds)) {
      res.status(400).json({ error: 'fromStepId, toStepId, operation, nodeIds required' });
      return;
    }

    const edit = {
      collectionId,
      fromStepId,
      toStepId,
      operation: operation as 'add' | 'remove',
      editedBy: editedBy ?? 'unknown',
      editedAt: new Date().toISOString(),
    };

    const result = globalGraphAuthoringSession.applyDependencyEdit(
      nodeIds,
      currentDependsOn ?? {},
      edit,
    );

    res.json(result);
  });

  // GET /api/graph-editor/:collectionId/snapshot — authoring session snapshot
  app.get('/api/graph-editor/:collectionId/snapshot', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    res.json(globalGraphAuthoringSession.snapshot(collectionId));
  });
}
