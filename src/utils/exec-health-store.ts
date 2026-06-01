// exec-health-store.ts — in-memory singleton tracking all active + recent runs across all run types.
// UI tests, API collections, and API suites all register here. Frontend polls /api/execution-health.

export type ExecRunType = 'ui-test' | 'api-collection' | 'api-suite';
export type ExecRunStatus = 'running' | 'passed' | 'failed' | 'error';

export interface ExecHealthEntry {
  runId: string;
  type: ExecRunType;
  name: string;
  status: ExecRunStatus;
  startedAt: string;
  completedAt?: string;
  passed: number;
  failed: number;
  total: number;
}

const MAX_RECENT = 30;

const _active = new Map<string, ExecHealthEntry>();
const _recent: ExecHealthEntry[] = [];

export function execHealthStart(entry: Omit<ExecHealthEntry, 'status' | 'passed' | 'failed' | 'total'>): void {
  _active.set(entry.runId, { ...entry, status: 'running', passed: 0, failed: 0, total: 0 });
}

export function execHealthUpdate(runId: string, passed: number, failed: number, total: number): void {
  const e = _active.get(runId);
  if (e) { e.passed = passed; e.failed = failed; e.total = total; }
}

export function execHealthComplete(runId: string, status: 'passed' | 'failed' | 'error', passed: number, failed: number, total: number): void {
  const e = _active.get(runId);
  if (!e) return;
  e.status = status;
  e.passed = passed;
  e.failed = failed;
  e.total = total;
  e.completedAt = new Date().toISOString();
  _active.delete(runId);
  _recent.unshift({ ...e });
  if (_recent.length > MAX_RECENT) _recent.length = MAX_RECENT;
}

export function execHealthGetSnapshot(): { active: ExecHealthEntry[]; recent: ExecHealthEntry[] } {
  return {
    active: Array.from(_active.values()),
    recent: [..._recent],
  };
}
