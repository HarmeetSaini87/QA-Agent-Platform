// src/api-analytics/contracts/tenant-analytics.contracts.ts
// Phase E Step 7: Tenant-level and team-level analytics aggregation.

export interface TenantAnalyticsSummary {
  readonly tenantId: string;
  readonly sampledAt: string;
  readonly totalRuns: number;
  readonly totalCollections: number;
  readonly avgPassRate: number;
  readonly avgRetryRate: number;
  readonly workerUtilization: number;    // 0–1
  readonly queueLatencyMs: number;
  readonly orchestrationStabilityScore: number;  // 0–100
}

export interface TeamReliabilityMetrics {
  readonly teamId: string;
  readonly tenantId?: string;
  readonly sampledAt: string;
  readonly collectionsOwned: number;
  readonly avgPassRate: number;
  readonly flakyCollectionCount: number;
  readonly slaBreachCount: number;
  readonly mttrMs: number;   // mean time to recovery (advisory)
}

export interface EnvironmentHealthMetric {
  readonly environmentId: string;
  readonly sampledAt: string;
  readonly runCount: number;
  readonly avgPassRate: number;
  readonly envDriftScore: number;  // 0–100 (higher = more drift detected)
  readonly isProduction: boolean;
}

export interface ITenantAnalyticsAggregator {
  recordTenantSummary(summary: TenantAnalyticsSummary): void;
  getTenantSummary(tenantId: string): TenantAnalyticsSummary | null;
  recordTeamMetrics(metrics: TeamReliabilityMetrics): void;
  getTeamMetrics(teamId: string): TeamReliabilityMetrics | null;
  recordEnvironmentHealth(metric: EnvironmentHealthMetric): void;
  getEnvironmentHealth(environmentId: string): EnvironmentHealthMetric | null;
  listTenantIds(): string[];
}
