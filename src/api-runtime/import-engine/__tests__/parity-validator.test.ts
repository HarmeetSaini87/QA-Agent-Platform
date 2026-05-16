import { describe, it, expect } from 'vitest';
import { validatePostmanParity } from '../parity-validator';

const singleRequestPM = JSON.stringify({
  info: { name: 'Parity Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{
    name: 'GET /ping',
    request: { method: 'GET', url: { raw: 'https://api.example.com/ping' } }
  }]
});

describe('validatePostmanParity', () => {
  it('returns parity report without throwing', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(report).toBeDefined();
  });

  it('reports step count from both importers', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(typeof report.legacyStepCount).toBe('number');
    expect(typeof report.newStepCount).toBe('number');
  });

  it('flags step count mismatch', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(report.stepCountMatch).toBe(true);
  });

  it('returns method mismatches array', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(Array.isArray(report.methodMismatches)).toBe(true);
  });

  it('returns url mismatches array', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(Array.isArray(report.urlMismatches)).toBe(true);
  });

  it('has overallParity boolean', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(typeof report.overallParity).toBe('boolean');
  });

  it('does not throw on empty item array', () => {
    const empty = JSON.stringify({ info: { name: 'Empty', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] });
    expect(() => validatePostmanParity(empty, 'env-1')).not.toThrow();
  });

  it('does not throw on malformed JSON — returns error report', () => {
    const report = validatePostmanParity('not-json', 'env-1');
    expect(report.overallParity).toBe(false);
    expect(report.error).toBeDefined();
  });
});
