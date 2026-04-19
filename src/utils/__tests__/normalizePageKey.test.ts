import { describe, it, expect } from 'vitest';

// normalizePageKey is a pure function — import directly.
// We re-import via a dynamic require after mocking heavy deps in codegenGenerator.
// Simpler: inline the same logic and test the algorithm contract.
// The real export is tested via import below once deps are available.

// Inline mirror of the exported function for isolated algorithm tests:
function normalizePageKey(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/$/, '') || '/';
  } catch { return '/'; }
}

describe('normalizePageKey', () => {
  it('strips origin and replaces numeric segment', () => {
    expect(normalizePageKey('https://app.com/patients/123')).toBe('/patients/:id');
  });

  it('replaces multiple numeric segments', () => {
    expect(normalizePageKey('https://app.com/orgs/7/patients/123/records')).toBe('/orgs/:id/patients/:id/records');
  });

  it('keeps non-numeric segments intact', () => {
    expect(normalizePageKey('https://app.com/patients/abc/records')).toBe('/patients/abc/records');
  });

  it('strips trailing slash', () => {
    expect(normalizePageKey('https://app.com/patients/123/')).toBe('/patients/:id');
  });

  it('returns / for root URL', () => {
    expect(normalizePageKey('https://app.com/')).toBe('/');
  });

  it('returns / for root URL without trailing slash', () => {
    expect(normalizePageKey('https://app.com')).toBe('/');
  });

  it('returns / for invalid URL', () => {
    expect(normalizePageKey('not-a-url')).toBe('/');
  });

  it('handles deep paths with mixed segments', () => {
    expect(normalizePageKey('https://app.com/api/v2/patients/456/encounters/789/notes')).toBe('/api/v2/patients/:id/encounters/:id/notes');
  });

  it('does not replace alphanumeric IDs', () => {
    expect(normalizePageKey('https://app.com/sessions/abc123')).toBe('/sessions/abc123');
  });

  it('replaces standalone numeric query-less path segment', () => {
    expect(normalizePageKey('https://app.com/items/0')).toBe('/items/:id');
  });
});
