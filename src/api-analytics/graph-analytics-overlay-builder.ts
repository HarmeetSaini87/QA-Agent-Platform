// src/api-analytics/graph-analytics-overlay-builder.ts
// Phase E Step 7: Builds analytics badge overlays for graph. Graph remains read-only.

import type {
  IGraphAnalyticsOverlayBuilder,
  GraphAnalyticsOverlay,
  AnalyticsNodeBadge,
} from './contracts/graph-analytics-overlay.contracts';

const FRESH_THRESHOLD_MS = 5 * 60 * 1000;

export class GraphAnalyticsOverlayBuilder implements IGraphAnalyticsOverlayBuilder {
  build(
    collectionId: string,
    input: {
      retryHotspots: Array<{ stepId: string; retryRate: number; isRetryStorm: boolean }>;
      slaBreaches: Array<{ collectionId: string; breachType: string; observed: number; threshold: number }>;
      failureTrends: Array<{ stepId: string; dependencyInstabilityScore: number; recurrencePattern: string }>;
    },
  ): GraphAnalyticsOverlay {
    const generatedAt = new Date().toISOString();
    const badges: AnalyticsNodeBadge[] = [];

    for (const hotspot of input.retryHotspots) {
      badges.push({
        nodeId: hotspot.stepId,
        badgeType: hotspot.isRetryStorm ? 'retry-hotspot' : 'flakiness-high',
        severity: hotspot.isRetryStorm ? 'critical' : 'warning',
        score: Math.min(100, Math.round(hotspot.retryRate * 100)),
        label: hotspot.isRetryStorm ? 'Retry Storm' : 'High Retry Rate',
        advisoryNote: `Retry rate: ${(hotspot.retryRate * 100).toFixed(1)}%. Advisory only.`,
      });
    }

    for (const trend of input.failureTrends) {
      if (trend.dependencyInstabilityScore >= 40) {
        badges.push({
          nodeId: trend.stepId,
          badgeType: trend.recurrencePattern === 'escalating' ? 'execution-bottleneck' : 'dependency-unstable',
          severity: trend.dependencyInstabilityScore >= 70 ? 'critical' : 'warning',
          score: trend.dependencyInstabilityScore,
          label: trend.recurrencePattern === 'escalating' ? 'Escalating Failures' : 'Unstable Dependency',
          advisoryNote: `Instability score: ${trend.dependencyInstabilityScore}. Advisory only.`,
        });
      }
    }

    // SLA breach badges — applied to collection-level (use collectionId as nodeId proxy)
    const slaBreachCount = input.slaBreaches.length;
    if (slaBreachCount > 0) {
      badges.push({
        nodeId: collectionId,
        badgeType: 'sla-breach',
        severity: slaBreachCount >= 3 ? 'critical' : 'warning',
        score: Math.min(100, slaBreachCount * 25),
        label: `SLA Breach (${slaBreachCount})`,
        advisoryNote: `${slaBreachCount} SLA threshold(s) breached. Advisory only.`,
      });
    }

    // Deduplicate nodeId+badgeType (keep highest score)
    const deduped = new Map<string, AnalyticsNodeBadge>();
    for (const badge of badges) {
      const key = `${badge.nodeId}:${badge.badgeType}`;
      const existing = deduped.get(key);
      if (!existing || badge.score > existing.score) deduped.set(key, badge);
    }

    const finalBadges = Array.from(deduped.values());

    return {
      collectionId,
      generatedAt,
      nodeBadges: finalBadges,
      hotspotCount: finalBadges.filter(b => b.badgeType === 'retry-hotspot').length,
      slaBreachCount,
      isFresh: Date.now() - new Date(generatedAt).getTime() < FRESH_THRESHOLD_MS,
    };
  }
}

export const globalGraphAnalyticsOverlayBuilder = new GraphAnalyticsOverlayBuilder();
