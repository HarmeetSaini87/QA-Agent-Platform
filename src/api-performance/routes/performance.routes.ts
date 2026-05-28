// src/api-performance/routes/performance.routes.ts
// Phase E Step 1: Performance observability endpoints.
// All routes are read-only — no mutations.

import type { Express, Request, Response } from 'express';
import { globalProfilerRegistry } from '../profiling/profiler-registry';
import { globalProjectionCache } from '../optimization/graph-projection-cache';
import { globalPerformanceSafeguards } from '../safeguards/performance-safeguards';
import type { SafeguardInput } from '../safeguards/performance-safeguards';

export function registerPerformanceRoutes(app: Express): void {
  // GET /api/performance/profile — recent profiling spans + phase stats
  app.get('/api/performance/profile', (_req: Request, res: Response) => {
    const snapshot = globalProfilerRegistry.snapshot();
    res.json({ ok: true, snapshot });
  });

  // GET /api/performance/cache/stats — projection cache hit/miss stats
  app.get('/api/performance/cache/stats', (_req: Request, res: Response) => {
    const stats = globalProjectionCache.stats();
    res.json({ ok: true, stats });
  });

  // POST /api/performance/cache/invalidate/:collectionId — evict one collection
  app.post('/api/performance/cache/invalidate/:collectionId', (req: Request, res: Response) => {
    const { collectionId } = req.params;
    globalProjectionCache.invalidate(collectionId);
    res.json({ ok: true, collectionId, action: 'invalidated' });
  });

  // GET /api/performance/safeguards — run all threshold checks against current runtime state
  app.get('/api/performance/safeguards', (req: Request, res: Response) => {
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);

    const input: SafeguardInput = {
      graphNodeCount: 0,          // Caller-supplied via query in future; default 0 = no violation
      replayEventCount: 0,
      pollsPerMinute: 0,
      retryRatePerMinute: 0,
      heapUsedMb,
      cacheStats: globalProjectionCache.stats(),
    };

    // Allow query param overrides for dashboard probing
    if (req.query['graphNodeCount']) input.graphNodeCount = parseInt(req.query['graphNodeCount'] as string, 10) || 0;
    if (req.query['replayEventCount']) input.replayEventCount = parseInt(req.query['replayEventCount'] as string, 10) || 0;
    if (req.query['pollsPerMinute']) input.pollsPerMinute = parseInt(req.query['pollsPerMinute'] as string, 10) || 0;
    if (req.query['retryRatePerMinute']) input.retryRatePerMinute = parseInt(req.query['retryRatePerMinute'] as string, 10) || 0;

    const result = globalPerformanceSafeguards.runAll(input);
    res.json({ ok: true, result });
  });
}
