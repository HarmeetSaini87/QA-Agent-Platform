import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadJiraConfig, saveJiraConfig,
  loadDefectsRegistry, saveDefectsRegistry,
  appendDismissEntry,
  findOpenDefect, findOpenDefectsForRun,
  setDataDir,
} from '../defectsStore';
import type { DefectRecord, JiraConfig, DismissEntry } from '../../data/types';

describe('defectsStore', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'defstore-'));
    setDataDir(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when jira config not yet saved', () => {
    expect(loadJiraConfig()).toBeNull();
  });

  it('saves and loads jira config', () => {
    const cfg: JiraConfig = {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      parentLinkFieldId: 'customfield_10014', referSSFieldId: 'customfield_10025',
      closeTransitionName: 'Closed', maxAttachmentMB: 50,
      updatedAt: '2026-04-27T00:00:00Z', updatedBy: 'admin',
    };
    saveJiraConfig(cfg);
    expect(loadJiraConfig()).toEqual(cfg);
  });

  it('returns empty registry when defects.json missing', () => {
    const reg = loadDefectsRegistry();
    expect(reg._schemaVersion).toBe(1);
    expect(reg.defects).toEqual([]);
  });

  it('saves and loads defects registry', () => {
    const d: DefectRecord = {
      defectKey: 'BSM-1842', jiraId: '12345', testId: 'TID_abc',
      testName: 'Login', suiteId: 's1', suiteName: 'Smoke',
      environmentId: 'e1', environmentName: 'QA', projectId: 'p1',
      parentStoryKey: 'BSM-1826', status: 'open',
      createdAt: '2026-04-27T00:00:00Z', createdBy: 'editor',
      filedFromRunId: 'r1', jiraUrl: 'https://example.atlassian.net/browse/BSM-1842',
      attachments: { screenshot: 'ok' }, comments: [],
    };
    saveDefectsRegistry({ _schemaVersion: 1, defects: [d] });
    expect(loadDefectsRegistry().defects).toHaveLength(1);
  });

  it('finds open defect by testId+suiteId, ignores closed', () => {
    const open: DefectRecord = {
      defectKey: 'BSM-1', jiraId: '1', testId: 'TID_a', testName: 't',
      suiteId: 's1', suiteName: 'S', environmentId: 'e1', environmentName: 'E',
      projectId: 'p', parentStoryKey: 'BSM-100', status: 'open',
      createdAt: '', createdBy: '', filedFromRunId: '',
      jiraUrl: '', attachments: {}, comments: [],
    };
    const closed = { ...open, defectKey: 'BSM-2', status: 'closed' as const };
    saveDefectsRegistry({ _schemaVersion: 1, defects: [open, closed] });
    expect(findOpenDefect('TID_a', 's1')?.defectKey).toBe('BSM-1');
    expect(findOpenDefect('TID_a', 'other')).toBeNull();
  });

  it('finds open defects by suite+env for auto-close scan', () => {
    const a: DefectRecord = {
      defectKey: 'BSM-1', jiraId: '1', testId: 'TID_a', testName: 't',
      suiteId: 's1', suiteName: 'S', environmentId: 'e1', environmentName: 'E',
      projectId: 'p', parentStoryKey: 'BSM-100', status: 'open',
      createdAt: '', createdBy: '', filedFromRunId: '',
      jiraUrl: '', attachments: {}, comments: [],
    };
    const b = { ...a, defectKey: 'BSM-2', testId: 'TID_b' };
    const otherEnv = { ...a, defectKey: 'BSM-3', testId: 'TID_c', environmentId: 'e2' };
    saveDefectsRegistry({ _schemaVersion: 1, defects: [a, b, otherEnv] });
    const found = findOpenDefectsForRun('s1', 'e1');
    expect(found.map(x => x.defectKey).sort()).toEqual(['BSM-1', 'BSM-2']);
  });

  it('appends dismiss entries as ndjson', () => {
    const e1: DismissEntry = {
      timestamp: '2026-04-27T00:00:00Z', runId: 'r1', testId: 'TID_a',
      testName: 't', suiteId: 's1', category: 'flaky',
      dismissedBy: 'editor', errorMessage: 'timeout',
    };
    const e2: DismissEntry = { ...e1, runId: 'r2', category: 'locator-issue' };
    appendDismissEntry(e1);
    appendDismissEntry(e2);
    const file = path.join(tmp, 'dismissed-defects.ndjson');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).category).toBe('flaky');
    expect(JSON.parse(lines[1]).category).toBe('locator-issue');
  });
});
