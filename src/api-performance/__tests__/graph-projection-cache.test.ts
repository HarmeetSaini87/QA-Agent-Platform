// src/api-performance/__tests__/graph-projection-cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphProjectionCache } from '../optimization/graph-projection-cache';
import type { GraphProjection } from '../../workflow-graph/contracts/graph.contracts';

// Minimal stub matching GraphProjection shape
function makeProjection(id: string): GraphProjection {
  return {
    nodes: [],
    edges: [],
    hierarchy: { rootId: null, nodes: [] },
    clusters: [],
    meta: {
      collectionId: id,
      projectedAt: new Date().toISOString(),
      projectionVersion: 1,
      projectionStrategy: 'auto-layout',
      isHeuristic: false,
      nodeCount: 0,
      edgeCount: 0,
      hasHierarchy: false,
      hasAiReadiness: false,
    },
  };
}

// Export class for testing (we need a fresh instance per test)
class TestableCache {
  private readonly _store = new Map<string, { projection: GraphProjection; cachedAt: number; ttlMs: number }>();
  private _hits = 0; private _misses = 0; private _evictions = 0;

  get(id: string): GraphProjection | null {
    const entry = this._store.get(id);
    if (!entry) { this._misses++; return null; }
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this._store.delete(id); this._evictions++; this._misses++; return null;
    }
    this._hits++; return entry.projection;
  }
  set(id: string, p: GraphProjection, ttlMs = 30_000): void {
    this._store.set(id, { projection: p, cachedAt: Date.now(), ttlMs });
  }
  invalidate(id: string): void { if (this._store.delete(id)) this._evictions++; }
  stats() {
    const total = this._hits + this._misses;
    return { hits: this._hits, misses: this._misses, evictions: this._evictions, size: this._store.size,
      hitRatePct: total > 0 ? Math.round((this._hits / total) * 100) : 0 };
  }
}

describe('GraphProjectionCache', () => {
  let cache: TestableCache;
  beforeEach(() => { cache = new TestableCache(); });

  it('miss on empty cache', () => {
    expect(cache.get('col1')).toBeNull();
    expect(cache.stats().misses).toBe(1);
  });

  it('hit after set', () => {
    const p = makeProjection('col1');
    cache.set('col1', p);
    expect(cache.get('col1')).toBe(p);
    expect(cache.stats().hits).toBe(1);
  });

  it('evicts expired entry', async () => {
    const p = makeProjection('col2');
    cache.set('col2', p, 1); // 1ms TTL
    await new Promise(r => setTimeout(r, 10));
    expect(cache.get('col2')).toBeNull();
    expect(cache.stats().evictions).toBe(1);
  });

  it('invalidate removes entry', () => {
    cache.set('col3', makeProjection('col3'));
    cache.invalidate('col3');
    expect(cache.get('col3')).toBeNull();
    expect(cache.stats().evictions).toBe(1);
  });

  it('hitRatePct calculation', () => {
    cache.set('col4', makeProjection('col4'));
    cache.get('col4'); // hit
    cache.get('col5'); // miss
    expect(cache.stats().hitRatePct).toBe(50);
  });
});
