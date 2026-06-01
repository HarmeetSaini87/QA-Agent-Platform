// src/api-intelligence/recommendation-service.ts
// Advisory-only orchestration layer. MUST NOT mutate collections, runtime, or WorkflowEnvelope.

import { Request } from 'express';
import { ApiCollection, ApiCollectionRunResult } from '../data/types';
import { CollectionFlakinessReport } from '../api-flakiness/contracts/flakiness.contracts';
import { logApiAudit } from '../api-governance/audit.helper';
import { getTenantContext } from '../api-governance/tenant.helper';
import { AiRecommendation, RecommendationBundle } from './contracts/recommendation.contracts';
import { AiGraphOverlayBundle } from './contracts/graph-overlay-ai.contracts';
import { analyzeDependencies } from './engines/dependency-analyzer';
import { analyzeRetryIntelligence } from './engines/retry-intelligence';
import { analyzeFlakinessInsights } from './engines/flakiness-insights';
import { analyzeWorkflowQuality } from './engines/workflow-quality-analyzer';

const ADVISORY = 'All recommendations are advisory only. AI must not alter runtime execution, retries, WorkflowEnvelope, or collections automatically.';
const SEV_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export interface RecommendationInput {
  collection: ApiCollection;
  recentRuns: ApiCollectionRunResult[];
  flakinessReport: CollectionFlakinessReport | null;
}

export function buildRecommendationBundle(input: RecommendationInput, req?: Request): RecommendationBundle {
  const tenantId = req ? getTenantContext(req)?.tenantId : undefined;
  const all: AiRecommendation[] = [];

  all.push(...analyzeDependencies(input.collection.steps, input.collection.id).recommendations);
  all.push(...analyzeRetryIntelligence(input.collection.steps, input.recentRuns, input.collection.id).recommendations);
  if (input.flakinessReport) {
    all.push(...analyzeFlakinessInsights(input.flakinessReport).recommendations);
  }
  all.push(...analyzeWorkflowQuality(input.collection, input.recentRuns).recommendations);

  const tenanted = all.map(r => ({ ...r, tenantId: tenantId ?? r.tenantId }));
  tenanted.sort((a, b) => {
    const diff = (SEV_ORDER[a.severity] ?? 2) - (SEV_ORDER[b.severity] ?? 2);
    return diff !== 0 ? diff : b.confidence - a.confidence;
  });

  if (req) {
    logApiAudit('api:intelligence:recommendations:generated', input.collection.id, req, {
      details: `${tenanted.length} recommendations`,
      tenantId,
    });
  }

  return { collectionId: input.collection.id, generatedAt: new Date().toISOString(), recommendations: tenanted, advisoryNote: ADVISORY };
}

export function buildGraphOverlayBundle(input: RecommendationInput, req?: Request): AiGraphOverlayBundle {
  const tenantId = req ? getTenantContext(req)?.tenantId : undefined;
  const annotations = [
    ...analyzeDependencies(input.collection.steps, input.collection.id).annotations,
    ...analyzeRetryIntelligence(input.collection.steps, input.recentRuns, input.collection.id).annotations,
    ...(input.flakinessReport ? analyzeFlakinessInsights(input.flakinessReport).annotations : []),
  ];
  if (req) {
    logApiAudit('api:intelligence:recommendations:generated', input.collection.id, req, {
      details: `${annotations.length} annotations (graph overlay)`,
      tenantId,
    });
  }
  return { collectionId: input.collection.id, generatedAt: new Date().toISOString(), annotations, advisoryNote: ADVISORY };
}
