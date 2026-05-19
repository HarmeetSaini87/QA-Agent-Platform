// src/api-defects/contracts/api-defect.contracts.ts

import type { ApiStepResult, ApiCollection, ApiEnvironment, ApiCollectionRunResult } from '../../data/types';
import type { CollectionFlakinessReport } from '../../api-flakiness/contracts/flakiness.contracts';
import type { RunGraphNodeResult } from '../../data/types';

export interface ApiDefectEnrichmentContext {
  step: ApiStepResult;
  run: ApiCollectionRunResult;
  collection: ApiCollection;
  environment: ApiEnvironment;
  /** Optional — from Step 8 flakiness report */
  flakinessReport?: CollectionFlakinessReport;
  /** Optional — from Phase D Step 7 graph overlay */
  graphNodeResult?: RunGraphNodeResult;
}

export interface ApiHealingSuggestion {
  readonly type: 'version_drift' | 'missing_prefix' | 'base_url_drift' | 'path_mismatch' | 'auth_refresh';
  readonly currentUrl: string;
  readonly suggestedUrl: string;
  readonly confidence: number;  // 0.0–1.0
  readonly reason: string;
}

export interface ApiDefectPayload {
  // Identity
  readonly stepId: string;
  readonly stepName: string;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly runId: string;
  // Request context
  readonly method: string;
  readonly url: string;
  readonly httpStatus?: number;
  readonly durationMs: number;
  // Failure detail
  readonly failedAssertions: ReadonlyArray<{ field: string; operator: string; expected: unknown; actual: unknown }>;
  readonly errorMessage?: string;
  readonly requestBody?: string;  // truncated to 500 chars, auth headers redacted
  readonly responseBody?: string;  // truncated to 500 chars
  // Enrichment
  readonly flakinessScore?: number;
  readonly failRate?: number;
  readonly isFlaky?: boolean;
  readonly retryCount: number;
  readonly retryHistory: ReadonlyArray<{ attempt: number; httpStatus?: number; error?: string; durationMs: number }>;
  readonly dependencyChain: readonly string[];  // stepIds this step depends on (from collection.steps[].dependsOn)
  readonly signatureKey?: string;  // from Step 8 dominantSignature.signatureKey
  // Environment
  readonly environmentName: string;
  readonly environmentBaseUrl: string;
  readonly collectionVersion?: string;
  // Healing
  readonly healingSuggestions: readonly ApiHealingSuggestion[];
}

export interface ApiDefectRecord {
  readonly defectKey: string;
  readonly jiraId: string;
  readonly stepId: string;
  readonly stepName: string;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly runId: string;
  readonly environmentId: string;
  readonly environmentName: string;
  readonly projectId?: string;
  readonly signatureKey?: string;
  readonly status: 'open' | 'closed';
  readonly createdAt: string;
  readonly createdBy: string;
  readonly jiraUrl: string;
}

export interface ApiDefectsRegistry {
  readonly _schemaVersion: 1;
  defects: ApiDefectRecord[];
}
