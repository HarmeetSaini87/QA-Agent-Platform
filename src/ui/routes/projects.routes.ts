import express, { Request, Response } from 'express';
import * as path from 'path';
import { config } from '../../framework/config';
import { readAll, upsert, findById, remove, writeAll, LOCATORS, PROJECTS, COMPONENTS, SCRIPTS, FUNCTIONS } from '../../data/store';
import type { Locator, Project, ProjectEnvironment, ComponentDef, Subcomponent, TestScript, CommonFunction } from '../../data/types';
import { requireAuth, requireAdmin, requireEditor, sanitizeInput } from '../../auth/middleware';
import { getLicensePayload } from '../../utils/licenseManager';
import { logAudit } from '../../auth/audit';
import { v4 as uuidv4 } from 'uuid';

// NOTE: This file contains the Projects, Locators, and Components route handlers.
// The full implementations are in server.ts.routes-backup lines 3334-3542.

export function registerProjectsRoutes(app: express.Application): void {
  app.get('/api/projects', (req: Request, res: Response) => { res.json(readAll<Project>('projects').filter(p => p.isActive)); });
  app.get('/api/projects/all', requireAdmin, (_req, res) => { res.json(readAll<Project>('projects')); });
  app.post('/api/projects', requireAdmin, (req: Request, res: Response) => {
    const { name, description, tcIdPrefix, environments, jiraProjectKey } = req.body as any;
    if (!name) { res.status(400).json({ error: 'Project name is required' }); return; }
    const existing = readAll<Project>('projects'); if (existing.find(p => p.name === name.trim())) { res.status(409).json({ error: 'Project name already exists' }); return; }
    // Enforce maxProjects license gate
    const licPayload = getLicensePayload();
    const maxProjects = licPayload?.features?.maxProjects ?? -1;
    if (maxProjects !== -1) {
      const activeCount = existing.filter(p => p.isActive).length;
      if (activeCount >= maxProjects) {
        res.status(403).json({ error: `Project limit reached. Your license allows ${maxProjects} project${maxProjects === 1 ? '' : 's'}.` });
        return;
      }
    }
    const normJiraKey = jiraProjectKey ? String(jiraProjectKey).trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : undefined;
    const project: Project = { id: uuidv4(), name: sanitizeInput(name), description: sanitizeInput(description ?? ''), tcIdPrefix: sanitizeInput(tcIdPrefix || 'TC'), tcIdCounter: 1, environments: (environments ?? []) as ProjectEnvironment[], isActive: true, createdAt: new Date().toISOString(), createdBy: req.session.username!, ...(normJiraKey ? { jiraProjectKey: normJiraKey } : {}) };
    upsert('projects', project); logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'PROJECT_CREATED', resourceType: 'project', resourceId: project.id, details: project.name, ip: req.ip ?? null });
    res.json({ success: true, id: project.id });
  });
  app.put('/api/projects/:id', requireAdmin, (req: Request, res: Response) => {
    const project = findById<Project>('projects', req.params.id); if (!project) { res.status(404).json({ error: 'Not found' }); return; }
    const { name, description, tcIdPrefix, environments, isActive, jiraProjectKey } = req.body as any;
    if (name) project.name = sanitizeInput(name); if (description !== undefined) project.description = sanitizeInput(description); if (tcIdPrefix) project.tcIdPrefix = sanitizeInput(tcIdPrefix); if (environments) project.environments = environments; if (isActive !== undefined) project.isActive = !!isActive;
    if (jiraProjectKey !== undefined) project.jiraProjectKey = jiraProjectKey ? String(jiraProjectKey).trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || undefined : undefined;
    upsert('projects', project); logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'PROJECT_UPDATED', resourceType: 'project', resourceId: project.id, details: project.name, ip: req.ip ?? null }); res.json({ success: true });
  });
  app.post('/api/projects/:id/next-tc-id', requireAuth, (req: Request, res: Response) => {
    const project = findById<Project>('projects', req.params.id); if (!project) { res.status(404).json({ error: 'Not found' }); return; }
    if (!project.tcIdCounter) project.tcIdCounter = 1; const num = String(project.tcIdCounter).padStart(2, '0'); const nextId = `${project.tcIdPrefix || 'TC'}-${num}`; project.tcIdCounter += 1;
    upsert('projects', project); res.json({ tcId: nextId });
  });
  app.delete('/api/projects/:id', requireAdmin, (req: Request, res: Response) => {
    const removed = remove('projects', req.params.id); if (!removed) { res.status(404).json({ error: 'Not found' }); return; }
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'PROJECT_DELETED', resourceType: 'project', resourceId: req.params.id, details: null, ip: req.ip ?? null }); res.json({ success: true });
  });

  // Locators
  app.get('/api/locators', (req: Request, res: Response) => { const { projectId, includeDraft } = req.query as { projectId?: string; includeDraft?: string }; if (!projectId) { res.json([]); return; } const all = readAll<Locator>(LOCATORS).filter(l => l.projectId === projectId); res.json(includeDraft === 'true' ? all : all.filter(l => !l.draft)); });
  app.post('/api/locators', requireEditor, (req: Request, res: Response) => {
    const { name, selector, selectorType, pageModule, projectId, description } = req.body as any;
    if (!name || !selector) { res.status(400).json({ error: 'name and selector are required' }); return; }
    const loc: Locator = { id: uuidv4(), name: sanitizeInput(name), selector: sanitizeInput(selector), selectorType: selectorType ?? 'css', pageModule: sanitizeInput(pageModule ?? ''), projectId: projectId ?? null, description: sanitizeInput(description ?? ''), createdBy: req.session.username!, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    upsert(LOCATORS, loc); res.json({ success: true, id: loc.id });
  });
  app.put('/api/locators/:id', requireEditor, (req: Request, res: Response) => {
    const loc = findById<Locator>(LOCATORS, req.params.id); if (!loc) { res.status(404).json({ error: 'Not found' }); return; }
    const { name, selector, selectorType, pageModule, projectId, description, alternatives, draft } = req.body as any;
    if (name) { loc.name = sanitizeInput(name); loc.nameSource = 'user'; loc.updatedBy = (req as any).session?.username ?? 'unknown'; } if (selector) loc.selector = sanitizeInput(selector); if (selectorType) loc.selectorType = selectorType; if (pageModule !== undefined) loc.pageModule = sanitizeInput(pageModule); if (projectId !== undefined) loc.projectId = projectId; if (description !== undefined) loc.description = sanitizeInput(description); if (Array.isArray(alternatives)) loc.alternatives = alternatives; if (draft === false) loc.draft = false;
    loc.updatedAt = new Date().toISOString(); upsert(LOCATORS, loc); res.json({ success: true });
  });
  function cleanupOrphanedLocatorReferences(locatorIds: string[]) {
    if (!locatorIds.length) return;
    const scripts = readAll<TestScript>('scripts'); let scriptsChanged = false;
    scripts.forEach(script => { (script.steps || []).forEach(step => { if (step.locatorId && locatorIds.includes(step.locatorId)) { step.locatorId = null; step.locator = null; step.locatorType = ""; scriptsChanged = true; } }); });
    if (scriptsChanged) writeAll('scripts', scripts);
    const allLocs = readAll<Locator>(LOCATORS); const locsBeingDeleted = allLocs.filter(l => locatorIds.includes(l.id)); const deletedNames = new Set(locsBeingDeleted.map(l => l.name.trim().toLowerCase()));
    const functions = readAll<CommonFunction>('functions'); let functionsChanged = false;
    functions.forEach(fn => { (fn.steps || []).forEach(step => { if (step.locatorName && deletedNames.has(step.locatorName.trim().toLowerCase())) { step.locatorName = null; step.selector = null; step.locatorType = ""; functionsChanged = true; } }); });
    if (functionsChanged) writeAll('functions', functions);
  }
  app.delete('/api/locators/:id', requireEditor, (req: Request, res: Response) => { cleanupOrphanedLocatorReferences([req.params.id]); const removed = remove(LOCATORS, req.params.id); if (!removed) { res.status(404).json({ error: 'Not found' }); return; } res.json({ success: true }); });
  app.post('/api/locators/bulk-delete', requireEditor, (req: Request, res: Response) => {
    const { ids } = req.body as { ids?: string[] }; if (!ids || !Array.isArray(ids)) { res.status(400).json({ error: 'ids array is required' }); return; }
    cleanupOrphanedLocatorReferences(ids); let count = 0; ids.forEach(id => { if (remove(LOCATORS, id)) count++; });
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'LOCATORS_BULK_DELETE', resourceType: 'locator', resourceId: 'multiple', details: `Deleted ${count} locators`, ip: req.ip ?? null }); res.json({ success: true, count });
  });

  // Components
  app.get('/api/projects/:projectId/components', (req: Request, res: Response) => { res.json(readAll<ComponentDef>('components').filter(c => c.projectId === req.params.projectId)); });
  app.post('/api/projects/:projectId/components', requireEditor, (req: Request, res: Response) => {
    const { projectId } = req.params; const { name } = req.body as { name?: string }; if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
    const comp: ComponentDef = { id: uuidv4(), projectId, name: sanitizeInput(name.trim()), subcomponents: [], createdAt: new Date().toISOString() };
    upsert('components', comp); res.json({ success: true, id: comp.id, comp });
  });
  app.put('/api/projects/:projectId/components/:compId', requireEditor, (req: Request, res: Response) => {
    const comp = findById<ComponentDef>('components', req.params.compId); if (!comp || comp.projectId !== req.params.projectId) { res.status(404).json({ error: 'Not found' }); return; }
    const { name, subcomponents } = req.body as { name?: string; subcomponents?: Subcomponent[] }; if (name !== undefined) comp.name = sanitizeInput(name.trim()); if (subcomponents !== undefined) comp.subcomponents = subcomponents;
    upsert('components', comp); res.json({ success: true, comp });
  });
  app.delete('/api/projects/:projectId/components/:compId', requireEditor, (req: Request, res: Response) => {
    const comp = findById<ComponentDef>('components', req.params.compId); if (!comp || comp.projectId !== req.params.projectId) { res.status(404).json({ error: 'Not found' }); return; }
    remove('components', req.params.compId); res.json({ success: true });
  });
}