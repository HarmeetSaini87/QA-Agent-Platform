# Auto-File Jira Defect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build human-validated Jira defect filing flow on test failure: pre-fills draft from RunRecord, requires Editor to review/file, embeds attachments, auto-closes when test passes again on same suite+env.

**Architecture:** Three new utility modules (pure Jira REST client, ADF body builder, JSON storage) + new server routes for config and defect lifecycle + additive UI on Execution Report (modal + badge) and Admin Settings (Jira config panel). Auto-close runs as a hook in existing run-finalization. No Playwright config or generator changes.

**Tech Stack:** TypeScript, Express, Vitest (unit), Vanilla JS frontend, Jira REST API v3 + Atlassian Document Format (ADF), JSON file storage.

**Spec:** `docs/superpowers/specs/2026-04-27-auto-file-defect-design.md`

---

## File Structure

| File | Role |
|---|---|
| `src/utils/jiraClient.ts` | Pure stateless wrapper for Jira REST: testConnection, discoverFields, createIssue, addAttachment, addComment, transitionIssue, searchOpenDefectByTestId. No DB, no app state. |
| `src/utils/adfBuilder.ts` | Pure helpers that build Atlassian Document Format JSON payloads (issue description with sections; auto-close comment; comment-on-failure body). |
| `src/utils/defectsStore.ts` | Read/write `data/defects.json` + `data/jira-config.json` + append `data/dismissed-defects.ndjson`. In-memory indexes by testId+suiteId, by (suiteId,envId,status). |
| `src/utils/__tests__/jiraClient.test.ts` | Vitest unit tests with mocked HTTP. |
| `src/utils/__tests__/adfBuilder.test.ts` | Vitest unit tests for ADF shape. |
| `src/utils/__tests__/defectsStore.test.ts` | Vitest unit tests for storage + indexing. |
| `src/data/types.ts` | Add `JiraConfig`, `DefectRecord`, `DismissEntry`; extend `TestEvent` with `defectKey`, `defectStatus`. |
| `src/ui/server.ts` | New routes `/api/jira/*` and `/api/defects/*`; auto-close hook in run finalization; cross-reference defects when serving RunRecord JSON. |
| `src/ui/public/index.html` | Admin Settings — collapsible Jira Integration panel. |
| `src/ui/public/modules.js` | Jira admin panel handlers (`jiraConfigLoad`, `jiraConfigSave`, `jiraTestConnection`, `jiraDiscoverFields`). |
| `src/ui/public/execution-report.html` | `[🐞 File Defect]` button on failed rows, defect modal, badge rendering. |

---

## Task 1: Add types + storage layer

**Files:**
- Modify: `src/data/types.ts` (add types)
- Create: `src/utils/defectsStore.ts`
- Create: `src/utils/__tests__/defectsStore.test.ts`

Build the persistence layer first. Pure module — no Express, no Jira. Tests run without server.

### Background

`src/data/types.ts` is the single source of truth for TypeScript interfaces. `src/data/store.ts` holds atomic JSON read/write helpers (`readJson`, `writeJson`). Use them.

### Steps

- [ ] **Step 1.1: Add types to `src/data/types.ts`**

Append to the end of `src/data/types.ts`:

```typescript
// ── Jira Defect Filing ───────────────────────────────────────────────

export interface JiraConfig {
  projectKey: string;
  issueType: string;
  defaultPriority: string;
  parentLinkFieldId: string;
  referSSFieldId: string;        // captured for future use; v1 uses /attachments endpoint
  closeTransitionName: string;
  maxAttachmentMB: number;
  updatedAt: string;
  updatedBy: string;
}

export type DefectAttachmentStatus = 'ok' | 'failed' | 'skipped';

export interface DefectRecord {
  defectKey: string;
  jiraId: string;
  testId: string;
  testName: string;
  suiteId: string;
  suiteName: string;
  environmentId: string;
  environmentName: string;
  projectId: string;
  parentStoryKey: string;
  status: 'open' | 'closed';
  createdAt: string;
  createdBy: string;
  filedFromRunId: string;
  closedAt?: string;
  closedByRunId?: string;
  jiraUrl: string;
  attachments: {
    screenshot?: DefectAttachmentStatus;
    video?: DefectAttachmentStatus;
    trace?: DefectAttachmentStatus;
  };
  comments: Array<{ runId: string; addedAt: string; addedBy: string }>;
}

export interface DefectsRegistry {
  _schemaVersion: 1;
  defects: DefectRecord[];
}

export type DismissCategory =
  | 'script-issue'
  | 'locator-issue'
  | 'flaky'
  | 'data-issue'
  | 'env-issue';

export interface DismissEntry {
  timestamp: string;
  runId: string;
  testId: string;
  testName: string;
  suiteId: string;
  category: DismissCategory;
  dismissedBy: string;
  errorMessage: string;
}
```

Then extend the existing `TestEvent` interface (find it in the same file) by adding:

```typescript
  // Auto-File Defect feature
  defectKey?: string;
  defectStatus?: 'open' | 'closed';
```

- [ ] **Step 1.2: Write the failing test**

Create `src/utils/__tests__/defectsStore.test.ts`:

```typescript
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
```

- [ ] **Step 1.3: Run test to verify it fails**

Run: `npm run test:unit -- defectsStore`
Expected: FAIL with "Cannot find module '../defectsStore'"

- [ ] **Step 1.4: Implement `src/utils/defectsStore.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { JiraConfig, DefectsRegistry, DefectRecord, DismissEntry } from '../data/types';

let DATA_DIR = path.resolve(process.cwd(), 'data');

export function setDataDir(dir: string): void {
  DATA_DIR = dir;
}

function configPath(): string  { return path.join(DATA_DIR, 'jira-config.json'); }
function defectsPath(): string { return path.join(DATA_DIR, 'defects.json'); }
function dismissPath(): string { return path.join(DATA_DIR, 'dismissed-defects.ndjson'); }

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWrite(file: string, data: string): void {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadJiraConfig(): JiraConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return JSON.parse(raw) as JiraConfig;
  } catch {
    return null;
  }
}

export function saveJiraConfig(cfg: JiraConfig): void {
  atomicWrite(configPath(), JSON.stringify(cfg, null, 2));
}

export function loadDefectsRegistry(): DefectsRegistry {
  try {
    const raw = fs.readFileSync(defectsPath(), 'utf8');
    const parsed = JSON.parse(raw) as DefectsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, defects: [] };
  }
}

export function saveDefectsRegistry(reg: DefectsRegistry): void {
  atomicWrite(defectsPath(), JSON.stringify(reg, null, 2));
}

export function findOpenDefect(testId: string, suiteId: string): DefectRecord | null {
  const reg = loadDefectsRegistry();
  return reg.defects.find(d =>
    d.testId === testId && d.suiteId === suiteId && d.status === 'open'
  ) || null;
}

export function findOpenDefectsForRun(suiteId: string, environmentId: string): DefectRecord[] {
  const reg = loadDefectsRegistry();
  return reg.defects.filter(d =>
    d.suiteId === suiteId && d.environmentId === environmentId && d.status === 'open'
  );
}

export function appendDismissEntry(entry: DismissEntry): void {
  ensureDir();
  fs.appendFileSync(dismissPath(), JSON.stringify(entry) + '\n', 'utf8');
}
```

- [ ] **Step 1.5: Run test to verify it passes**

Run: `npm run test:unit -- defectsStore`
Expected: PASS — all 7 tests green.

- [ ] **Step 1.6: Commit**

```bash
git add src/data/types.ts src/utils/defectsStore.ts src/utils/__tests__/defectsStore.test.ts
git commit -m "feat: add JiraConfig + DefectRecord types and defectsStore"
```

---

## Task 2: ADF body builder

**Files:**
- Create: `src/utils/adfBuilder.ts`
- Create: `src/utils/__tests__/adfBuilder.test.ts`

Pure function module. Builds Atlassian Document Format JSON for issue description and comments.

### Background

ADF is Jira Cloud's structured-content JSON. Top level: `{ type: 'doc', version: 1, content: [...] }`. Children include `heading`, `paragraph`, `codeBlock`, `orderedList`, `text`. We embed `testId` literally so `searchOpenDefectByTestId` JQL `text ~` can find it.

### Steps

- [ ] **Step 2.1: Write the failing test**

Create `src/utils/__tests__/adfBuilder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildDefectDescription, buildAutoCloseCommentADF, buildFailureCommentADF } from '../adfBuilder';

describe('buildDefectDescription', () => {
  const base = {
    testName: 'Login flow',
    testId: 'TID_abc12345',
    suiteName: 'Smoke',
    projectName: 'BSS',
    runTimestamp: '2026-04-27T22:11:51Z',
    runId: 'r-1',
    envName: 'QA',
    envUrl: 'https://qa.example.com',
    browser: 'chromium',
    os: 'win32',
    steps: ['GOTO /login', 'CLICK #submit'],
    errorMessage: 'TimeoutError',
    errorDetailFirst5: 'at locator.click\nat test...',
  };

  it('produces a valid ADF document', () => {
    const adf = buildDefectDescription(base);
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(Array.isArray(adf.content)).toBe(true);
  });

  it('includes the testId verbatim for JQL search', () => {
    const adf = buildDefectDescription(base);
    const json = JSON.stringify(adf);
    expect(json).toContain('TID_abc12345');
  });

  it('renders all 5 section headings', () => {
    const adf = buildDefectDescription(base);
    const headings = adf.content
      .filter((n: any) => n.type === 'heading')
      .map((n: any) => n.content[0].text);
    expect(headings).toEqual([
      'Description', 'Precondition', 'Steps', 'Actual Result', 'Expected Result',
    ]);
  });

  it('renders steps as orderedList', () => {
    const adf = buildDefectDescription(base);
    const list = adf.content.find((n: any) => n.type === 'orderedList');
    expect(list).toBeDefined();
    expect(list.content).toHaveLength(2);
  });

  it('renders error in codeBlock', () => {
    const adf = buildDefectDescription(base);
    const code = adf.content.find((n: any) => n.type === 'codeBlock');
    expect(code).toBeDefined();
    expect(JSON.stringify(code)).toContain('TimeoutError');
  });

  it('renders empty Expected Result placeholder', () => {
    const adf = buildDefectDescription(base);
    const idx = adf.content.findIndex(
      (n: any) => n.type === 'heading' && n.content[0].text === 'Expected Result'
    );
    expect(idx).toBeGreaterThan(-1);
    const next = adf.content[idx + 1];
    expect(next.type).toBe('paragraph');
  });

  it('handles empty steps array gracefully', () => {
    const adf = buildDefectDescription({ ...base, steps: [] });
    const list = adf.content.find((n: any) => n.type === 'orderedList');
    expect(list).toBeUndefined();
  });
});

describe('buildAutoCloseCommentADF', () => {
  it('produces a valid ADF doc with run id and timestamp', () => {
    const adf = buildAutoCloseCommentADF('r-42', '2026-04-27T22:00:00Z');
    expect(adf.type).toBe('doc');
    const json = JSON.stringify(adf);
    expect(json).toContain('r-42');
    expect(json).toContain('Auto-closed');
  });
});

describe('buildFailureCommentADF', () => {
  it('produces a comment summarizing a new failure', () => {
    const adf = buildFailureCommentADF({
      runId: 'r-2',
      timestamp: '2026-04-27T22:00:00Z',
      errorMessage: 'TimeoutError',
      errorDetailFirst5: 'stack',
    });
    expect(adf.type).toBe('doc');
    const json = JSON.stringify(adf);
    expect(json).toContain('r-2');
    expect(json).toContain('TimeoutError');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npm run test:unit -- adfBuilder`
Expected: FAIL with "Cannot find module '../adfBuilder'"

- [ ] **Step 2.3: Implement `src/utils/adfBuilder.ts`**

```typescript
// Atlassian Document Format builders. Pure functions.
// Spec: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/

export interface ADFNode {
  type: string;
  version?: number;
  attrs?: Record<string, unknown>;
  content?: ADFNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

function text(t: string): ADFNode {
  return { type: 'text', text: t };
}

function paragraph(...children: ADFNode[]): ADFNode {
  return { type: 'paragraph', content: children };
}

function paragraphText(s: string): ADFNode {
  return paragraph(text(s));
}

function heading(level: number, t: string): ADFNode {
  return { type: 'heading', attrs: { level }, content: [text(t)] };
}

function codeBlock(t: string): ADFNode {
  return { type: 'codeBlock', attrs: { language: 'text' }, content: [text(t)] };
}

function orderedList(items: string[]): ADFNode {
  return {
    type: 'orderedList',
    content: items.map(i => ({
      type: 'listItem',
      content: [paragraphText(i)],
    })),
  };
}

function emptyParagraph(): ADFNode {
  return { type: 'paragraph' };
}

export interface DescriptionInput {
  testName: string;
  testId: string;
  suiteName: string;
  projectName: string;
  runTimestamp: string;
  runId: string;
  envName: string;
  envUrl: string;
  browser: string;
  os: string;
  steps: string[];
  errorMessage: string;
  errorDetailFirst5: string;
}

export function buildDefectDescription(input: DescriptionInput): ADFNode {
  const content: ADFNode[] = [];

  content.push(heading(3, 'Description'));
  content.push(paragraphText(
    `Test "${input.testName}" failed in suite "${input.suiteName}" ` +
    `(project "${input.projectName}") on ${input.runTimestamp}.`
  ));
  content.push(paragraphText(`Run ID: ${input.runId}`));
  content.push(paragraphText(`testId: ${input.testId}`));

  content.push(heading(3, 'Precondition'));
  content.push(paragraphText(`Environment: ${input.envName} — ${input.envUrl}`));
  content.push(paragraphText(`Browser: ${input.browser}`));
  content.push(paragraphText(`OS: ${input.os}`));

  content.push(heading(3, 'Steps'));
  if (input.steps.length) {
    content.push(orderedList(input.steps));
  } else {
    content.push(paragraphText('(no step details captured)'));
  }

  content.push(heading(3, 'Actual Result'));
  content.push(paragraphText(input.errorMessage || 'Test failed'));
  if (input.errorDetailFirst5) {
    content.push(codeBlock(input.errorDetailFirst5));
  }

  content.push(heading(3, 'Expected Result'));
  content.push(emptyParagraph());

  return { type: 'doc', version: 1, content };
}

export function buildAutoCloseCommentADF(runId: string, timestamp: string): ADFNode {
  return {
    type: 'doc',
    version: 1,
    content: [paragraphText(
      `Auto-closed by TestForge — test passed on run ${runId} at ${timestamp}. ` +
      `Please verify the fix is genuine.`
    )],
  };
}

export interface FailureCommentInput {
  runId: string;
  timestamp: string;
  errorMessage: string;
  errorDetailFirst5: string;
}

export function buildFailureCommentADF(input: FailureCommentInput): ADFNode {
  const content: ADFNode[] = [];
  content.push(paragraphText(
    `Test failed again on run ${input.runId} at ${input.timestamp}.`
  ));
  content.push(paragraphText(`Error: ${input.errorMessage || 'Test failed'}`));
  if (input.errorDetailFirst5) content.push(codeBlock(input.errorDetailFirst5));
  return { type: 'doc', version: 1, content };
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npm run test:unit -- adfBuilder`
Expected: PASS — all 9 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add src/utils/adfBuilder.ts src/utils/__tests__/adfBuilder.test.ts
git commit -m "feat: add ADF builder for Jira defect description and comments"
```

---

## Task 3: Jira REST client (pure wrapper)

**Files:**
- Create: `src/utils/jiraClient.ts`
- Create: `src/utils/__tests__/jiraClient.test.ts`

### Background

Use Node's built-in `fetch` (Node 18+). Auth header: `Basic ${base64(email:token)}`. All errors mapped to typed error classes for the route layer to render.

### Steps

- [ ] **Step 3.1: Write the failing test**

Create `src/utils/__tests__/jiraClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraClient, JiraAuthError, JiraValidationError, JiraNotFoundError } from '../jiraClient';

const creds = { baseUrl: 'https://example.atlassian.net', email: 'u@x.com', apiToken: 'tok' };

describe('JiraClient', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('builds Basic auth header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ emailAddress: 'u@x.com' }), { status: 200 })
    );
    const client = new JiraClient(creds);
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(res.user).toBe('u@x.com');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic ' + Buffer.from('u@x.com:tok').toString('base64'));
  });

  it('returns ok=false on testConnection 401', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const client = new JiraClient(creds);
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
  });

  it('createIssue returns key/id on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: '10001', key: 'BSM-42', self: 'url' }), { status: 201 })
    );
    const client = new JiraClient(creds);
    const out = await client.createIssue({
      projectKey: 'BSM', issueType: 'Defect', summary: 'X',
      descriptionADF: { type: 'doc', version: 1, content: [] },
      priority: 'Medium', parentStoryKey: 'BSM-1',
    });
    expect(out.key).toBe('BSM-42');
    expect(out.id).toBe('10001');
  });

  it('createIssue maps 401 to JiraAuthError', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new JiraClient(creds);
    await expect(client.createIssue({
      projectKey: 'BSM', issueType: 'Defect', summary: 'X',
      descriptionADF: { type: 'doc', version: 1 }, priority: 'Medium',
    })).rejects.toBeInstanceOf(JiraAuthError);
  });

  it('createIssue maps 400 to JiraValidationError with details', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ errors: { summary: 'required' } }), { status: 400 }
    ));
    const client = new JiraClient(creds);
    try {
      await client.createIssue({
        projectKey: 'BSM', issueType: 'Defect', summary: '',
        descriptionADF: { type: 'doc', version: 1 }, priority: 'Medium',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(JiraValidationError);
      expect((e as JiraValidationError).details).toEqual({ errors: { summary: 'required' } });
    }
  });

  it('searchOpenDefectByTestId returns first matching key or null', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ issues: [{ key: 'BSM-9' }] }), { status: 200 }
    ));
    const client = new JiraClient(creds);
    const k = await client.searchOpenDefectByTestId('TID_a', 's1', 'BSM');
    expect(k).toBe('BSM-9');
  });

  it('searchOpenDefectByTestId returns null when no match', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ issues: [] }), { status: 200 }
    ));
    const client = new JiraClient(creds);
    expect(await client.searchOpenDefectByTestId('TID_x', 's', 'BSM')).toBeNull();
  });

  it('addAttachment posts multipart with X-Atlassian-Token header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ id: '999' }]), { status: 200 })
    );
    const client = new JiraClient(creds);
    const res = await client.addAttachment('BSM-1',
      { name: 's.png', buffer: Buffer.from('x'), mime: 'image/png' });
    expect(res.id).toBe('999');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Atlassian-Token']).toBe('no-check');
  });

  it('transitionIssue resolves transition name to id then posts', async () => {
    const spy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ transitions: [{ id: '31', name: 'Closed' }] }), { status: 200 }
      ))
      .mockResolvedValueOnce(new Response('', { status: 204 }));
    const client = new JiraClient(creds);
    await client.transitionIssue('BSM-1', 'Closed');
    expect(spy.mock.calls).toHaveLength(2);
    const body = JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string);
    expect(body.transition.id).toBe('31');
  });

  it('transitionIssue throws when name not found', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ transitions: [{ id: '11', name: 'In Progress' }] }), { status: 200 }
    ));
    const client = new JiraClient(creds);
    await expect(client.transitionIssue('BSM-1', 'Closed')).rejects.toThrow(/transition.*not found/i);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npm run test:unit -- jiraClient`
Expected: FAIL with "Cannot find module '../jiraClient'"

- [ ] **Step 3.3: Implement `src/utils/jiraClient.ts`**

```typescript
import type { ADFNode } from './adfBuilder';

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface CreateIssuePayload {
  projectKey: string;
  issueType: string;
  summary: string;
  descriptionADF: ADFNode;
  priority: string;
  parentStoryKey?: string;
}

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type?: string };
}

// ── Error classes ──
export class JiraError extends Error {
  constructor(public code: string, message: string, public httpStatus?: number, public details?: unknown) {
    super(message);
    this.name = 'JiraError';
  }
}
export class JiraAuthError       extends JiraError { constructor(d?: unknown) { super('JIRA_AUTH_FAILED',     'Jira authentication failed',      401, d); } }
export class JiraValidationError extends JiraError { constructor(d?: unknown) { super('JIRA_VALIDATION_ERROR','Jira rejected the request',       400, d); } }
export class JiraNotFoundError   extends JiraError { constructor(d?: unknown) { super('JIRA_NOT_FOUND',       'Jira resource not found',         404, d); } }
export class JiraServerError     extends JiraError { constructor(s: number, d?: unknown) { super('JIRA_SERVER_ERROR', `Jira server error (${s})`, s, d); } }
export class JiraNetworkError    extends JiraError { constructor(m: string)   { super('JIRA_UNREACHABLE',     `Jira unreachable: ${m}`,          undefined); } }

function authHeader(c: JiraCredentials): string {
  return 'Basic ' + Buffer.from(`${c.email}:${c.apiToken}`).toString('base64');
}

async function readJson(r: Response): Promise<unknown> {
  const t = await r.text();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return t; }
}

function mapError(status: number, body: unknown): JiraError {
  if (status === 401 || status === 403) return new JiraAuthError(body);
  if (status === 404) return new JiraNotFoundError(body);
  if (status >= 400 && status < 500) return new JiraValidationError(body);
  return new JiraServerError(status, body);
}

export class JiraClient {
  constructor(private creds: JiraCredentials) {}

  private url(p: string): string { return this.creds.baseUrl.replace(/\/$/, '') + p; }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: authHeader(this.creds), Accept: 'application/json', ...extra };
  }

  private async req(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: this.headers({ 'Content-Type': 'application/json', ...extraHeaders }),
        body: body == null ? undefined : JSON.stringify(body),
      });
    } catch (e: any) {
      throw new JiraNetworkError(e?.message || String(e));
    }
    if (res.status >= 200 && res.status < 300) return readJson(res);
    throw mapError(res.status, await readJson(res));
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const me: any = await this.req('GET', '/rest/api/3/myself');
      return { ok: true, user: me?.emailAddress || me?.accountId };
    } catch (e: any) {
      return { ok: false, error: e?.httpStatus ? `${e.httpStatus} ${e.code}` : e?.message };
    }
  }

  async discoverFields(): Promise<JiraField[]> {
    const arr = (await this.req('GET', '/rest/api/3/field')) as any[];
    return arr.map(f => ({ id: f.id, name: f.name, custom: !!f.custom, schema: f.schema }));
  }

  async createIssue(p: CreateIssuePayload): Promise<{ key: string; id: string; self: string }> {
    const fields: Record<string, unknown> = {
      project: { key: p.projectKey },
      issuetype: { name: p.issueType },
      summary: p.summary,
      description: p.descriptionADF,
      priority: { name: p.priority },
    };
    if (p.parentStoryKey) {
      fields.parent = { key: p.parentStoryKey };
    }
    const out = (await this.req('POST', '/rest/api/3/issue', { fields })) as any;
    return { key: out.key, id: out.id, self: out.self };
  }

  async getIssue(key: string): Promise<unknown> {
    return this.req('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`);
  }

  async searchOpenDefectByTestId(testId: string, suiteId: string, projectKey: string): Promise<string | null> {
    // suiteId reserved for future scoping; v1 keys on testId since it's globally unique
    const jql = `project = ${projectKey} AND statusCategory != Done AND text ~ "${testId}"`;
    const out = (await this.req('POST', '/rest/api/3/search', {
      jql, fields: ['summary'], maxResults: 1,
    })) as any;
    return out?.issues?.[0]?.key || null;
  }

  async addAttachment(key: string, file: { name: string; buffer: Buffer; mime: string }): Promise<{ id: string }> {
    const form = new FormData();
    const blob = new Blob([file.buffer], { type: file.mime });
    form.append('file', blob, file.name);
    let res: Response;
    try {
      res = await fetch(this.url(`/rest/api/3/issue/${encodeURIComponent(key)}/attachments`), {
        method: 'POST',
        headers: { Authorization: authHeader(this.creds), 'X-Atlassian-Token': 'no-check' },
        body: form,
      });
    } catch (e: any) { throw new JiraNetworkError(e?.message || String(e)); }
    if (res.status < 200 || res.status >= 300) {
      throw mapError(res.status, await readJson(res));
    }
    const arr = (await readJson(res)) as any[];
    return { id: arr?.[0]?.id || '' };
  }

  async addComment(key: string, body: ADFNode): Promise<{ id: string }> {
    const out = (await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body })) as any;
    return { id: out?.id || '' };
  }

  async transitionIssue(key: string, transitionName: string): Promise<void> {
    const list = (await this.req('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`)) as any;
    const t = (list.transitions || []).find((x: any) => x.name === transitionName);
    if (!t) throw new JiraError('JIRA_TRANSITION_NOT_FOUND', `transition "${transitionName}" not found`, 400);
    await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: t.id } });
  }
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `npm run test:unit -- jiraClient`
Expected: PASS — all 10 tests green.

- [ ] **Step 3.5: Commit**

```bash
git add src/utils/jiraClient.ts src/utils/__tests__/jiraClient.test.ts
git commit -m "feat: add JiraClient REST wrapper with typed errors"
```

---

## Task 4: Server config routes (Jira mapping admin)

**Files:**
- Modify: `src/ui/server.ts`

Add the four config routes. Use existing `requireAuth` / `requireAdmin` middleware. Wire `config.jira` (already in `.env`) for credentials.

### Background

Existing middleware lives in `src/auth/middleware.ts`. Audit log helper is `logAudit({ ... })`. JSON body parsing is already configured (`express.json()` middleware mounted near top of server.ts). Find a good insertion point near the existing `/api/notify*` or `/api/locator-health` routes and insert after them.

### Steps

- [ ] **Step 4.1: Add imports near the top of `src/ui/server.ts`**

Find the existing imports section and add:

```typescript
import { JiraClient } from '../utils/jiraClient';
import {
  loadJiraConfig, saveJiraConfig,
  loadDefectsRegistry, saveDefectsRegistry,
  appendDismissEntry, findOpenDefect, findOpenDefectsForRun,
} from '../utils/defectsStore';
import {
  buildDefectDescription, buildAutoCloseCommentADF, buildFailureCommentADF,
} from '../utils/adfBuilder';
```

- [ ] **Step 4.2: Add a helper near the top of `server.ts` (after other small helpers, before route definitions)**

```typescript
// Returns a configured JiraClient or null if credentials missing
function getJiraClient(): JiraClient | null {
  const c = config.jira;
  if (!c.baseUrl || !c.email || !c.apiToken) return null;
  return new JiraClient({ baseUrl: c.baseUrl, email: c.email, apiToken: c.apiToken });
}
```

- [ ] **Step 4.3: Add the config routes**

Insert near other admin/notify routes:

```typescript
// ── Jira config (admin) ──────────────────────────────────────────────

app.get('/api/jira/config', requireAuth, (_req: Request, res: Response) => {
  res.json(loadJiraConfig());
});

app.put('/api/jira/config', requireAdmin, (req: Request, res: Response) => {
  const b = req.body || {};
  const required = ['projectKey', 'issueType', 'defaultPriority', 'parentLinkFieldId', 'closeTransitionName'];
  for (const k of required) {
    if (!b[k] || typeof b[k] !== 'string') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Missing field: ${k}` } });
    }
  }
  const cfg = {
    projectKey: String(b.projectKey),
    issueType: String(b.issueType),
    defaultPriority: String(b.defaultPriority),
    parentLinkFieldId: String(b.parentLinkFieldId),
    referSSFieldId: String(b.referSSFieldId || ''),
    closeTransitionName: String(b.closeTransitionName),
    maxAttachmentMB: Number.isFinite(b.maxAttachmentMB) ? Number(b.maxAttachmentMB) : 50,
    updatedAt: new Date().toISOString(),
    updatedBy: req.session.username || 'unknown',
  };
  saveJiraConfig(cfg);
  logAudit({ userId: req.session.userId!, username: req.session.username!,
    action: 'JIRA_CONFIG_SAVE', resourceType: 'jira-config', resourceId: 'global',
    details: cfg.projectKey, ip: req.ip ?? null });
  res.json({ ok: true });
});

app.post('/api/jira/test', requireAdmin, async (_req: Request, res: Response) => {
  const client = getJiraClient();
  if (!client) {
    return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env' } });
  }
  const result = await client.testConnection();
  res.json(result);
});

app.get('/api/jira/fields', requireAdmin, async (_req: Request, res: Response) => {
  const client = getJiraClient();
  if (!client) {
    return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env' } });
  }
  try {
    const fields = await client.discoverFields();
    res.json({ fields });
  } catch (e: any) {
    res.status(502).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Field discovery failed' } });
  }
});
```

- [ ] **Step 4.4: Build and verify compilation**

Run: `npm run build`
Expected: clean exit (no TS errors).

- [ ] **Step 4.5: Restart server and smoke-test**

Run:
```bash
netstat -ano | findstr :3003 | findstr LISTENING
# Note the PID, then:
taskkill //F //PID <pid> && npm run ui >> server.log 2>&1 &
sleep 3 && curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"
```
Expected: `200`. Then GET `/api/jira/config` (with valid session cookie) returns either `null` or saved config.

- [ ] **Step 4.6: Commit**

```bash
git add src/ui/server.ts
git commit -m "feat: add Jira config routes and getJiraClient helper"
```

---

## Task 5: Defect lifecycle routes (draft, file, comment, dismiss, history)

**Files:**
- Modify: `src/ui/server.ts`

### Background

`RunRecord` lives in the existing `runs` Map; persisted to `results/run-{id}.json`. `TestEvent` has `screenshotPath`, `videoPath`, `tracePath` (all relative paths under `test-results/`). The artifact base dir is `config.paths.results` or `'test-results'`. Use the same path-safety pattern from the existing trace API (`baseDir + path.sep`).

### Steps

- [ ] **Step 5.1: Add a helper for resolving + reading artifacts**

Insert near other helpers in `server.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';

function readArtifactBuffer(relPath: string, maxBytes: number): { buffer: Buffer; size: number; tooLarge: boolean } | null {
  if (!relPath) return null;
  const baseDir = path.resolve(config.paths?.testResults || 'test-results');
  const resolved = path.resolve(baseDir, relPath);
  if (!resolved.toLowerCase().startsWith((baseDir + path.sep).toLowerCase())) return null;
  let stat: fs.Stats;
  try { stat = fs.statSync(resolved); } catch { return null; }
  if (stat.size > maxBytes) return { buffer: Buffer.alloc(0), size: stat.size, tooLarge: true };
  return { buffer: fs.readFileSync(resolved), size: stat.size, tooLarge: false };
}

function firstNLines(s: string, n: number): string {
  if (!s) return '';
  return s.split(/\r?\n/).slice(0, n).join('\n');
}
```

- [ ] **Step 5.2: Add the `POST /api/defects/draft` route**

```typescript
// ── Defect lifecycle ─────────────────────────────────────────────────

app.post('/api/defects/draft', requireEditor, async (req: Request, res: Response) => {
  const { runId, testId } = req.body || {};
  if (!runId || !testId) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'runId and testId required' } });
  }
  const run = runs.get(runId);
  if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
  const t = run.tests.find(x => x.testId === testId);
  if (!t) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Test not found in run' } });

  const cfg = loadJiraConfig();
  const existing = findOpenDefect(testId, run.suiteId);

  const descriptionADF = buildDefectDescription({
    testName: t.name,
    testId,
    suiteName: run.suiteName,
    projectName: run.projectName,
    runTimestamp: run.startedAt,
    runId,
    envName: run.environmentName,
    envUrl: '', // server doesn't always know URL; UI can fill if known
    browser: t.browser || (run.browsers?.[0] || 'chromium'),
    os: process.platform,
    steps: (t.steps || []).map((s: any) => `${s.keyword || ''} ${s.locator || s.value || ''}`.trim()).filter(Boolean),
    errorMessage: t.errorMessage || '',
    errorDetailFirst5: firstNLines(t.errorDetail || '', 5),
  });

  const summary = `${t.name} failed in ${run.suiteName}`.slice(0, 255);
  const attachments: Array<{ kind: 'screenshot' | 'video' | 'trace'; path: string; sizeBytes: number; name: string; tooLarge: boolean }> = [];
  const max = (cfg?.maxAttachmentMB ?? 50) * 1024 * 1024;
  for (const [kind, p] of [['screenshot', t.screenshotPath], ['video', t.videoPath], ['trace', t.tracePath]] as const) {
    if (!p) continue;
    const head = readArtifactBuffer(p, max);
    if (!head) continue;
    attachments.push({
      kind, path: p, sizeBytes: head.size,
      name: path.basename(p),
      tooLarge: head.tooLarge,
    });
  }

  res.json({
    summary,
    descriptionADF,
    suggestedPriority: cfg?.defaultPriority || 'Medium',
    attachments,
    existingDefect: existing,
    config: cfg,  // UI uses this for project key + dropdowns
  });
});
```

- [ ] **Step 5.3: Add the `POST /api/defects/file` route**

```typescript
app.post('/api/defects/file', requireEditor, async (req: Request, res: Response) => {
  const { runId, testId, summary, descriptionADF, priority, parentStoryKey, attachKinds } = req.body || {};
  if (!runId || !testId || !summary || !descriptionADF || !priority || !parentStoryKey) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required field' } });
  }
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(String(parentStoryKey))) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'parentStoryKey must look like ABC-123' } });
  }
  const cfg = loadJiraConfig();
  if (!cfg) return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Configure Jira mapping in Admin' } });
  const client = getJiraClient();
  if (!client) return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Set Jira credentials in .env' } });

  const run = runs.get(runId);
  if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
  const t = run.tests.find(x => x.testId === testId);
  if (!t) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Test not found' } });

  // Server-side dedup check (live JQL)
  try {
    const existingKey = await client.searchOpenDefectByTestId(testId, run.suiteId, cfg.projectKey);
    if (existingKey) {
      return res.status(409).json({
        error: { code: 'ALREADY_FILED', message: 'Open defect already exists', details: { defectKey: existingKey, jiraUrl: `${config.jira.baseUrl}/browse/${existingKey}` } },
      });
    }
  } catch (e: any) {
    return res.status(502).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Dedup check failed' } });
  }

  // Create issue
  let created;
  try {
    created = await client.createIssue({
      projectKey: cfg.projectKey,
      issueType: cfg.issueType,
      summary: String(summary).slice(0, 255),
      descriptionADF,
      priority,
      parentStoryKey: String(parentStoryKey),
    });
  } catch (e: any) {
    const status = e?.httpStatus && e.httpStatus >= 400 && e.httpStatus < 500 ? 400 : 502;
    return res.status(status).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Issue creation failed', details: e?.details } });
  }

  // Upload attachments
  const attachStatus: { screenshot?: 'ok' | 'failed' | 'skipped'; video?: 'ok' | 'failed' | 'skipped'; trace?: 'ok' | 'failed' | 'skipped' } = {};
  const max = cfg.maxAttachmentMB * 1024 * 1024;
  const kinds: Array<'screenshot' | 'video' | 'trace'> = Array.isArray(attachKinds) ? attachKinds : [];
  const mimeFor = (k: string) => k === 'screenshot' ? 'image/png' : k === 'video' ? 'video/webm' : 'application/zip';
  for (const k of kinds) {
    const relPath = k === 'screenshot' ? t.screenshotPath : k === 'video' ? t.videoPath : t.tracePath;
    if (!relPath) { attachStatus[k] = 'skipped'; continue; }
    const data = readArtifactBuffer(relPath, max);
    if (!data || data.tooLarge) { attachStatus[k] = 'skipped'; continue; }
    try {
      await client.addAttachment(created.key, { name: path.basename(relPath), buffer: data.buffer, mime: mimeFor(k) });
      attachStatus[k] = 'ok';
    } catch (e: any) {
      logger.warn(`[defect.file] attachment failed`, { key: created.key, kind: k, err: e?.message });
      attachStatus[k] = 'failed';
    }
  }

  // Persist DefectRecord
  const reg = loadDefectsRegistry();
  const jiraUrl = `${config.jira.baseUrl.replace(/\/$/, '')}/browse/${created.key}`;
  const record = {
    defectKey: created.key, jiraId: created.id, testId, testName: t.name,
    suiteId: run.suiteId, suiteName: run.suiteName,
    environmentId: run.environmentId, environmentName: run.environmentName,
    projectId: run.projectId,
    parentStoryKey: String(parentStoryKey),
    status: 'open' as const,
    createdAt: new Date().toISOString(),
    createdBy: req.session.username || 'unknown',
    filedFromRunId: runId, jiraUrl,
    attachments: attachStatus,
    comments: [],
  };
  reg.defects.push(record);
  saveDefectsRegistry(reg);

  // Update RunRecord TestEvent for badge rendering on subsequent loads
  t.defectKey = created.key;
  t.defectStatus = 'open';

  logAudit({ userId: req.session.userId!, username: req.session.username!,
    action: 'DEFECT_FILED', resourceType: 'defect', resourceId: created.key,
    details: `${t.name} (${runId})`, ip: req.ip ?? null });

  res.json({ defectKey: created.key, jiraUrl, attachments: attachStatus });
});
```

- [ ] **Step 5.4: Add the `POST /api/defects/comment` route**

```typescript
app.post('/api/defects/comment', requireEditor, async (req: Request, res: Response) => {
  const { defectKey, runId, testId, attachKinds } = req.body || {};
  if (!defectKey || !runId || !testId) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'defectKey, runId, testId required' } });
  }
  const cfg = loadJiraConfig();
  const client = getJiraClient();
  if (!cfg || !client) return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Jira not configured' } });

  const run = runs.get(runId);
  const t = run?.tests.find(x => x.testId === testId);
  if (!run || !t) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run/test not found' } });

  const body = buildFailureCommentADF({
    runId,
    timestamp: run.startedAt,
    errorMessage: t.errorMessage || '',
    errorDetailFirst5: firstNLines(t.errorDetail || '', 5),
  });
  try {
    const out = await client.addComment(defectKey, body);
    // Optional attachments on comment turn into issue-level attachments
    const max = cfg.maxAttachmentMB * 1024 * 1024;
    const kinds: Array<'screenshot' | 'video' | 'trace'> = Array.isArray(attachKinds) ? attachKinds : [];
    const mimeFor = (k: string) => k === 'screenshot' ? 'image/png' : k === 'video' ? 'video/webm' : 'application/zip';
    for (const k of kinds) {
      const relPath = k === 'screenshot' ? t.screenshotPath : k === 'video' ? t.videoPath : t.tracePath;
      if (!relPath) continue;
      const data = readArtifactBuffer(relPath, max);
      if (!data || data.tooLarge) continue;
      try { await client.addAttachment(defectKey, { name: path.basename(relPath), buffer: data.buffer, mime: mimeFor(k) }); }
      catch (e: any) { logger.warn('[defect.comment] attachment failed', { defectKey, kind: k, err: e?.message }); }
    }
    // Append to local comment log
    const reg = loadDefectsRegistry();
    const d = reg.defects.find(x => x.defectKey === defectKey);
    if (d) {
      d.comments.push({ runId, addedAt: new Date().toISOString(), addedBy: req.session.username || 'unknown' });
      saveDefectsRegistry(reg);
    }
    logAudit({ userId: req.session.userId!, username: req.session.username!,
      action: 'DEFECT_COMMENT', resourceType: 'defect', resourceId: defectKey, details: runId, ip: req.ip ?? null });
    res.json({ commentId: out.id });
  } catch (e: any) {
    res.status(502).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Comment failed' } });
  }
});
```

- [ ] **Step 5.5: Add the `POST /api/defects/dismiss` route**

```typescript
app.post('/api/defects/dismiss', requireEditor, (req: Request, res: Response) => {
  const { runId, testId, category } = req.body || {};
  const validCategories = ['script-issue', 'locator-issue', 'flaky', 'data-issue', 'env-issue'];
  if (!runId || !testId || !validCategories.includes(category)) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
  }
  const run = runs.get(runId);
  const t = run?.tests.find(x => x.testId === testId);
  if (!run || !t) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run/test not found' } });

  appendDismissEntry({
    timestamp: new Date().toISOString(),
    runId, testId, testName: t.name, suiteId: run.suiteId,
    category,
    dismissedBy: req.session.username || 'unknown',
    errorMessage: t.errorMessage || '',
  });
  logAudit({ userId: req.session.userId!, username: req.session.username!,
    action: 'DEFECT_DISMISSED', resourceType: 'test', resourceId: testId, details: category, ip: req.ip ?? null });
  res.json({ ok: true });
});
```

- [ ] **Step 5.6: Add the `GET /api/defects/by-test/:testId` route**

```typescript
app.get('/api/defects/by-test/:testId', requireAuth, (req: Request, res: Response) => {
  const reg = loadDefectsRegistry();
  res.json({ defects: reg.defects.filter(d => d.testId === req.params.testId) });
});
```

- [ ] **Step 5.7: Build, restart and smoke-test**

```bash
npm run build
netstat -ano | findstr :3003 | findstr LISTENING
taskkill //F //PID <pid> && npm run ui >> server.log 2>&1 &
sleep 3 && curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"
```

Expected: `200`. Calls to `/api/defects/draft` with a valid runId+testId return a JSON draft.

- [ ] **Step 5.8: Commit**

```bash
git add src/ui/server.ts
git commit -m "feat: add defect lifecycle routes (draft/file/comment/dismiss/history)"
```

---

## Task 6: Auto-close hook + RunRecord cross-reference for badges

**Files:**
- Modify: `src/ui/server.ts`

### Background

The run-finalization point is where Playwright exits and `record.status` is set to `complete`. Find the existing function that marks a run finished (search for `record.status = 'complete'` or `record.completedAt = ...`). Insert the auto-close hook there. Also: the GET endpoint that serves `/api/run/:runId` (or wherever `RunRecord` is returned to the report) needs to back-fill `defectKey` and `defectStatus` on each TestEvent.

### Steps

- [ ] **Step 6.1: Add the auto-close hook function**

Place near other helpers in `server.ts`:

```typescript
// ── Auto-close defects on next-run pass ──────────────────────────────

async function autoCloseHookOnRunComplete(record: RunRecord): Promise<void> {
  const cfg = loadJiraConfig();
  const client = getJiraClient();
  if (!cfg || !client) return;
  const passedTestIds = new Set(record.tests.filter(t => t.status === 'pass' && t.testId).map(t => t.testId!));
  if (!passedTestIds.size) return;
  const candidates = findOpenDefectsForRun(record.suiteId, record.environmentId)
    .filter(d => passedTestIds.has(d.testId));
  for (const d of candidates) {
    closeDefectAsync(d, record.runId, cfg.closeTransitionName, client).catch(err =>
      logger.warn('[autoClose] failed', { defectKey: d.defectKey, err: err?.message })
    );
  }
}

async function closeDefectAsync(
  defect: DefectRecord, runId: string, transitionName: string, client: JiraClient
): Promise<void> {
  await client.transitionIssue(defect.defectKey, transitionName);
  await client.addComment(defect.defectKey, buildAutoCloseCommentADF(runId, new Date().toISOString()));
  const reg = loadDefectsRegistry();
  const d = reg.defects.find(x => x.defectKey === defect.defectKey);
  if (d) {
    d.status = 'closed';
    d.closedAt = new Date().toISOString();
    d.closedByRunId = runId;
    saveDefectsRegistry(reg);
  }
  logAudit({ userId: 'system', username: 'system',
    action: 'DEFECT_AUTO_CLOSED', resourceType: 'defect', resourceId: defect.defectKey,
    details: runId, ip: null });
  broadcast(runId, { type: 'defect_auto_closed', defectKey: defect.defectKey });
}
```

Add `DefectRecord` to the imports at the top of `server.ts` if not already imported (it's already imported transitively via defectsStore but explicit is clearer):

```typescript
import type { DefectRecord } from '../data/types';
```

- [ ] **Step 6.2: Wire the hook into run finalization**

Find the function that finalizes a `RunRecord` (search `record.status = 'complete'`). After that line and before any `broadcast` of `run:done`, add:

```typescript
  autoCloseHookOnRunComplete(record).catch(err =>
    logger.warn('[autoClose] hook crashed', { runId: record.runId, err: err?.message })
  );
```

(Fire-and-forget — don't block the run finalization on Jira API.)

- [ ] **Step 6.3: Cross-reference defects when serving RunRecord**

Find the route `GET /api/run/:runId` (or whichever endpoint returns `RunRecord` to the report). Before responding, back-fill `defectKey`/`defectStatus` on each test:

```typescript
function attachDefectInfo(record: RunRecord): RunRecord {
  const reg = loadDefectsRegistry();
  for (const t of record.tests) {
    if (!t.testId) continue;
    const d = reg.defects.find(x => x.testId === t.testId && x.suiteId === record.suiteId);
    if (d) { t.defectKey = d.defectKey; t.defectStatus = d.status; }
  }
  return record;
}
```

In the run-fetch route, replace `res.json(record)` with `res.json(attachDefectInfo(record))`.

- [ ] **Step 6.4: Build, restart and verify compilation**

```bash
npm run build
netstat -ano | findstr :3003 | findstr LISTENING
taskkill //F //PID <pid> && npm run ui >> server.log 2>&1 &
sleep 3 && curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"
```

Expected: 200.

- [ ] **Step 6.5: Commit**

```bash
git add src/ui/server.ts
git commit -m "feat: auto-close hook on next-run pass + defect badge cross-ref"
```

---

## Task 7: Admin UI — Jira Integration panel

**Files:**
- Modify: `src/ui/public/index.html`
- Modify: `src/ui/public/modules.js`

### Background

Notification Settings live as a panel in `index.html` (search for "Notification Settings" or `panel-notify`). Add a new collapsible section matching the pattern.

### Steps

- [ ] **Step 7.1: Add the Jira section to `index.html`**

Find the existing Notification Settings panel and append after the last sub-section:

```html
<!-- Jira Integration -->
<div class="settings-section">
  <div class="settings-section-header" onclick="this.parentElement.classList.toggle('open')">
    <span class="caret">▶</span>
    <span style="font-weight:700">Jira Integration</span>
    <span id="jira-status-badge" style="margin-left:auto;font-size:11.5px;color:var(--neutral-400)">Not configured</span>
  </div>
  <div class="settings-section-body">
    <div id="jira-creds-warning" style="display:none;margin-bottom:10px;padding:9px 13px;border-radius:6px;background:#fee2e2;border:1px solid #fca5a5;color:#7f1d1d;font-size:12.5px">
      ⚠ Credentials missing. Set <code>JIRA_BASE_URL</code>, <code>JIRA_EMAIL</code>, <code>JIRA_API_TOKEN</code> in <code>.env</code>, then restart server.
    </div>
    <div class="field"><label>Project Key *</label><input id="jira-project-key" type="text" placeholder="e.g. BSM" /></div>
    <div class="field"><label>Issue Type *</label><input id="jira-issue-type" type="text" value="Defect" /></div>
    <div class="field"><label>Default Priority *</label>
      <select id="jira-default-priority">
        <option>Highest</option><option>High</option><option selected>Medium</option><option>Low</option><option>Lowest</option>
      </select>
    </div>
    <div class="field"><label>Parent / User Story Field ID *</label><select id="jira-parent-field"><option value="">(Discover fields first)</option></select></div>
    <div class="field"><label>Refer SS Field ID (optional)</label><select id="jira-refer-ss-field"><option value="">(none)</option></select></div>
    <div class="field"><label>Auto-Close Transition Name *</label><input id="jira-close-transition" type="text" value="Closed" /></div>
    <div class="field"><label>Max Attachment Size (MB)</label><input id="jira-max-attach-mb" type="number" value="50" min="1" max="500" /></div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button onclick="jiraTestConnection()" class="btn">Test Connection</button>
      <button onclick="jiraDiscoverFields()" class="btn">Discover Fields</button>
      <button onclick="jiraConfigSave()" class="btn btn-primary">Save Configuration</button>
    </div>
    <div id="jira-config-msg" style="margin-top:10px;font-size:12.5px"></div>
  </div>
</div>
```

- [ ] **Step 7.2: Add JS handlers to `modules.js`**

Append at the end of `modules.js`:

```javascript
// ── Jira Integration admin panel ─────────────────────────────────────

async function jiraConfigLoad() {
  try {
    const r = await fetch('/api/jira/config');
    const cfg = await r.json();
    if (!cfg) {
      document.getElementById('jira-status-badge').textContent = 'Not configured';
      return;
    }
    document.getElementById('jira-project-key').value       = cfg.projectKey || '';
    document.getElementById('jira-issue-type').value        = cfg.issueType || 'Defect';
    document.getElementById('jira-default-priority').value  = cfg.defaultPriority || 'Medium';
    document.getElementById('jira-close-transition').value  = cfg.closeTransitionName || 'Closed';
    document.getElementById('jira-max-attach-mb').value     = cfg.maxAttachmentMB || 50;
    // Field dropdowns: pre-seed with the saved IDs so they show even before discovery
    if (cfg.parentLinkFieldId) {
      const sel = document.getElementById('jira-parent-field');
      sel.innerHTML = `<option value="${cfg.parentLinkFieldId}">${cfg.parentLinkFieldId} (saved)</option>`;
    }
    if (cfg.referSSFieldId) {
      const sel = document.getElementById('jira-refer-ss-field');
      sel.innerHTML = `<option value="${cfg.referSSFieldId}">${cfg.referSSFieldId} (saved)</option>`;
    }
    document.getElementById('jira-status-badge').textContent = '✓ Configured';
  } catch (e) {
    document.getElementById('jira-status-badge').textContent = 'Load failed';
  }
}

async function jiraTestConnection() {
  const msg = document.getElementById('jira-config-msg');
  msg.textContent = '⏳ Testing...'; msg.style.color = '';
  const r = await fetch('/api/jira/test', { method: 'POST' });
  const j = await r.json();
  if (j.ok) { msg.style.color = '#16a34a'; msg.textContent = `✓ Connected as ${j.user || 'unknown'}`; }
  else { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j.error || j?.error?.message || 'Connection failed'}`; }
}

async function jiraDiscoverFields() {
  const msg = document.getElementById('jira-config-msg');
  msg.textContent = '⏳ Discovering...'; msg.style.color = '';
  const r = await fetch('/api/jira/fields');
  const j = await r.json();
  if (!r.ok) { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j?.error?.message || 'Discovery failed'}`; return; }
  const fields = (j.fields || []).filter(f => f.custom);
  const opts = fields.map(f => `<option value="${f.id}">${f.name} (${f.id})</option>`).join('');
  document.getElementById('jira-parent-field').innerHTML    = '<option value="">— pick parent field —</option>' + opts;
  document.getElementById('jira-refer-ss-field').innerHTML  = '<option value="">— none —</option>' + opts;
  msg.style.color = '#16a34a'; msg.textContent = `✓ ${fields.length} custom fields loaded`;
}

async function jiraConfigSave() {
  const body = {
    projectKey:           document.getElementById('jira-project-key').value.trim(),
    issueType:            document.getElementById('jira-issue-type').value.trim(),
    defaultPriority:      document.getElementById('jira-default-priority').value,
    parentLinkFieldId:    document.getElementById('jira-parent-field').value,
    referSSFieldId:       document.getElementById('jira-refer-ss-field').value,
    closeTransitionName:  document.getElementById('jira-close-transition').value.trim(),
    maxAttachmentMB:      Number(document.getElementById('jira-max-attach-mb').value) || 50,
  };
  const msg = document.getElementById('jira-config-msg');
  const r = await fetch('/api/jira/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.ok) { msg.style.color = '#16a34a'; msg.textContent = '✓ Saved'; document.getElementById('jira-status-badge').textContent = '✓ Configured'; }
  else { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j?.error?.message || 'Save failed'}`; }
}
```

- [ ] **Step 7.3: Wire `jiraConfigLoad` into the panel-open path**

Find where notification panel is loaded (search for `notifyConfigLoad` or similar function name). Where that function is called on Notification Settings panel activation, add:

```javascript
jiraConfigLoad();
```

- [ ] **Step 7.4: Verify in browser**

Static files — no restart needed. Hard-refresh `localhost:3003` → log in as Admin → open Notification Settings → expand Jira Integration. Click Test Connection (will report failure if `.env` not set, that's expected). Save with valid values. Reload — values persist.

- [ ] **Step 7.5: Commit**

```bash
git add src/ui/public/index.html src/ui/public/modules.js
git commit -m "feat: Jira Integration admin panel with test connection + field discovery"
```

---

## Task 8: Execution report — File Defect button + modal + badge

**Files:**
- Modify: `src/ui/public/execution-report.html`

### Background

The button goes in the failed test row's action cell (the same row that hosts the Trace button). The modal pattern follows the existing trace-modal pattern (overlay + inner panel + close button + Escape-key handler). Live-page JS lives in the `<script>` block we recently added near line 1607 (after the export-template script). Add new functions there.

### Steps

- [ ] **Step 8.1: Add CSS for defect modal and badge**

In `execution-report.html`, find the style block (search `.trace-modal-overlay`) and append:

```css
.defect-btn {
  display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:14px;
  font-size:11.5px; font-weight:700; cursor:pointer; border:none; transition:.15s;
}
.defect-btn-file   { background:#fef3c7; color:#92400e; }
.defect-btn-file:hover { background:#fde68a; }
.defect-btn-file[disabled] { background:#e5e7eb; color:#9ca3af; cursor:not-allowed; }
.defect-btn-open   { background:#fee2e2; color:#7f1d1d; }
.defect-btn-closed { background:#d1fae5; color:#065f46; }

.defect-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:9998; display:flex; align-items:center; justify-content:center; }
.defect-modal-overlay[hidden] { display:none; }
.defect-modal-inner   { width:80vw; max-width:1100px; height:90vh; background:#fff; border-radius:8px; display:flex; flex-direction:column; }
.defect-modal-header  { padding:14px 18px; border-bottom:1px solid #e5e7eb; font-weight:700; display:flex; align-items:center; justify-content:space-between; }
.defect-modal-body    { flex:1; overflow:auto; padding:16px 18px; }
.defect-modal-footer  { padding:12px 18px; border-top:1px solid #e5e7eb; display:flex; gap:8px; justify-content:flex-end; }
.defect-section       { margin-bottom:14px; }
.defect-section h4    { margin:0 0 6px; font-size:12.5px; color:#374151; }
.defect-section textarea, .defect-section input { width:100%; box-sizing:border-box; padding:7px 10px; border:1px solid #d1d5db; border-radius:5px; font:inherit; font-size:13px; }
.defect-section textarea { min-height:90px; resize:vertical; }
.defect-banner-warn   { padding:10px 14px; background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; color:#9a3412; margin-bottom:14px; }
.defect-banner-error  { padding:10px 14px; background:#fee2e2; border:1px solid #fca5a5; border-radius:6px; color:#7f1d1d; margin-bottom:14px; }
.defect-banner-ok     { padding:10px 14px; background:#d1fae5; border:1px solid #6ee7b7; border-radius:6px; color:#065f46; margin-bottom:14px; }
```

- [ ] **Step 8.2: Add the modal DOM near `</body>`**

Just before the existing trace modal markup:

```html
<!-- Defect Modal -->
<div id="defect-modal" class="defect-modal-overlay" hidden>
  <div class="defect-modal-inner">
    <div class="defect-modal-header">
      <span id="defect-modal-title">🐞 File Defect to Jira</span>
      <button onclick="closeDefectModal()">&#10005; Close</button>
    </div>
    <div class="defect-modal-body" id="defect-modal-body">Loading…</div>
    <div class="defect-modal-footer" id="defect-modal-footer"></div>
  </div>
</div>
```

- [ ] **Step 8.3: Render the defect button per failed test row**

Find the test row rendering code (search for the row that includes `tc-btn-tr` for trace). Add a defect button cell next to it (this lives inside `buildRow` or similar — search the file). Insert after the trace button construction:

```javascript
// Defect button (failed tests only)
let defectCell = '';
if (t.status === 'fail' && t.testId) {
  if (t.defectKey) {
    const cls = t.defectStatus === 'closed' ? 'defect-btn-closed' : 'defect-btn-open';
    const label = t.defectStatus === 'closed' ? 'Closed' : 'Open';
    defectCell = `<button class="defect-btn ${cls}"
      onclick="event.stopPropagation();openDefectExisting(${esc(JSON.stringify(t.defectKey))})"
      title="View defect ${esc(t.defectKey)}">🐞 ${esc(t.defectKey)} (${label})</button>`;
  } else {
    defectCell = `<button class="defect-btn defect-btn-file"
      onclick="event.stopPropagation();openDefectModal(${esc(JSON.stringify(r.runId))},${esc(JSON.stringify(t.testId))})"
      title="File a Jira defect for this failure">🐞 File Defect</button>`;
  }
}
```

Then include `defectCell` in the row's HTML where appropriate (next to `traceCell`).

- [ ] **Step 8.4: Add live-page JS for the modal**

In the existing live-page `<script>` block (where `openTraceViewer` / `closeTraceModal` etc. live), append:

```javascript
// ── Defect Modal (live page) ─────────────────────────────────────────

let _defectDraft = null;  // cached draft response

async function openDefectModal(runId, testId) {
  const m = document.getElementById('defect-modal');
  const body = document.getElementById('defect-modal-body');
  const footer = document.getElementById('defect-modal-footer');
  m.hidden = false;
  body.innerHTML = '⏳ Loading draft…';
  footer.innerHTML = '';
  let draft;
  try {
    const r = await fetch('/api/defects/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, testId }),
    });
    draft = await r.json();
    if (!r.ok) throw new Error(draft?.error?.message || 'Draft failed');
  } catch (e) {
    body.innerHTML = `<div class="defect-banner-error">✗ ${esc2(e.message)}</div>`;
    return;
  }
  _defectDraft = { runId, testId, draft };

  // Existing-defect banner
  if (draft.existingDefect) {
    const d = draft.existingDefect;
    body.innerHTML = `
      <div class="defect-banner-warn">
        ⚠ Already filed as <strong>${esc2(d.defectKey)}</strong> (${esc2(d.status)}).<br>
        <a href="${esc2(d.jiraUrl)}" target="_blank">Open in Jira ↗</a>
      </div>
      <p>You can add this run's failure as a comment on the existing ticket, or cancel.</p>`;
    footer.innerHTML = `
      <button class="btn" onclick="closeDefectModal()">Cancel</button>
      <button class="btn btn-primary" onclick="commentOnExisting(${esc2(JSON.stringify(d.defectKey))})">Add as Comment</button>`;
    return;
  }

  // Draft form
  const cfg = draft.config || {};
  const attachRows = (draft.attachments || []).map(a => `
    <label style="display:block;margin:4px 0">
      <input type="checkbox" class="defect-attach" data-kind="${esc2(a.kind)}" ${a.tooLarge ? 'disabled' : 'checked'}>
      ${esc2(a.kind)} — ${esc2(a.name)} (${(a.sizeBytes/1024/1024).toFixed(2)} MB)
      ${a.tooLarge ? '<span style="color:#dc2626"> — too large, will be skipped</span>' : ''}
    </label>`).join('');

  body.innerHTML = `
    <div class="defect-section">
      <h4>Project Key</h4>
      <input id="dfx-project-key" type="text" value="${esc2(cfg.projectKey || '')}" readonly />
    </div>
    <div class="defect-section">
      <h4>Issue Type</h4>
      <input id="dfx-issue-type" type="text" value="${esc2(cfg.issueType || 'Defect')}" readonly />
    </div>
    <div class="defect-section">
      <h4>Priority *</h4>
      <select id="dfx-priority">
        ${['Highest','High','Medium','Low','Lowest'].map(p =>
          `<option ${(draft.suggestedPriority === p ? 'selected' : '')}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="defect-section">
      <h4>User Story * (e.g. ${esc2(cfg.projectKey || 'PROJ')}-123)</h4>
      <input id="dfx-parent" type="text" placeholder="${esc2(cfg.projectKey || 'PROJ')}-_____" />
    </div>
    <div class="defect-section">
      <h4>Summary *</h4>
      <input id="dfx-summary" type="text" value="${esc2(draft.summary || '')}" maxlength="255" />
    </div>
    <div class="defect-section">
      <h4>Description (auto-built — sections rendered into Jira description field)</h4>
      <textarea id="dfx-description-preview" readonly>${esc2(adfPreview(draft.descriptionADF))}</textarea>
      <div style="font-size:11.5px;color:#6b7280;margin-top:4px">Note: rich-text formatting preserved in Jira (this is a preview only). Edit "Expected Result" in Jira after creation.</div>
    </div>
    <div class="defect-section">
      <h4>Attachments</h4>
      ${attachRows || '<em>(no artifacts available)</em>'}
    </div>
    <div id="dfx-msg" style="margin-top:8px;font-size:12.5px"></div>
  `;
  footer.innerHTML = `
    <button class="btn" onclick="closeDefectModal()">Cancel</button>
    <select id="dfx-dismiss-cat" style="padding:6px 10px;border-radius:5px">
      <option value="">Not a Bug ▾</option>
      <option value="script-issue">script-issue</option>
      <option value="locator-issue">locator-issue</option>
      <option value="flaky">flaky</option>
      <option value="data-issue">data-issue</option>
      <option value="env-issue">env-issue</option>
    </select>
    <button class="btn" onclick="dismissDefectFromModal()">Dismiss</button>
    <button class="btn btn-primary" onclick="approveAndFile()">Approve & File</button>
  `;
}

function adfPreview(adf) {
  if (!adf || !adf.content) return '';
  const lines = [];
  for (const node of adf.content) {
    if (node.type === 'heading') lines.push('\n## ' + (node.content?.[0]?.text || ''));
    else if (node.type === 'paragraph') lines.push((node.content || []).map(c => c.text || '').join(''));
    else if (node.type === 'orderedList') (node.content || []).forEach((li, i) =>
      lines.push((i+1) + '. ' + (li.content?.[0]?.content?.[0]?.text || '')));
    else if (node.type === 'codeBlock') lines.push('```\n' + (node.content?.[0]?.text || '') + '\n```');
  }
  return lines.join('\n');
}

function closeDefectModal() {
  document.getElementById('defect-modal').hidden = true;
  _defectDraft = null;
}

async function approveAndFile() {
  if (!_defectDraft) return;
  const parent = document.getElementById('dfx-parent').value.trim();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(parent)) {
    document.getElementById('dfx-msg').innerHTML = '<span style="color:#dc2626">User Story key must look like ABC-123</span>';
    return;
  }
  const summary  = document.getElementById('dfx-summary').value.trim();
  if (!summary) { document.getElementById('dfx-msg').innerHTML = '<span style="color:#dc2626">Summary required</span>'; return; }
  const priority = document.getElementById('dfx-priority').value;
  const attachKinds = Array.from(document.querySelectorAll('.defect-attach'))
    .filter(c => c.checked && !c.disabled).map(c => c.dataset.kind);

  document.getElementById('dfx-msg').textContent = '⏳ Filing…';
  const r = await fetch('/api/defects/file', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: _defectDraft.runId, testId: _defectDraft.testId,
      summary, descriptionADF: _defectDraft.draft.descriptionADF,
      priority, parentStoryKey: parent, attachKinds,
    }),
  });
  const j = await r.json();
  const msg = document.getElementById('dfx-msg');
  if (r.ok) {
    msg.innerHTML = `<div class="defect-banner-ok">✓ Filed as <strong>${esc2(j.defectKey)}</strong>. <a href="${esc2(j.jiraUrl)}" target="_blank">Open in Jira ↗</a></div>`;
    document.getElementById('defect-modal-footer').innerHTML = `<button class="btn btn-primary" onclick="location.reload()">Close & Refresh</button>`;
  } else if (r.status === 409) {
    const existing = j?.error?.details || {};
    msg.innerHTML = `<div class="defect-banner-warn">⚠ Already filed as <strong>${esc2(existing.defectKey)}</strong>. <a href="${esc2(existing.jiraUrl)}" target="_blank">Open in Jira ↗</a></div>`;
  } else {
    msg.innerHTML = `<div class="defect-banner-error">✗ ${esc2(j?.error?.message || 'File failed')}</div>`;
  }
}

async function commentOnExisting(defectKey) {
  if (!_defectDraft) return;
  document.getElementById('defect-modal-body').innerHTML = '⏳ Posting comment…';
  const r = await fetch('/api/defects/comment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      defectKey, runId: _defectDraft.runId, testId: _defectDraft.testId,
      attachKinds: ['screenshot'],
    }),
  });
  const j = await r.json();
  const body = document.getElementById('defect-modal-body');
  if (r.ok) body.innerHTML = `<div class="defect-banner-ok">✓ Comment posted on ${esc2(defectKey)}</div>`;
  else body.innerHTML = `<div class="defect-banner-error">✗ ${esc2(j?.error?.message || 'Comment failed')}</div>`;
  document.getElementById('defect-modal-footer').innerHTML = `<button class="btn btn-primary" onclick="closeDefectModal()">Close</button>`;
}

async function dismissDefectFromModal() {
  if (!_defectDraft) return;
  const cat = document.getElementById('dfx-dismiss-cat').value;
  if (!cat) { document.getElementById('dfx-msg').innerHTML = '<span style="color:#dc2626">Pick a category</span>'; return; }
  const r = await fetch('/api/defects/dismiss', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: _defectDraft.runId, testId: _defectDraft.testId, category: cat }),
  });
  const body = document.getElementById('defect-modal-body');
  if (r.ok) body.innerHTML = `<div class="defect-banner-ok">✓ Logged as: ${esc2(cat)}</div>`;
  else body.innerHTML = `<div class="defect-banner-error">✗ Dismiss failed</div>`;
  document.getElementById('defect-modal-footer').innerHTML = `<button class="btn btn-primary" onclick="closeDefectModal()">Close</button>`;
}

async function openDefectExisting(defectKey) {
  // Opens defect in new tab using Jira URL captured from the running record
  const m = document.getElementById('defect-modal');
  const body = document.getElementById('defect-modal-body');
  const footer = document.getElementById('defect-modal-footer');
  m.hidden = false;
  body.innerHTML = `<p>Defect <strong>${esc2(defectKey)}</strong> is already filed for this test.</p>
    <p>Use the link below to open it in Jira.</p>`;
  footer.innerHTML = `
    <button class="btn" onclick="closeDefectModal()">Close</button>
    <a class="btn btn-primary" href="https://example.atlassian.net/browse/${encodeURIComponent(defectKey)}" target="_blank" rel="noopener">Open in Jira ↗</a>`;
}

// Escape closes defect modal (only when visible). Keep separate guard from trace handler.
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  const dm = document.getElementById('defect-modal');
  if (dm && !dm.hidden) closeDefectModal();
});
```

**Note:** `openDefectExisting` uses a hardcoded Jira base URL placeholder. Replace `https://example.atlassian.net` with the actual base URL from the run's defect record. Pull it from the defect record on the test event — modify the row rendering (Step 8.3) to also pass the URL:

Update Step 8.3's defect button to use the registry-provided URL. To avoid leaking the Jira base URL into the report, instead pass a relative endpoint and have the server redirect:

Add a server route in `server.ts` after Task 5:

```typescript
app.get('/api/defects/open/:defectKey', requireAuth, (req: Request, res: Response) => {
  const reg = loadDefectsRegistry();
  const d = reg.defects.find(x => x.defectKey === req.params.defectKey);
  if (!d) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Defect not found' } });
  res.redirect(d.jiraUrl);
});
```

Then update `openDefectExisting` body's anchor href to `/api/defects/open/${encodeURIComponent(defectKey)}`.

- [ ] **Step 8.5: Add the redirect route to `server.ts`**

Add the route shown above near the other `/api/defects/*` routes.

- [ ] **Step 8.6: Build, restart, hard-refresh and verify**

```bash
npm run build
netstat -ano | findstr :3003 | findstr LISTENING
taskkill //F //PID <pid> && npm run ui >> server.log 2>&1 &
sleep 3 && curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"
```

Hard-refresh execution-report URL of a run with a failed test. Verify:
- `[🐞 File Defect]` button visible on failed row
- Clicking opens modal with auto-filled summary + description preview
- Submitting with empty User Story shows inline validation
- Cancel closes modal

- [ ] **Step 8.7: Commit**

```bash
git add src/ui/public/execution-report.html src/ui/server.ts
git commit -m "feat: defect button + modal + badge on execution report"
```

---

## Task 9: Manual end-to-end testing + docs update

**Files:**
- Modify: `CLAUDE.md` (mark feature complete, add pointer to plan)
- Modify: `docs/PRODUCT_BACKLOG.md` (mark P1 complete)

### Background

End-to-end requires a real Jira sandbox. Use the test environment (`pnmx.atlassian.net`). Configure mapping, file a real defect, verify in Jira UI, then trigger a pass to verify auto-close.

### Steps

- [ ] **Step 9.1: Run the manual test checklist**

Following the checklist in the spec (`docs/superpowers/specs/2026-04-27-auto-file-defect-design.md`, "Manual Test Checklist" section), execute scenarios 1-15 against a real Jira instance. Document any failures.

For each test, record observed behavior. Stop on the first failure and fix it (file an issue or repair inline) before continuing.

- [ ] **Step 9.2: Update `CLAUDE.md`**

Find the section listing features under "USER COMMANDS" → "Superpowers Commands" table, and the spec/plan pointer block near the top. Update:

Add to the spec/plan pointer block:

```markdown
> **📋 See [docs/superpowers/specs/2026-04-27-auto-file-defect-design.md](docs/superpowers/specs/2026-04-27-auto-file-defect-design.md) — Auto-File Jira Defect design spec. FEATURE IS COMPLETE (2026-04-27).**
> **📋 See [docs/superpowers/plans/2026-04-27-auto-file-defect.md](docs/superpowers/plans/2026-04-27-auto-file-defect.md) — Auto-File Defect 9-task plan. ALL TASKS COMPLETE (2026-04-27).**
```

Add a new architecture section after the TRACE VIEWER section:

```markdown
## AUTO-FILE JIRA DEFECT — COMPLETE (2026-04-27)

**Status:** Shipped 2026-04-27
**Spec:** `docs/superpowers/specs/2026-04-27-auto-file-defect-design.md`
**Plan:** `docs/superpowers/plans/2026-04-27-auto-file-defect.md`

**Key files:**
- `src/utils/jiraClient.ts` — pure REST wrapper
- `src/utils/adfBuilder.ts` — ADF body builders (description / comment)
- `src/utils/defectsStore.ts` — `data/jira-config.json` + `data/defects.json` + `data/dismissed-defects.ndjson`
- `src/ui/server.ts` — `/api/jira/*` and `/api/defects/*` routes; auto-close hook in run finalization
- `src/ui/public/index.html` — Admin Jira Integration panel
- `src/ui/public/execution-report.html` — defect button, modal, badge

**Invariants:**
- Editor role required for filing/commenting/dismissing; Admin for config
- Credentials in `.env` (`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`); mapping in UI
- Dedup uses live JQL `text ~ testId` plus local registry on `(testId, suiteId, status=open)`
- Auto-close scoped to `(testId, suiteId, environmentId)`; failure tolerated, retried next run
- All errors use envelope `{ error: { code, message, details? } }`
```

Add to the Superpowers Commands table:

```markdown
| `implement defect filing` or `execute the defect plan` | Load `docs/superpowers/plans/2026-04-27-auto-file-defect.md` — **ALREADY COMPLETE as of 2026-04-27** |
```

- [ ] **Step 9.3: Update `PRODUCT_BACKLOG.md`**

Find "Priority 1 — Auto-File Jira/ADO Defect on Test Failure (with Human Validation Gate)" and move the entire entry to the **COMPLETED FEATURES** table at the top of the file. New row:

```markdown
| Auto-File Jira Defect | Human-validated draft modal on Execution Report; embedded attachments; auto-close on next-run pass; "Not a Bug" classify feeds Flakiness/Locator engines |
```

Renumber the remaining priorities P2-P8 → P1-P7.

- [ ] **Step 9.4: Commit**

```bash
git add CLAUDE.md docs/PRODUCT_BACKLOG.md
git commit -m "docs: Auto-File Jira Defect feature complete; mark P1 done in backlog"
```

---

## Self-Review Notes

Run `npm run test:unit` after Tasks 1-3 — all unit tests must pass before moving to integration tasks. Run `npm run build` after every server.ts edit. Hard-refresh browser (Ctrl+Shift+R) for static-file changes; restart server only after `src/` TS changes.

Edge cases to keep in mind during implementation:
- `runs` Map is in-memory. After server restart, old runs are reloaded from `results/run-*.json`. Make sure the `attachDefectInfo` cross-reference works for both in-memory and reloaded records.
- `t.steps` may be missing on old runs — `(t.steps || [])` is critical.
- `t.testId` may be missing on pre-Flakiness-Intelligence runs — guard with `if (!t.testId) continue;` (already in plan).
- `process.platform` in adfBuilder input is the SERVER's OS, not the AUT's. Acceptable for v1; document if needed.

The spec promised "Refer SS field" handling — v1 uses standard `/attachments` endpoint. The `referSSFieldId` config is captured but unused in v1, ready for a future enhancement that wants to populate a custom field with attachment links/ids.
