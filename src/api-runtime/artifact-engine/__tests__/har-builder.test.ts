import { describe, it, expect } from 'vitest';
import { buildHar } from '../har-builder';
import type { ApiStepResult } from '../../../../data/types';

function makeStep(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 's1', stepName: 'Step 1', status: 'passed',
    request: { method: 'GET', url: 'https://api.test/resource', headers: {}, bodyType: 'none' } as never,
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: { id: 1 }, bodyTruncated: false, durationMs: 42 },
    assertionResults: [], extractedVariables: {}, durationMs: 42,
    ...overrides,
  };
}

describe('buildHar', () => {
  it('returns HarArtifact with correct metadata', () => {
    const har = buildHar('run1', 'col1', [makeStep()]);
    expect(har.harVersion).toBe('1.2');
    expect(har.runId).toBe('run1');
    expect(har.collectionId).toBe('col1');
  });

  it('builds one entry per step with response', () => {
    const har = buildHar('run1', 'col1', [makeStep(), makeStep({ stepId: 's2', stepName: 'Step 2' })]);
    expect(har.entries).toHaveLength(2);
  });

  it('skips steps without response', () => {
    const noResp = makeStep({ response: undefined });
    const har = buildHar('run1', 'col1', [noResp]);
    expect(har.entries).toHaveLength(0);
  });

  it('entry has correct method and url', () => {
    const har = buildHar('run1', 'col1', [makeStep()]);
    expect(har.entries[0].request.method).toBe('GET');
    expect(har.entries[0].request.url).toBe('https://api.test/resource');
  });

  it('entry response has status', () => {
    const har = buildHar('run1', 'col1', [makeStep()]);
    expect(har.entries[0].response.status).toBe(200);
  });

  it('converts headers to name/value array', () => {
    const har = buildHar('run1', 'col1', [makeStep()]);
    const ct = har.entries[0].response.headers.find(h => h.name === 'content-type');
    expect(ct?.value).toBe('application/json');
  });

  it('returns empty entries for empty step list', () => {
    const har = buildHar('run1', 'col1', []);
    expect(har.entries).toHaveLength(0);
  });
});
