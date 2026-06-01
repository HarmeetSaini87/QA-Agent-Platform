import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadApiDefectsRegistry,
  appendApiDefectRecord,
  findOpenApiDefect,
} from '../api-defect-store';
import type { ApiDefectRecord } from '../contracts/api-defect.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-defect-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRecord(overrides: Partial<ApiDefectRecord> = {}): ApiDefectRecord {
  return {
    defectKey: 'PROJ-1',
    jiraId: 'jira-1',
    stepId: 'step-1',
    stepName: 'GET /users',
    collectionId: 'col-1',
    collectionName: 'User API',
    runId: 'run-1',
    environmentId: 'env-1',
    environmentName: 'Staging',
    status: 'open',
    createdAt: '2026-05-01T00:00:00Z',
    createdBy: 'tester',
    jiraUrl: 'https://jira.example.com/browse/PROJ-1',
    ...overrides,
  };
}

describe('api-defect-store', () => {
  it('loadApiDefectsRegistry returns default empty registry when file absent', () => {
    const reg = loadApiDefectsRegistry();
    expect(reg._schemaVersion).toBe(1);
    expect(reg.defects).toEqual([]);
  });

  it('appendApiDefectRecord then loadApiDefectsRegistry returns the appended record', () => {
    appendApiDefectRecord(makeRecord());
    const reg = loadApiDefectsRegistry();
    expect(reg.defects).toHaveLength(1);
    expect(reg.defects[0].defectKey).toBe('PROJ-1');
  });

  it('findOpenApiDefect returns null when no matching record', () => {
    const result = findOpenApiDefect('step-1', 'col-1');
    expect(result).toBeNull();
  });

  it('findOpenApiDefect returns record when stepId+collectionId match and status is open', () => {
    appendApiDefectRecord(makeRecord());
    const result = findOpenApiDefect('step-1', 'col-1');
    expect(result).not.toBeNull();
    expect(result!.defectKey).toBe('PROJ-1');
  });

  it('findOpenApiDefect returns null when matching record has status closed', () => {
    appendApiDefectRecord(makeRecord({ status: 'closed' }));
    const result = findOpenApiDefect('step-1', 'col-1');
    expect(result).toBeNull();
  });

  it('saveApiDefectsRegistry performs atomic write (no .tmp file left behind)', () => {
    appendApiDefectRecord(makeRecord());
    const tmpFile = path.join(tmpDir, 'api-defects.json.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'api-defects.json'))).toBe(true);
  });
});
