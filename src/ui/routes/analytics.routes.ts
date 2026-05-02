import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../framework/config';
import { readAll } from '../../data/store';
import type { RunRecord } from '../helpers/types';
import { requireAuth } from '../../auth/middleware';
import { runs } from '../helpers/state';
import { attachDefectInfo } from '../helpers/run-spawner';

export function registerAnalyticsRoutes(app: express.Application): void {
  app.get('/api/analytics', requireAuth, (req: Request, res: Response) => {
    const filterProjectId = (req.query.projectId as string) || '';
    const days = Math.min(parseInt((req.query.days as string) || '30', 10), 365);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const allRuns: RunRecord[] = [...runs.values()];
    const dir = config.paths.results;
    if (fs.existsSync(dir)) { for (const f of fs.readdirSync(dir)) { if (!f.startsWith('run-') || !f.endsWith('.json')) continue; const id = f.slice(4, -5); if (!runs.has(id)) { try { allRuns.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))); } catch { /* skip */ } } } }
    let pool = allRuns.filter(r => (r.status === 'done' || r.status === 'failed') && r.startedAt >= since);
    if (filterProjectId) pool = pool.filter(r => r.projectId === filterProjectId);
    pool.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const dayMap = new Map<string, { passed: number; failed: number; total: number }>();
    for (const r of pool) { const day = r.startedAt.slice(0, 10); const entry = dayMap.get(day) ?? { passed: 0, failed: 0, total: 0 }; entry.passed += r.passed ?? 0; entry.failed += r.failed ?? 0; entry.total += r.total ?? 0; dayMap.set(day, entry); }
    const passRateTrend = [...dayMap.entries()].map(([day, e]) => ({ day, passRate: e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0, passed: e.passed, failed: e.failed, total: e.total }));
    const durMap = new Map<string, number[]>();
    for (const r of pool) { if (!r.startedAt || !r.finishedAt) continue; const day = r.startedAt.slice(0, 10); const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime(); if (!durMap.has(day)) durMap.set(day, []); durMap.get(day)!.push(ms); }
    const durationTrend = [...durMap.entries()].map(([day, arr]) => ({ day, avgMs: Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) }));
    const tcFail = new Map<string, { name: string; suiteName: string; failures: number; passes: number }>();
    for (const r of pool) { for (const t of r.tests ?? []) { const key = t.name; const entry = tcFail.get(key) ?? { name: t.name, suiteName: r.suiteName ?? '', failures: 0, passes: 0 }; if (t.status === 'fail') entry.failures++; else if (t.status === 'pass') entry.passes++; tcFail.set(key, entry); } }
    const topFailures = [...tcFail.values()].filter(t => t.failures > 0).sort((a, b) => b.failures - a.failures).slice(0, 20).map(t => ({ ...t, total: t.failures + t.passes, failRate: Math.round((t.failures / (t.failures + t.passes)) * 100) }));
    const flaky = [...tcFail.values()].filter(t => t.failures > 0 && t.passes > 0).sort((a, b) => b.failures - a.failures).slice(0, 20).map(t => ({ ...t, total: t.failures + t.passes, failRate: Math.round((t.failures / (t.failures + t.passes)) * 100) }));
    const suiteMap = new Map<string, { suiteId: string; suiteName: string; runs: number; passed: number; failed: number; total: number; totalMs: number }>();
    for (const r of pool) { const key = r.suiteId ?? 'unknown'; const entry = suiteMap.get(key) ?? { suiteId: key, suiteName: r.suiteName ?? key, runs: 0, passed: 0, failed: 0, total: 0, totalMs: 0 }; entry.runs++; entry.passed += r.passed ?? 0; entry.failed += r.failed ?? 0; entry.total += r.total ?? 0; if (r.startedAt && r.finishedAt) entry.totalMs += new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime(); suiteMap.set(key, entry); }
    const suiteComparison = [...suiteMap.values()].sort((a, b) => b.runs - a.runs);
    const totalRuns = pool.length;
    const totalPassed = pool.reduce((s, r) => s + (r.passed ?? 0), 0);
    const totalFailed = pool.reduce((s, r) => s + (r.failed ?? 0), 0);
    const totalTests = pool.reduce((s, r) => s + (r.total ?? 0), 0);
    const overallPassRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
    res.json({ days, totalRuns, totalPassed, totalFailed, totalTests, overallPassRate, passRateTrend, durationTrend, topFailures, flaky, suiteComparison });
  });
}