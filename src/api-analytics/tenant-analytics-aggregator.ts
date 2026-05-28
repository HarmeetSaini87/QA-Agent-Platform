// src/api-analytics/tenant-analytics-aggregator.ts
// Phase E Step 7: Tenant + team + environment analytics. Observational only.

import type {
  ITenantAnalyticsAggregator,
  TenantAnalyticsSummary,
  TeamReliabilityMetrics,
  EnvironmentHealthMetric,
} from './contracts/tenant-analytics.contracts';

export class TenantAnalyticsAggregator implements ITenantAnalyticsAggregator {
  private readonly _tenantSummaries = new Map<string, TenantAnalyticsSummary>();
  private readonly _teamMetrics = new Map<string, TeamReliabilityMetrics>();
  private readonly _envHealth = new Map<string, EnvironmentHealthMetric>();

  recordTenantSummary(summary: TenantAnalyticsSummary): void {
    this._tenantSummaries.set(summary.tenantId, summary);
  }

  getTenantSummary(tenantId: string): TenantAnalyticsSummary | null {
    return this._tenantSummaries.get(tenantId) ?? null;
  }

  recordTeamMetrics(metrics: TeamReliabilityMetrics): void {
    this._teamMetrics.set(metrics.teamId, metrics);
  }

  getTeamMetrics(teamId: string): TeamReliabilityMetrics | null {
    return this._teamMetrics.get(teamId) ?? null;
  }

  recordEnvironmentHealth(metric: EnvironmentHealthMetric): void {
    this._envHealth.set(metric.environmentId, metric);
  }

  getEnvironmentHealth(environmentId: string): EnvironmentHealthMetric | null {
    return this._envHealth.get(environmentId) ?? null;
  }

  listTenantIds(): string[] {
    return Array.from(this._tenantSummaries.keys());
  }
}

export const globalTenantAnalyticsAggregator = new TenantAnalyticsAggregator();
