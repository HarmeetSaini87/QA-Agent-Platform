import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { readAll, writeAll, findById, upsert, remove, SCRIPTS, PROJECTS, LOCATORS, SUITES } from '../../data/store';
import type { TestScript, ScriptStep, Locator, Project } from '../../data/types';
import { requireAuth, requireEditor, sanitizeInput } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';

function finaliseDraftLocators(steps: ScriptStep[], projectId: string): ScriptStep[] {
  const allLocs = readAll<Locator>(LOCATORS);
  const finalized = allLocs.filter(l => l.projectId === projectId && !l.draft);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  return steps.map(step => {
    if (!step.locatorId) return step;
    const draft = allLocs.find(l => l.id === step.locatorId && l.draft);
    if (!draft) return step;

    const bySelector = finalized.find(l => norm(l.selector) === norm(draft.selector));
    if (bySelector) {
      writeAll(LOCATORS, allLocs.filter(l => l.id !== draft.id));
      return { ...step, locatorId: bySelector.id, locatorName: bySelector.name, locator: bySelector.selector, locatorType: bySelector.selectorType } as ScriptStep;
    }

    const byName = finalized.find(l => norm(l.name) === norm(draft.name));
    if (byName) {
      writeAll(LOCATORS, allLocs.filter(l => l.id !== draft.id));
      return { ...step, locatorId: byName.id, locatorName: byName.name, locator: byName.selector, locatorType: byName.selectorType } as ScriptStep;
    }

    draft.draft = false;
    draft.updatedAt = new Date().toISOString();
    upsert(LOCATORS, draft);
    finalized.push(draft);
    return step;
  });
}

export function registerScriptsRoutes(app: express.Application): void {
  app.get('/api/scripts', (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
    res.json(readAll<TestScript>(SCRIPTS).filter(s => s.projectId === projectId));
  });

  app.get('/api/scripts/:id', (req: Request, res: Response) => {
    const s = findById<TestScript>(SCRIPTS, req.params.id);
    if (!s) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(s);
  });

  app.post('/api/scripts', requireEditor, (req: Request, res: Response) => {
    const body = req.body as Partial<TestScript> & { recorderToken?: string };
    if (!body.projectId || !body.title) { res.status(400).json({ error: 'projectId and title required' }); return; }

    const proj = findById<Project>(PROJECTS, body.projectId);
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    if (!proj.tcIdCounter) proj.tcIdCounter = 1;
    const tcId = `${proj.tcIdPrefix || 'TC'}-${String(proj.tcIdCounter).padStart(2, '0')}`;
    proj.tcIdCounter += 1;
    upsert(PROJECTS, proj);

    const resolvedSteps = finaliseDraftLocators(body.steps ?? [], body.projectId);

    const now = new Date().toISOString();
    const script: TestScript = {
      id: uuidv4(), projectId: body.projectId,
      tcId,
      component: sanitizeInput(body.component ?? ''),
      subcomponent: body.subcomponent ? sanitizeInput(body.subcomponent) : undefined,
      title: sanitizeInput(body.title),
      description: sanitizeInput(body.description ?? ''), tags: body.tags ?? [],
      priority: body.priority ?? 'medium', steps: resolvedSteps,
      createdBy: req.session.username!, createdAt: now,
      modifiedBy: req.session.username!, modifiedAt: now,
    };
    upsert(SCRIPTS, script);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_CREATED', resourceType: 'script', resourceId: script.id, details: `${tcId} ${script.title}`, ip: req.ip ?? null });
    if (body.recorderToken) {
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RECORDER_SAVED', resourceType: 'script', resourceId: script.id, details: `${tcId} ${script.title} steps=${resolvedSteps.length} token=${String(body.recorderToken).slice(0, 8)}`, ip: req.ip ?? null });
    }
    res.json({ success: true, id: script.id, tcId });
  });

  app.put('/api/scripts/:id', requireEditor, (req: Request, res: Response) => {
    const script = findById<TestScript>(SCRIPTS, req.params.id);
    if (!script) { res.status(404).json({ error: 'Not found' }); return; }
    const body = req.body as Partial<TestScript> & { recorderToken?: string };
    if (body.title) script.title = sanitizeInput(body.title);
    if (body.description !== undefined) script.description = sanitizeInput(body.description);
    if (body.component !== undefined) script.component = sanitizeInput(body.component);
    if (body.subcomponent !== undefined) script.subcomponent = sanitizeInput(body.subcomponent);
    if (body.tags) script.tags = body.tags;
    if (body.priority) script.priority = body.priority;
    if (body.steps) script.steps = finaliseDraftLocators(body.steps, script.projectId ?? '');
    script.modifiedBy = req.session.username!;
    script.modifiedAt = new Date().toISOString();
    upsert(SCRIPTS, script);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_UPDATED', resourceType: 'script', resourceId: script.id, details: script.title, ip: req.ip ?? null });
    if (body.recorderToken) {
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RECORDER_SAVED', resourceType: 'script', resourceId: script.id, details: `${script.title} steps=${script.steps.length} token=${String(body.recorderToken).slice(0, 8)}`, ip: req.ip ?? null });
    }
    res.json({ success: true });
  });

  // OLD: /api/scripts/:id was registered before /bulk — Express matched "bulk" as an id, silently no-oping bulk deletes
  app.delete('/api/scripts/bulk', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids array required' }); return; }
    const deleted: string[] = [];
    for (const id of ids) {
      const existing = findById<TestScript>(SCRIPTS, id);
      if (!existing) continue;
      remove(SCRIPTS, id);
      deleted.push(id);
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_DELETED', resourceType: 'script', resourceId: id, details: `bulk delete`, ip: req.ip ?? null });
    }
    res.json({ deleted, count: deleted.length });
  });

  app.delete('/api/scripts/:id', requireEditor, (req: Request, res: Response) => {
    remove(SCRIPTS, req.params.id);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_DELETED', resourceType: 'script', resourceId: req.params.id, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.patch('/api/scripts/bulk', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { ids, patch } = req.body as { ids?: string[]; patch?: Partial<Pick<TestScript, 'priority' | 'tags' | 'component'>> };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids array required' }); return; }
    if (!patch || Object.keys(patch).length === 0) { res.status(400).json({ error: 'patch object required' }); return; }
    const updated: string[] = [];
    const all = readAll<TestScript>(SCRIPTS);
    for (const script of all) {
      if (!ids.includes(script.id)) continue;
      if (patch.priority) script.priority = patch.priority;
      if (patch.tags) script.tags = patch.tags;
      if (patch.component !== undefined) script.component = patch.component;
      script.modifiedBy = req.session.username ?? 'unknown';
      script.modifiedAt = new Date().toISOString();
      updated.push(script.id);
    }
    writeAll(SCRIPTS, all);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPTS_BULK_UPDATED', resourceType: 'script', resourceId: null, details: `${updated.length} scripts patched`, ip: req.ip ?? null });
    res.json({ updated, count: updated.length });
  });

  app.post('/api/scripts/:id/clone', requireAuth, requireEditor, (req: Request, res: Response) => {
    try {
      const scripts = readAll<TestScript>(SCRIPTS);
      const source = scripts.find(s => s.id === req.params.id) ?? null;
      if (!source) { res.status(404).json({ error: 'Script not found' }); return; }

      const projects = readAll<Project>(PROJECTS);
      const proj = projects.find(p => p.id === source.projectId);
      if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }

      if (!proj.tcIdCounter) proj.tcIdCounter = 1;
      const tcId = `${proj.tcIdPrefix || 'TC'}-${String(proj.tcIdCounter).padStart(2, '0')}`;
      proj.tcIdCounter += 1;

      const now = new Date().toISOString();
      const clone: TestScript = JSON.parse(JSON.stringify(source));
      clone.id = uuidv4();
      clone.tcId = tcId;
      clone.title = `Copy of ${source.title}`;
      clone.createdAt = now;
      clone.modifiedAt = now;
      clone.createdBy = req.session.username!;
      clone.modifiedBy = req.session.username!;
      clone.steps = clone.steps.map((s: ScriptStep) => ({ ...s, id: uuidv4() }));

      writeAll(PROJECTS, projects.map(p => p.id === proj.id ? proj : p));
      writeAll(SCRIPTS, [...scripts, clone]);

      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_CLONED', resourceType: 'script', resourceId: clone.id, details: `${source.tcId} → ${tcId} Copy of ${source.title}`, ip: req.ip ?? null });
      res.json({ success: true, id: clone.id, tcId });
    } catch {
      res.status(500).json({ error: 'Failed to clone script' });
    }
  });

  app.post('/api/scripts/bulk-suite', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { ids, suiteId } = req.body as { ids?: string[]; suiteId?: string };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids array required' }); return; }
    if (!suiteId) { res.status(400).json({ error: 'suiteId required' }); return; }
    const allSuites = readAll<TestScript>(SUITES);
    const suite = allSuites.find((s: any) => s.id === suiteId) as any;
    if (!suite) { res.status(404).json({ error: 'Suite not found' }); return; }
    const existing = new Set(suite.scriptIds);
    const added: string[] = [];
    for (const id of ids) {
      if (!existing.has(id)) { suite.scriptIds.push(id); added.push(id); }
    }
    writeAll(SUITES, allSuites);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPTS_BULK_ADDED_TO_SUITE', resourceType: 'suite', resourceId: suiteId, details: `${added.length} scripts added`, ip: req.ip ?? null });
    res.json({ added, count: added.length, suiteId });
  });
}