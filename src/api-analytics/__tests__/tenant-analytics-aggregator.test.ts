// src/api-analytics/__tests__/tenant-analytics-aggregator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TenantAnalyticsAggregator } from '../tenant-analytics-aggregator';

describe('TenantAnalyticsAggregator', () => {
  let agg: TenantAnalyticsAggregator;
  beforeEach(() => { agg = new TenantAnalyticsAggregator(); });

  it('getTenantSummary: null for unknown tenant', () => {
    expect(agg.getTenantSummary('ghost')).toBeNull();
  });

  it('recordTenantSummary + getTenantSummary roundtrip', () => {
    agg.recordTenantSummary({
      tenantId: 'acme', sampledAt: new Date().toISOString(),
      totalRuns: 50, totalCollections: 5,
      avgPassRate: 0.9, avgRetryRate: 0.05,
      workerUtilization: 0.4, queueLatencyMs: 200, orchestrationStabilityScore: 85,
    });
    const s = agg.getTenantSummary('acme');
    expect(s?.totalRuns).toBe(50);
    expect(s?.orchestrationStabilityScore).toBe(85);
  });

  it('recordTeamMetrics + getTeamMetrics roundtrip', () => {
    agg.recordTeamMetrics({
      teamId: 'team-a', sampledAt: new Date().toISOString(),
      collectionsOwned: 3, avgPassRate: 0.88,
      flakyCollectionCount: 1, slaBreachCount: 0, mttrMs: 5000,
    });
    expect(agg.getTeamMetrics('team-a')?.avgPassRate).toBe(0.88);
  });

  it('getTeamMetrics: null for unknown team', () => {
    expect(agg.getTeamMetrics('unknown')).toBeNull();
  });

  it('recordEnvironmentHealth + getEnvironmentHealth roundtrip', () => {
    agg.recordEnvironmentHealth({
      environmentId: 'staging', sampledAt: new Date().toISOString(),
      runCount: 20, avgPassRate: 0.95, envDriftScore: 10, isProduction: false,
    });
    expect(agg.getEnvironmentHealth('staging')?.envDriftScore).toBe(10);
  });

  it('listTenantIds: includes recorded tenants', () => {
    agg.recordTenantSummary({ tenantId: 't1', sampledAt: new Date().toISOString(), totalRuns: 1, totalCollections: 1, avgPassRate: 1, avgRetryRate: 0, workerUtilization: 0, queueLatencyMs: 0, orchestrationStabilityScore: 100 });
    expect(agg.listTenantIds()).toContain('t1');
  });
});
