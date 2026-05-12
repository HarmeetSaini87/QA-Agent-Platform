import { describe, it, expect } from 'vitest';
import { deepJsonDiff, diffBaseline } from '../baseline';
import type { ApiResponseSnapshot } from '../../../data/types';

function makeSnap(overrides: Partial<ApiResponseSnapshot> = {}): ApiResponseSnapshot {
  return {
    status: 200, headers: {}, body: {}, bodyTruncated: false, durationMs: 50,
    ...overrides,
  };
}

// ── Group 1: deepJsonDiff ─────────────────────────────────────────────────────

describe('deepJsonDiff', () => {
  it('returns empty array for identical primitives', () => {
    expect(deepJsonDiff('hello', 'hello')).toHaveLength(0);
  });

  it('returns diff for changed primitive', () => {
    const diffs = deepJsonDiff(1, 2);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ expected: 1, actual: 2 });
  });

  it('returns empty array for identical objects', () => {
    expect(deepJsonDiff({ a: 1 }, { a: 1 })).toHaveLength(0);
  });

  it('detects added key', () => {
    const diffs = deepJsonDiff({ a: 1 }, { a: 1, b: 2 });
    expect(diffs.some(d => d.path.includes('b'))).toBe(true);
  });

  it('detects removed key', () => {
    const diffs = deepJsonDiff({ a: 1, b: 2 }, { a: 1 });
    expect(diffs.some(d => d.path.includes('b'))).toBe(true);
  });

  it('detects nested value change', () => {
    const diffs = deepJsonDiff({ a: { x: 1 } }, { a: { x: 99 } });
    expect(diffs[0].path).toBe('$.a.x');
  });

  it('handles null correctly', () => {
    const diffs = deepJsonDiff(null, 'something');
    expect(diffs).toHaveLength(1);
  });
});

// ── Group 2: diffBaseline ─────────────────────────────────────────────────────

describe('diffBaseline', () => {
  it('reports no diff for identical snapshots', () => {
    const s = makeSnap({ headers: { 'content-type': 'application/json' } });
    const d = diffBaseline(s, { ...s });
    expect(d.statusChanged).toBe(false);
    expect(d.headersAdded).toHaveLength(0);
    expect(d.headersRemoved).toHaveLength(0);
    expect(d.bodyDiff).toHaveLength(0);
  });

  it('reports statusChanged', () => {
    const d = diffBaseline(makeSnap({ status: 200 }), makeSnap({ status: 404 }));
    expect(d.statusChanged).toBe(true);
  });

  it('reports headersAdded', () => {
    const d = diffBaseline(
      makeSnap({ headers: {} }),
      makeSnap({ headers: { 'x-new': 'yes' } })
    );
    expect(d.headersAdded).toContain('x-new');
  });

  it('reports headersRemoved', () => {
    const d = diffBaseline(
      makeSnap({ headers: { 'x-old': 'yes' } }),
      makeSnap({ headers: {} })
    );
    expect(d.headersRemoved).toContain('x-old');
  });

  it('reports bodyDiff', () => {
    const d = diffBaseline(
      makeSnap({ body: { id: 1 } }),
      makeSnap({ body: { id: 2 } })
    );
    expect(d.bodyDiff.length).toBeGreaterThan(0);
  });

  it('is case-insensitive for header keys', () => {
    const d = diffBaseline(
      makeSnap({ headers: { 'Content-Type': 'application/json' } }),
      makeSnap({ headers: { 'content-type': 'application/json' } })
    );
    expect(d.headersAdded).toHaveLength(0);
    expect(d.headersRemoved).toHaveLength(0);
  });
});
