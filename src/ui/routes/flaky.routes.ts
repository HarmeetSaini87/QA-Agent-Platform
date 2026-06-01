import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { readAll, writeAll, SUITES, PROJECTS } from '../../data/store';
import type { TestSuite, Project } from '../../data/types';
import type { RunRecord } from '../helpers/types';
import { requireAuth, requireAuthOrApiKey, requireEditor } from '../../auth/middleware';
import { requireFeature } from '../helpers/middleware';
import { config } from '../../framework/config';
import { readQuarantine, writeQuarantine, restoreQuarantineEntry, getEffectiveFlakinessConfig } from '../helpers/quarantine';
import { analyzeFlakiness, DEFAULT_FLAKINESS_CONFIG, CURRENT_ENGINE_VERSION, getActionHint } from '../../utils/flakinessEngine';

export function registerFlakyRoutes(app: express.Application): void {
  app.get('/api/flaky', requireAuthOrApiKey, (req: Request, res: Response) => {
    const { projectId, suiteId } = req.query as Record<string, string>;
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);
    const sort = (req.query.sort as string) || 'flakeScore';

    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

    const resultsDir = config.paths.results;
    if (!fs.existsSync(resultsDir)) { res.json({ tests: [], total: 0 }); return; }

    const allRuns: RunRecord[] = fs.readdirSync(resultsDir)
      .filter((f: string) => f.startsWith('run-') && f.endsWith('.json'))
      .map((f: string) => { try { return JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf-8')); } catch { return null; } })
      .filter((r: any): r is RunRecord => !!r && r.projectId === projectId
        && (r.status === 'done' || r.status === 'failed')
        && (!suiteId || r.suiteId === suiteId));

    type AggEntry = {
      testId: string; testName: string; suiteId: string; suiteName: string;
      runs: Array<{ status: 'pass' | 'fail'; timestamp: number; durationMs: number; errorMessage?: string }>;
    };
    const map = new Map<string, AggEntry>();

    for (const run of allRuns) {
      for (const t of (run.tests ?? [])) {
        if (!t.testId || t.status === 'running') continue;
        const key = `${run.suiteId}::${t.testId}`;
        if (!map.has(key)) map.set(key, {
          testId: t.testId, testName: t.name,
          suiteId: run.suiteId ?? '', suiteName: (run as any).suiteName ?? '',
          runs: [],
        });
        map.get(key)!.runs.push({
          status: t.status === 'pass' ? 'pass' : 'fail',
          timestamp: new Date(run.startedAt).getTime(),
          durationMs: t.durationMs,
          errorMessage: t.errorMessage,
        });
      }
    }

    const quarantine = readQuarantine();

    const results = [...map.entries()].map(([key, agg]) => {
      const sid = agg.suiteId;
      const fCfg = suiteId
        ? getEffectiveFlakinessConfig(sid, projectId)
        : { ...DEFAULT_FLAKINESS_CONFIG };

      const qEntry = quarantine[key];
      const isQuarantined = qEntry?.status === 'active';

      const testRuns = agg.runs.map(r => ({
        testId: agg.testId, status: r.status,
        timestamp: r.timestamp, durationMs: r.durationMs, errorMessage: r.errorMessage
      }));

      const analysis = analyzeFlakiness(testRuns, fCfg, isQuarantined);

      const recentRunsPreview = agg.runs
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)
        .map(r => ({ status: r.status, timestamp: r.timestamp, durationMs: r.durationMs }))
        .reverse();

      const lastRunAt = agg.runs.reduce<typeof agg.runs[0] | undefined>((a, b) => !a || b.timestamp > a.timestamp ? b : a, undefined)?.timestamp;
      const lastFailureAt = agg.runs.filter(r => r.status === 'fail')
        .reduce<typeof agg.runs[0] | undefined>((a, b) => !a || b.timestamp > a.timestamp ? b : a, undefined)?.timestamp;

      const needsReevaluation = !!(qEntry && qEntry.scoreVersion !== CURRENT_ENGINE_VERSION);

      if (!analysis) {
        return {
          testId: agg.testId, testName: agg.testName, suiteId: sid, suiteName: agg.suiteName,
          evaluationState: 'insufficient_data' as const,
          isQuarantined, quarantineStatus: (qEntry?.status ?? 'none') as 'active' | 'restored' | 'none',
          quarantinedAt: qEntry?.quarantinedAt, autoQuarantined: qEntry?.autoQuarantined,
          needsReevaluation, recentRunsPreview,
          lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : undefined,
          lastFailureAt: lastFailureAt ? new Date(lastFailureAt).toISOString() : undefined,
        };
      }

      return {
        testId: agg.testId, testName: agg.testName, suiteId: sid, suiteName: agg.suiteName,
        evaluationState: 'evaluated' as const,
        flakeScore: analysis.flakeScore,
        failRate: analysis.failRate,
        alternationIndex: analysis.alternationIndex,
        varianceIndex: analysis.varianceIndex,
        confidence: analysis.confidence,
        isQuarantined,
        quarantineStatus: (qEntry?.status ?? 'none') as 'active' | 'restored' | 'none',
        quarantinedAt: qEntry?.quarantinedAt,
        autoQuarantined: qEntry?.autoQuarantined,
        shouldQuarantine: analysis.shouldQuarantine,
        shouldAutoPromote: analysis.shouldAutoPromote,
        decisionState: analysis.decisionState,
        needsReevaluation,
        classification: analysis.classification,
        dominantCategory: analysis.dominantCategory,
        dominantCategoryCount: analysis.dominantCategoryCount,
        dominantCategoryTotal: analysis.dominantCategoryTotal,
        actionHint: getActionHint(analysis.classification.primary),
        signals: analysis.signals,
        recentRunsPreview,
        lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : undefined,
        lastFailureAt: lastFailureAt ? new Date(lastFailureAt).toISOString() : undefined,
        evaluatedAt: analysis.evaluatedAt,
        scoreVersion: analysis.scoreVersion,
      };
    });

    const sortFns: Record<string, (a: any, b: any) => number> = {
      flakeScore: (a, b) => (b.flakeScore ?? -1) - (a.flakeScore ?? -1),
      confidence: (a, b) => (b.confidence ?? -1) - (a.confidence ?? -1),
      recentFailures: (a, b) => (b.signals?.recentFailCount ?? 0) - (a.signals?.recentFailCount ?? 0),
      name: (a, b) => a.testName.localeCompare(b.testName),
    };
    results.sort(sortFns[sort] ?? sortFns.flakeScore);

    const total = results.length;
    const paged = results.slice(offset, offset + limit);

    res.json({ tests: paged, total, offset, limit });
  });

  app.get('/api/flaky/summary', requireAuthOrApiKey, (req: Request, res: Response) => {
    const { projectId, suiteId } = req.query as Record<string, string>;
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

    const quarantine = readQuarantine();
    const allEntries = Object.values(quarantine)
      .filter(e => !suiteId || e.suiteId === suiteId);
    const quarantined = allEntries.filter(e => e.status === 'active').length;

    const fCfg = suiteId
      ? getEffectiveFlakinessConfig(suiteId, projectId)
      : DEFAULT_FLAKINESS_CONFIG;

    res.json({ quarantined, budgetLimit: fCfg.quarantineBudget });
  });

  app.get('/api/flaky/config', requireAuth, (req: Request, res: Response) => {
    const { projectId, suiteId } = req.query as Record<string, string>;
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

    const projects = readAll<Project>(PROJECTS);
    const suites = readAll<TestSuite>(SUITES);
    const project = projects.find(p => p.id === projectId);
    const suite = suiteId ? suites.find(s => s.id === suiteId) : undefined;

    const projectDefaults = (project as any)?.flakinessDefaults ?? {};
    const suiteOverrides = (suite as any)?.flakinessOverrides ?? {};
    const effective = { ...DEFAULT_FLAKINESS_CONFIG, ...projectDefaults, ...suiteOverrides };

    res.json({
      effective,
      projectDefaults,
      suiteOverrides: Object.keys(suiteOverrides).length ? suiteOverrides : null,
    });
  });

  app.put('/api/flaky/config', requireEditor, (req: Request, res: Response) => {
    const { projectId, suiteId, overrides } = req.body as
      { projectId: string; suiteId?: string; overrides: Partial<typeof DEFAULT_FLAKINESS_CONFIG> };

    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

    const errors: string[] = [];
    if (overrides?.threshold !== undefined && (overrides.threshold <= 0 || overrides.threshold > 1))
      errors.push('threshold must be in (0, 1]');
    if (overrides?.minRuns !== undefined && overrides.minRuns < 1)
      errors.push('minRuns must be >= 1');
    if (overrides?.windowDays !== undefined && overrides?.recentWindowDays !== undefined
      && overrides.windowDays <= overrides.recentWindowDays)
      errors.push('windowDays must be > recentWindowDays');
    if (overrides?.autoPromoteMinPassRate !== undefined &&
      (overrides.autoPromoteMinPassRate <= 0 || overrides.autoPromoteMinPassRate > 1))
      errors.push('autoPromoteMinPassRate must be in (0, 1]');
    if (overrides?.minRunsSinceQuarantine !== undefined && overrides.minRunsSinceQuarantine < 1)
      errors.push('minRunsSinceQuarantine must be >= 1');
    if (errors.length) { res.status(400).json({ errors }); return; }

    if (suiteId) {
      const allSuites = readAll<TestSuite>(SUITES);
      const suite = allSuites.find(s => s.id === suiteId);
      if (!suite) { res.status(404).json({ error: 'Suite not found' }); return; }
      (suite as any).flakinessOverrides = { ...((suite as any).flakinessOverrides ?? {}), ...overrides };
      writeAll(SUITES, allSuites.map(s => s.id === suiteId ? suite : s));
    } else {
      const allProjects = readAll<Project>(PROJECTS);
      const project = allProjects.find(p => p.id === projectId);
      if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
      (project as any).flakinessDefaults = { ...((project as any).flakinessDefaults ?? {}), ...overrides };
      writeAll(PROJECTS, allProjects.map(p => p.id === projectId ? project : p));
    }

    const effective = getEffectiveFlakinessConfig(suiteId ?? '', projectId);
    res.json({ ok: true, effective });
  });

  app.post('/api/flaky/quarantine', requireEditor, (req: Request, res: Response) => {
    const { suiteId, testId, testName, reason } = req.body as
      { suiteId: string; testId: string; testName?: string; reason?: string };
    if (!suiteId || !testId) { res.status(400).json({ error: 'suiteId and testId required' }); return; }

    const all = readQuarantine();
    const key = `${suiteId}::${testId}`;
    if (all[key]?.status === 'active') { res.json({ ok: true, alreadyQuarantined: true }); return; }

    all[key] = {
      suiteId, testId, testName: testName ?? testId,
      status: 'active',
      quarantinedAt: new Date().toISOString(),
      lastEvaluatedAt: new Date().toISOString(),
      lastNotifiedAt: null,
      restoredAt: null,
      manuallyRestoredAt: null,
      autoQuarantined: false,
      quarantineReason: reason ?? 'manual',
      scoreVersion: CURRENT_ENGINE_VERSION,
    };
    writeQuarantine(all);
    res.json({ ok: true });
  });

  app.post('/api/flaky/restore', requireEditor, (req: Request, res: Response) => {
    const { suiteId, testId } = req.body as { suiteId: string; testId: string };
    if (!suiteId || !testId) { res.status(400).json({ error: 'suiteId and testId required' }); return; }
    restoreQuarantineEntry(suiteId, testId, 'manual', true);
    res.json({ ok: true });
  });
}