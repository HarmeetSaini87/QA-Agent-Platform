import * as fs from 'fs';
import * as path from 'path';
import type { SuiteRunResult } from './contracts/api-suite.contracts';

function suiteRunsDir(): string {
  return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'api-suite-runs');
}

function runPath(runId: string): string {
  return path.join(suiteRunsDir(), `${runId}.json`);
}

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export async function saveSuiteRunResult(result: SuiteRunResult): Promise<void> {
  atomicWrite(runPath(result.id), JSON.stringify(result, null, 2));
}

export function loadSuiteRun(runId: string): SuiteRunResult | null {
  const file = runPath(runId);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as SuiteRunResult; }
  catch { return null; }
}

export function listSuiteRuns(suiteId: string): SuiteRunResult[] {
  const dir = suiteRunsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
  const runs: SuiteRunResult[] = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SuiteRunResult;
      if (r.suiteId === suiteId) runs.push(r);
    } catch { /* skip corrupt files */ }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
