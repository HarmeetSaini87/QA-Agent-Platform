import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { saveSuiteRunResult, loadSuiteRun, listSuiteRuns } from '../suite-run-store';
import type { SuiteRunResult } from '../contracts/api-suite.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-run-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeResult(id: string, suiteId = 'suite-1'): SuiteRunResult {
  return {
    id, suiteId, suiteName: 'Test Suite',
    status: 'passed', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z',
    durationMs: 1000, phaseResults: [], sharedContext: {},
  };
}

describe('suite-run-store', () => {
  it('saveSuiteRunResult writes file to data/api-suite-runs/', async () => {
    await saveSuiteRunResult(makeResult('run-1'));
    const file = path.join(tmpDir, 'api-suite-runs', 'run-1.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.id).toBe('run-1');
  });

  it('loadSuiteRun returns null when file absent', () => {
    expect(loadSuiteRun('nonexistent')).toBeNull();
  });

  it('loadSuiteRun returns saved result', async () => {
    await saveSuiteRunResult(makeResult('run-2'));
    const loaded = loadSuiteRun('run-2');
    expect(loaded).not.toBeNull();
    expect(loaded!.suiteId).toBe('suite-1');
  });

  it('listSuiteRuns returns runs for a suiteId', async () => {
    await saveSuiteRunResult(makeResult('run-a', 'suite-1'));
    await saveSuiteRunResult(makeResult('run-b', 'suite-1'));
    await saveSuiteRunResult(makeResult('run-c', 'suite-2'));
    const runs = listSuiteRuns('suite-1');
    expect(runs).toHaveLength(2);
    expect(runs.every(r => r.suiteId === 'suite-1')).toBe(true);
  });

  it('saveSuiteRunResult performs atomic write — no .tmp file left', async () => {
    await saveSuiteRunResult(makeResult('run-3'));
    const tmpFile = path.join(tmpDir, 'api-suite-runs', 'run-3.json.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
  });
});
