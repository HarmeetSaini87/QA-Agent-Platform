import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../framework/config';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

const FIELDMAP_DIR = path.resolve('test-plans/fieldmaps');
if (!fs.existsSync(FIELDMAP_DIR)) fs.mkdirSync(FIELDMAP_DIR, { recursive: true });

const KEYWORD_REGISTRY: Record<string, string[]> = {
  'Navigation': ['LOGIN', 'NAVIGATE', 'OPEN FORM', 'BACK'],
  'Form Interaction': ['FILL', 'SELECT', 'CHECK', 'UNCHECK', 'CLICK RADIO', 'ADD ROW'],
  'Flow Control': ['SAVE', 'SEARCH', 'DELETE', 'CONFIRM DELETE', 'VERIFY DELETED', 'VERIFY'],
  'Session': ['LOGOUT', 'SCREENSHOT'],
};

export function registerTcRoutes(app: express.Application): void {
  app.get('/api/keywords', (_req: Request, res: Response) => { res.json(KEYWORD_REGISTRY); });

  app.get('/api/tc/list', (_req: Request, res: Response) => {
    const dir = config.paths.testPlans;
    if (!fs.existsSync(dir)) { res.json([]); return; }
    const list = fs.readdirSync(dir).filter(f => f.endsWith('-builder-plan.json')).map(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        return { planId: raw.planId, planPath: path.join(dir, f), fieldMap: raw.fieldMap ?? [], testCases: (raw.testCases ?? []).map((tc: any) => ({ id: tc.id, title: tc.title, module: tc.module, priority: tc.priority })) };
      } catch { return null; }
    }).filter(Boolean);
    res.json(list);
  });

  app.get('/api/tc/:planId', (req: Request, res: Response) => {
    const f = path.join(config.paths.testPlans, `${req.params.planId}-builder-plan.json`);
    if (!fs.existsSync(f)) { res.status(404).json({ error: 'Not found' }); return; }
    try { res.json(JSON.parse(fs.readFileSync(f, 'utf-8'))); } catch { res.status(500).json({ error: 'Could not read plan' }); }
  });

  app.post('/api/tc/save', (req: Request, res: Response) => {
    const { tc, fieldMap } = req.body as { tc?: any; fieldMap?: any[] };
    if (!tc?.id) { res.status(400).json({ error: 'tc.id is required' }); return; }
    const planId = `plan-${crypto.createHash('md5').update(tc.id + (tc.module ?? '') + Date.now()).digest('hex').slice(0, 8)}`;
    const steps = (tc.steps as any[] ?? []).map((s: any, i: number) => {
      const kw = (s.keyword ?? '').trim(); const det = (s.detail ?? s.label ?? '').trim(); const mod = (s.modifier ?? '').trim();
      const desc = [mod, kw, det ? ': ' + det : ''].filter(Boolean).join(' ').trim();
      const inlineSelector = (s.selector ?? '').trim() || null; const inlineFieldType = (s.fieldType ?? '').trim() || null; const inlineLabel = (s.label ?? '').trim() || null;
      const fm = inlineSelector ? null : (fieldMap ?? []).find((f: any) => f.uiLabel === det);
      return { stepNumber: i + 1, action: kw.toLowerCase().replace(/\s+/g, '_'), description: desc, selector: inlineSelector ?? fm?.selector ?? null, fieldType: inlineFieldType ?? fm?.fieldType ?? null, fieldLabel: inlineLabel ?? fm?.uiLabel ?? null, value: (s.value ?? '').trim() || null, fallbackSelectors: [] };
    });
    const testData: Record<string, string> = { Username: tc.username ?? '', Password: tc.password ?? '', 'Record Name': tc.recordName ?? '', ...(tc.testData ?? {}) };
    const plan = { planId, createdAt: new Date().toISOString(), source: 'builder', sourceRef: tc.id, appBaseURL: (tc.appURL ?? '').trim() || process.env.APP_BASE_URL || config.app.baseURL || '', fieldMap: fieldMap ?? [], testCases: [{ id: tc.id, title: tc.title ?? '', module: tc.module ?? '', priority: (tc.priority ?? 'medium').toLowerCase(), preconditions: tc.preconditions ?? '', steps, expectedResult: tc.expectedResult ?? '', testData, tags: (tc.tags ?? '').split(',').map((t: string) => t.trim()).filter(Boolean) }] };
    const planFile = path.join(config.paths.testPlans, `${planId}-builder-plan.json`);
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
    if ((fieldMap ?? []).length && tc.module) { const safe = (tc.module as string).replace(/[^a-zA-Z0-9\-]/g, '_'); fs.writeFileSync(path.join(FIELDMAP_DIR, `${safe}.json`), JSON.stringify(fieldMap, null, 2)); }
    logger.info(`TC Builder: saved ${tc.id} → ${planFile}`);
    res.json({ success: true, planId, planPath: planFile, testCases: [{ id: tc.id, title: tc.title, module: tc.module }] });
  });

  app.delete('/api/tc/:planId', (req: Request, res: Response) => {
    const f = path.join(config.paths.testPlans, `${req.params.planId}-builder-plan.json`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    res.json({ success: true });
  });

  app.get('/api/fieldmap/:module', (req: Request, res: Response) => {
    const safe = req.params.module.replace(/[^a-zA-Z0-9\-]/g, '_');
    const f = path.join(FIELDMAP_DIR, `${safe}.json`);
    res.json(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : []);
  });

  app.post('/api/fieldmap/:module', (req: Request, res: Response) => {
    const safe = req.params.module.replace(/[^a-zA-Z0-9\-]/g, '_');
    fs.writeFileSync(path.join(FIELDMAP_DIR, `${safe}.json`), JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  });
}