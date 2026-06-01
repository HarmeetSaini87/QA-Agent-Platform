// src/api-analytics/contracts/graph-analytics-overlay.contracts.ts
// Phase E Step 7: Graph analytics overlay contracts — retry heatmaps, SLA breach indicators.
// Graph remains read-only. These overlays are additive badge annotations only.

export type AnalyticsBadgeType =
  | 'retry-hotspot'
  | 'sla-breach'
  | 'execution-bottleneck'
  | 'dependency-unstable'
  | 'teardown-unstable'
  | 'flakiness-high';

export interface AnalyticsNodeBadge {
  readonly nodeId: string;
  readonly badgeType: AnalyticsBadgeType;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly score: number;   // 0–100
  readonly label: string;
  readonly advisoryNote: string;
}

export interface GraphAnalyticsOverlay {
  readonly collectionId: string;
  readonly generatedAt: string;
  readonly nodeBadges: readonly AnalyticsNodeBadge[];
  readonly hotspotCount: number;
  readonly slaBreachCount: number;
  /** True when overlay data is fresh (< 5 min old). */
  readonly isFresh: boolean;
}

export interface IGraphAnalyticsOverlayBuilder {
  /** Build an analytics overlay from RCA analytics + SLA breach data. Advisory read-only. */
  build(collectionId: string, input: {
    retryHotspots: Array<{ stepId: string; retryRate: number; isRetryStorm: boolean }>;
    slaBreaches: Array<{ collectionId: string; breachType: string; observed: number; threshold: number }>;
    failureTrends: Array<{ stepId: string; dependencyInstabilityScore: number; recurrencePattern: string }>;
  }): GraphAnalyticsOverlay;
}
