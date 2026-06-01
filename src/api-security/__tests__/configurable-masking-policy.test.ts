// src/api-security/__tests__/configurable-masking-policy.test.ts
import { describe, it, expect } from 'vitest';
import { ConfigurableMaskingPolicy, DEFAULT_MASKING_CONFIG } from '../configurable-masking-policy';

describe('ConfigurableMaskingPolicy', () => {
  const policy = new ConfigurableMaskingPolicy();

  it('maskHeaders: masks authorization header', () => {
    const { masked, report } = policy.maskHeaders({ authorization: 'Bearer abc', 'content-type': 'application/json' });
    expect(masked['authorization']).toBe('***');
    expect(masked['content-type']).toBe('application/json');
    expect(report.maskedHeaders).toContain('authorization');
  });

  it('maskHeaders: masks x-api-key', () => {
    const { masked } = policy.maskHeaders({ 'x-api-key': 'secret123', accept: '*/*' });
    expect(masked['x-api-key']).toBe('***');
    expect(masked['accept']).toBe('*/*');
  });

  it('maskVariables: masks password and token', () => {
    const { masked, report } = policy.maskVariables({ password: 'hunter2', username: 'alice', token: 'abc' });
    expect(masked['password']).toBe('***');
    expect(masked['token']).toBe('***');
    expect(masked['username']).toBe('alice');
    expect(report.maskedFields).toContain('password');
  });

  it('maskBodyFields: masks access_token field', () => {
    const { masked } = policy.maskBodyFields({ access_token: 'tok', name: 'Test' });
    expect(masked['access_token']).toBe('***');
    expect(masked['name']).toBe('Test');
  });

  it('mergeReports: sums totals correctly', () => {
    const r1 = { appliedAt: new Date().toISOString(), maskedFields: ['a'], maskedHeaders: ['b'], totalMasked: 2 };
    const r2 = { appliedAt: new Date().toISOString(), maskedFields: ['c'], maskedHeaders: [], totalMasked: 1 };
    const merged = policy.mergeReports(r1, r2);
    expect(merged.totalMasked).toBe(3);
    expect(merged.maskedFields).toContain('a');
    expect(merged.maskedFields).toContain('c');
  });

  it('config uses defaults', () => {
    expect(policy.config.maskToken).toBe('***');
    expect(policy.config.maskReplayPayloads).toBe(true);
    expect(policy.config.maskAiOverlays).toBe(true);
  });
});
