import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { readAll, upsert, findById, remove, FUNCTIONS } from '../../data/store';
import type { CommonFunction } from '../../data/types';
import { requireEditor, sanitizeInput } from '../../auth/middleware';

export function registerFunctionsRoutes(app: express.Application): void {
  app.get('/api/functions', (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    const all = readAll<CommonFunction>(FUNCTIONS);
    if (projectId) { res.json(all.filter(f => f.projectId === projectId)); } else { res.json(all); }
  });

  app.post('/api/functions', requireEditor, (req: Request, res: Response) => {
    const { name, identifier, description, steps, projectId } = req.body as any;
    if (!name) { res.status(400).json({ error: 'Function name is required' }); return; }
    if (!identifier) { res.status(400).json({ error: 'Identifier is required' }); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(identifier)) { res.status(400).json({ error: 'Identifier must be alphanumeric and underscores only' }); return; }
    if (!steps?.length) { res.status(400).json({ error: 'At least one step is required' }); return; }
    const existing = readAll<CommonFunction>(FUNCTIONS);
    if (existing.find(f => f.identifier === identifier.trim() && f.projectId === (projectId ?? null))) { res.status(409).json({ error: `Identifier "${identifier}" already exists in this project` }); return; }
    const fn: CommonFunction = { id: uuidv4(), projectId: projectId ?? null, name: sanitizeInput(name), identifier: identifier.trim(), description: sanitizeInput(description ?? ''), steps, createdBy: req.session.username!, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    upsert(FUNCTIONS, fn); res.json({ success: true, id: fn.id });
  });

  app.put('/api/functions/:id', requireEditor, (req: Request, res: Response) => {
    const fn = findById<CommonFunction>(FUNCTIONS, req.params.id);
    if (!fn) { res.status(404).json({ error: 'Not found' }); return; }
    const { name, identifier, description, steps, projectId } = req.body as any;
    if (identifier) { if (!/^[a-zA-Z0-9_]+$/.test(identifier)) { res.status(400).json({ error: 'Identifier must be alphanumeric and underscores only' }); return; } const existing = readAll<CommonFunction>(FUNCTIONS); const conflict = existing.find(f => f.identifier === identifier.trim() && f.projectId === fn.projectId && f.id !== fn.id); if (conflict) { res.status(409).json({ error: `Identifier "${identifier}" already exists in this project` }); return; } fn.identifier = identifier.trim(); }
    if (name) fn.name = sanitizeInput(name); if (description !== undefined) fn.description = sanitizeInput(description); if (projectId !== undefined) fn.projectId = projectId; if (steps) fn.steps = steps;
    fn.updatedAt = new Date().toISOString(); upsert(FUNCTIONS, fn); res.json({ success: true });
  });

  app.delete('/api/functions/:id', requireEditor, (req: Request, res: Response) => {
    const removed = remove(FUNCTIONS, req.params.id); if (!removed) { res.status(404).json({ error: 'Not found' }); return; } res.json({ success: true });
  });
}