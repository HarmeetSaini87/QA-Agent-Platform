import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../framework/config';
import { readAll, findById } from '../../data/store';
import type { RunRecord } from '../helpers/types';
import { requireAuth, requireAuthOrApiKey } from '../../auth/middleware';
import { runs, getRun } from '../helpers/state';
import { attachDefectInfo } from '../helpers/run-spawner';

export function registerRunsRoutes(app: express.Application): void {
  app.get('/api/run/:runId', (req: Request, res: Response) => {
    const record = getRun(req.params.runId);
    if (!record) { res.status(404).json({ error: 'Run not found' }); return; }
    const decorated = attachDefectInfo({ ...record, output: record.output.slice(-100) } as RunRecord);
    res.json(decorated);
  });

  app.get('/api/runs', (req: Request, res: Response) => {
    const filterProjectId = (req.query.projectId as string) || '';
    const allRuns: RunRecord[] = [...runs.values()];
    const dir = config.paths.results;
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith('run-') || !f.endsWith('.json')) continue;
        const id = f.slice(4, -5);
        if (!runs.has(id)) { try { allRuns.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))); } catch { /* skip */ } }
      }
    }
    let result = allRuns;
    if (filterProjectId) result = result.filter(r => r.projectId === filterProjectId);
    result.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    res.json(result.slice(0, 100).map(r => ({
      runId: r.runId, planId: r.planId, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null,
      status: r.status, passed: r.passed, failed: r.failed, total: r.total,
      projectId: r.projectId ?? null, projectName: r.projectName ?? null,
      suiteId: r.suiteId ?? null, suiteName: r.suiteName ?? null,
      environmentId: r.environmentId ?? null, environmentName: r.environmentName ?? null,
      executedBy: r.executedBy ?? null, healCount: r.healEvents?.length ?? 0,
      browsers: r.browsers ?? ['chromium'], tests: r.tests ?? [],
    })));
  });
}