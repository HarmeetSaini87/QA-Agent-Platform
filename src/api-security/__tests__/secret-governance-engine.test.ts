// src/api-security/__tests__/secret-governance-engine.test.ts
import { describe, it, expect } from 'vitest';
import { SecretGovernanceEngine } from '../secret-governance-engine';

describe('SecretGovernanceEngine', () => {
  const engine = new SecretGovernanceEngine();

  it('classify: api-key patterns', () => {
    expect(engine.classify('api_key')).toBe('api-key');
    expect(engine.classify('apiKey')).toBe('api-key');
    expect(engine.classify('X_API_KEY')).toBe('api-key');
  });

  it('classify: auth-token patterns', () => {
    expect(engine.classify('auth_token')).toBe('auth-token');
    expect(engine.classify('access_token')).toBe('auth-token');
  });

  it('classify: password patterns', () => {
    expect(engine.classify('password')).toBe('password');
    expect(engine.classify('passwd')).toBe('password');
  });

  it('classify: returns null for innocent fields', () => {
    expect(engine.classify('username')).toBeNull();
    expect(engine.classify('status')).toBeNull();
    expect(engine.classify('collectionId')).toBeNull();
  });

  it('isSecret: true for secret keys', () => {
    expect(engine.isSecret('api_key')).toBe(true);
    expect(engine.isSecret('token')).toBe(true);
  });

  it('isSecret: false for non-secret keys', () => {
    expect(engine.isSecret('collectionId')).toBe(false);
    expect(engine.isSecret('stepName')).toBe(false);
  });

  it('scanRecord: detects violations in replay layer', () => {
    const record = { api_key: 'abc123', stepId: 'step-1' };
    const violations = engine.scanRecord(record, 'replay');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].layer).toBe('replay');
    expect(violations[0].field).toBe('api_key');
  });

  it('scanRecord: skips already-masked values', () => {
    const record = { api_key: '***', token: '[REDACTED]' };
    const violations = engine.scanRecord(record, 'audit');
    expect(violations).toHaveLength(0);
  });

  it('scanRecord: returns empty for clean records', () => {
    const record = { stepId: 's1', outcome: 'passed' };
    expect(engine.scanRecord(record, 'graph')).toHaveLength(0);
  });
});
