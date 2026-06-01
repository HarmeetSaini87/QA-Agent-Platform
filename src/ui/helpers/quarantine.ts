import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { readAll, SUITES, PROJECTS } from '../../data/store';
import type { TestSuite, Project } from '../../data/types';
import type { FlakinessConfig, FlakeAnalysis, TestRun } from '../../utils/flakinessEngine';
import { DEFAULT_FLAKINESS_CONFIG } from '../../utils/flakinessEngine';
import type { RunRecord } from './types';

const QUARANTINE_FILE = path.resolve('data/quarantine.json');

export interface QuarantineEntry {
  suiteId: string;
  testId: string;
  testName: string;
  status: 'active' | 'restored';
  quarantinedAt: string;
  lastEvaluatedAt: string;
  lastNotifiedAt: string | null;
  restoredAt: string | null;
  manuallyRestoredAt: string | null;
  autoQuarantined: boolean;
  quarantineReason: string;
  scoreVersion: string;
}

export function readQuarantine(): Record<string, QuarantineEntry> {
  try {
    if (!fs.existsSync(QUARANTINE_FILE)) return {};
    return JSON.parse(fs.readFileSync(QUARANTINE_FILE, 'utf-8'));
  } catch { return {}; }
}

export function writeQuarantine(data: Record<string, QuarantineEntry>): void {
  fs.mkdirSync(path.resolve('data'), { recursive: true });
  fs.writeFileSync(QUARANTINE_FILE, JSON.stringify(data, null, 2));
}

export function upsertQuarantineEntry(
  suiteId: string, testId: string, testName: string,
  analysis: FlakeAnalysis,
  _runId: string
): void {
  const all = readQuarantine();
  const key = `${suiteId}::${testId}`;
  if (all[key]?.status === 'active') return;
  all[key] = {
    suiteId, testId, testName,
    status: 'active',
    quarantinedAt: new Date().toISOString(),
    lastEvaluatedAt: new Date().toISOString(),
    lastNotifiedAt: null,
    restoredAt: null,
    manuallyRestoredAt: null,
    autoQuarantined: true,
    quarantineReason: analysis.quarantineReason ?? '',
    scoreVersion: analysis.scoreVersion,
  };
  writeQuarantine(all);
}

export function restoreQuarantineEntry(suiteId: string, testId: string, _runId: string, manual = false): void {
  const all = readQuarantine();
  const key = `${suiteId}::${testId}`;
  if (!all[key] || all[key].status !== 'active') return;
  all[key].status = 'restored';
  all[key].restoredAt = new Date().toISOString();
  if (manual) all[key].manuallyRestoredAt = new Date().toISOString();
  writeQuarantine(all);
}

export const pendingToasts: Array<{ message: string; level: 'info' | 'warn' | 'error'; runId: string }> = [];
export const notifyIdempotency = new Set<string>();

export function emitFlakeNotification(
  type: 'test_quarantined' | 'test_restored' | 'budget_warning' | 'budget_exceeded',
  suiteId: string, testId: string, runId: string, extra: Record<string, unknown> = {}
): void {
  const key = `${type}:${suiteId}:${testId}:${runId}`;
  if (notifyIdempotency.has(key)) return;
  notifyIdempotency.add(key);

  const msgs: Record<string, string> = {
    test_quarantined: `Auto-quarantined: "${extra.testName}" (score ${Number(extra.flakeScore ?? 0).toFixed(2)}). Excluded from suite result.`,
    test_restored: `Restored: "${extra.testName}" from quarantine after clean runs.`,
    budget_warning: `Quarantine budget: ${extra.used}/${extra.limit} used this run.`,
    budget_exceeded: `Quarantine budget exceeded (${extra.used}/${extra.limit}). Suite marked failed.`,
  };

  pendingToasts.push({
    message: msgs[type] ?? type,
    level: type === 'budget_exceeded' ? 'error' : type === 'budget_warning' ? 'warn' : 'info',
    runId,
  });
}

export function getEffectiveFlakinessConfig(suiteId: string, projectId: string): FlakinessConfig {
  const suites = readAll<TestSuite>(SUITES);
  const projects = readAll<Project>(PROJECTS);
  const suite = suites.find((s) => s.id === suiteId);
  const project = projects.find((p) => p.id === projectId);
  return {
    ...DEFAULT_FLAKINESS_CONFIG,
    ...((project as any)?.flakinessDefaults ?? {}),
    ...((suite as any)?.flakinessOverrides ?? {}),
  } as FlakinessConfig;
}

export function generateTestId(suiteId: string, testName: string): string {
  return 'TID_' + crypto.createHash('sha256')
    .update(`${suiteId}::${testName}`)
    .digest('hex')
    .slice(0, 8);
}

export function groupRunsByTestId(
  allRuns: RunRecord[],
  suiteId: string,
  windowDays: number
): Map<string, TestRun[]> {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const map = new Map<string, TestRun[]>();

  for (const run of allRuns) {
    if (run.suiteId !== suiteId) continue;
    const ts = new Date(run.startedAt).getTime();
    if (ts < cutoff) continue;
    for (const t of (run.tests ?? [])) {
      if (!t.testId) continue;
      const arr = map.get(t.testId) ?? [];
      arr.push({
        testId: t.testId,
        status: t.status === 'pass' ? 'pass' : 'fail',
        timestamp: ts,
        durationMs: t.durationMs,
        errorMessage: t.errorMessage,
      });
      map.set(t.testId, arr);
    }
  }
  return map;
}