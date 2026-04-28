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
    const headings = adf.content!
      .filter((n: any) => n.type === 'heading')
      .map((n: any) => n.content[0].text);
    expect(headings).toEqual([
      'Description', 'Precondition', 'Steps', 'Actual Result', 'Expected Result',
    ]);
  });

  it('renders steps as orderedList', () => {
    const adf = buildDefectDescription(base);
    const list = adf.content!.find((n: any) => n.type === 'orderedList');
    expect(list).toBeDefined();
    expect(list!.content!).toHaveLength(2);
  });

  it('renders error in codeBlock', () => {
    const adf = buildDefectDescription(base);
    const code = adf.content!.find((n: any) => n.type === 'codeBlock');
    expect(code).toBeDefined();
    expect(JSON.stringify(code)).toContain('TimeoutError');
  });

  it('renders empty Expected Result placeholder', () => {
    const adf = buildDefectDescription(base);
    const idx = adf.content!.findIndex(
      (n: any) => n.type === 'heading' && n.content![0].text === 'Expected Result'
    );
    expect(idx).toBeGreaterThan(-1);
    const next = adf.content![idx + 1];
    expect(next.type).toBe('paragraph');
  });

  it('handles empty steps array gracefully', () => {
    const adf = buildDefectDescription({ ...base, steps: [] });
    const list = adf.content!.find((n: any) => n.type === 'orderedList');
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
