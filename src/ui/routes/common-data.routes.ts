import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { readAll, upsert, remove, findById, COMMON_DATA } from '../../data/store';
import type { CommonData } from '../../data/types';
import { requireAuth, requireEditor, sanitizeInput } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { encryptValue, decryptValue, cdForResponse } from '../helpers/encryption';

export function registerCommonDataRoutes(app: express.Application): void {
  app.get('/api/common-data', requireAuth, (req: Request, res: Response) => {
    const { projectId, environment, moduleType } = req.query as Record<string, string>;
    let all = readAll<CommonData>(COMMON_DATA);
    // back-compat: records without moduleType default to 'shared'
    all = all.map(d => ({ ...d, moduleType: d.moduleType ?? 'shared' }));
    if (projectId) all = all.filter(d => d.projectId === projectId);
    if (environment) all = all.filter(d => d.environment === environment);
    if (moduleType) all = all.filter(d => d.moduleType === moduleType);
    return res.json(all.map(cdForResponse));
  });

  app.post('/api/common-data', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { projectId, dataName, value, environment, sensitive, moduleType } = req.body as Partial<CommonData> & { sensitive?: boolean };
    if (!projectId || !dataName || !environment) { res.status(400).json({ error: 'projectId, dataName and environment are required' }); return; }
    const existing = readAll<CommonData>(COMMON_DATA);
    if (existing.find(d => d.projectId === projectId && d.dataName === dataName && d.environment === environment)) { res.status(409).json({ error: `"${dataName}" already exists for ${environment}` }); return; }
    const isSensitive = sensitive === true;
    const storedValue = isSensitive ? encryptValue(value ?? '') : (value ?? '');
    const now = new Date().toISOString();
    const validModuleTypes = ['ui', 'api', 'shared'] as const;
    const resolvedModuleType = validModuleTypes.includes(moduleType as any) ? (moduleType as CommonData['moduleType']) : 'shared';
    const record: CommonData = { id: uuidv4(), projectId, dataName: sanitizeInput(dataName), value: storedValue, environment, moduleType: resolvedModuleType, sensitive: isSensitive, createdBy: req.session.username!, createdAt: now, updatedAt: now };
    upsert(COMMON_DATA, record);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_CREATED', resourceType: 'common_data', resourceId: record.id, details: record.dataName, ip: req.ip ?? null });
    res.json({ success: true, id: record.id });
  });

  app.put('/api/common-data/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    const record = findById<CommonData>(COMMON_DATA, req.params.id);
    if (!record) { res.status(404).json({ error: 'Not found' }); return; }
    const { dataName, value, environment, sensitive, moduleType } = req.body as Partial<CommonData> & { sensitive?: boolean };
    if (dataName) record.dataName = sanitizeInput(dataName);
    if (environment) record.environment = environment;
    if (sensitive !== undefined) record.sensitive = sensitive;
    const validModuleTypes = ['ui', 'api', 'shared'] as const;
    if (moduleType && validModuleTypes.includes(moduleType as any)) record.moduleType = moduleType as CommonData['moduleType'];
    if (value !== undefined) { if (value !== '••••••••') { record.value = record.sensitive ? encryptValue(value) : value; } }
    record.updatedAt = new Date().toISOString(); upsert(COMMON_DATA, record);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_UPDATED', resourceType: 'common_data', resourceId: record.id, details: record.dataName, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.get('/api/common-data/:id/reveal', requireAuth, (req: Request, res: Response) => {
    const record = findById<CommonData>(COMMON_DATA, req.params.id);
    if (!record) { res.status(404).json({ error: 'Not found' }); return; }
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_REVEALED', resourceType: 'common_data', resourceId: record.id, details: record.dataName, ip: req.ip ?? null });
    res.json({ value: record.sensitive ? decryptValue(record.value) : record.value });
  });

  app.delete('/api/common-data/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    remove(COMMON_DATA, req.params.id);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_DELETED', resourceType: 'common_data', resourceId: req.params.id, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.post('/api/common-data/resolve', requireAuth, (req: Request, res: Response) => {
    const { projectId, environment, text } = req.body as { projectId: string; environment: string; text: string };
    if (!projectId || !environment || !text) { res.status(400).json({ error: 'projectId, environment and text required' }); return; }
    const dataMap: Record<string, string> = {};
    readAll<CommonData>(COMMON_DATA).filter(d => d.projectId === projectId && d.environment === environment).forEach(d => { dataMap[d.dataName] = d.sensitive ? decryptValue(d.value) : d.value; });
    const resolved = text.replace(/\$\{([^}]+)\}/g, (_, name) => dataMap[name] ?? `\${${name}}`);
    res.json({ resolved, dataMap });
  });
}