// src/api-analytics/index.ts
// Phase E Step 7: Enterprise Analytics Platform, SLA Intelligence & Advanced Operational Insights.

export * from './contracts/execution-trends.contracts';
export * from './contracts/sla-intelligence.contracts';
export * from './contracts/tenant-analytics.contracts';
export * from './contracts/rca-analytics.contracts';
export * from './contracts/graph-analytics-overlay.contracts';
export * from './contracts/predictive-intelligence.contracts';

export { ExecutionTrendAggregator, globalExecutionTrendAggregator } from './execution-trend-aggregator';
export { SlaIntelligenceEngine, globalSlaIntelligenceEngine } from './sla-intelligence-engine';
export { RcaAnalyticsEngine, globalRcaAnalyticsEngine } from './rca-analytics-engine';
export { GraphAnalyticsOverlayBuilder, globalGraphAnalyticsOverlayBuilder } from './graph-analytics-overlay-builder';
export { TenantAnalyticsAggregator, globalTenantAnalyticsAggregator } from './tenant-analytics-aggregator';
export { registerAnalyticsRoutes } from './routes/analytics.routes';
