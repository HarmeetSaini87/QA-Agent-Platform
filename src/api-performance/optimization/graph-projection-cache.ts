// src/api-performance/optimization/graph-projection-cache.ts
// Phase E Step 1: TTL-based in-memory cache for GraphProjection results.
// Wraps projection-service — projection semantics and WorkflowEnvelope authority unchanged.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GraphProjection = any;

interface CacheEntry {
  readonly projection: GraphProjection;
  readonly cachedAt: number;
  readonly ttlMs: number;
}

export interface ProjectionCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly size: number;
  readonly hitRatePct: number;
}

const DEFAULT_TTL_MS = 30_000; // 30 seconds

class GraphProjectionCache {
  private readonly _store = new Map<string, CacheEntry>();
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  get(collectionId: string): GraphProjection | null {
    const entry = this._store.get(collectionId);
    if (!entry) { this._misses++; return null; }

    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this._store.delete(collectionId);
      this._evictions++;
      this._misses++;
      return null;
    }

    this._hits++;
    return entry.projection;
  }

  set(collectionId: string, projection: GraphProjection, ttlMs = DEFAULT_TTL_MS): void {
    this._store.set(collectionId, {
      projection,
      cachedAt: Date.now(),
      ttlMs,
    });
  }

  invalidate(collectionId: string): void {
    if (this._store.delete(collectionId)) this._evictions++;
  }

  clear(): void {
    this._evictions += this._store.size;
    this._store.clear();
  }

  stats(): ProjectionCacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this._store.size,
      hitRatePct: total > 0 ? Math.round((this._hits / total) * 100) : 0,
    };
  }
}

export const globalProjectionCache = new GraphProjectionCache();
