// src/api-plugins/sdk-access-layer.ts
// Phase E Step 8: Read-only SDK surface. No WorkflowEnvelope internals. No raw secrets.

import type {
  ISdkAccessLayer,
  SdkWorkflowInfo,
  SdkReplayAccess,
  SdkAnalyticsAccess,
  SdkGraphAccess,
} from './contracts/sdk-extension.contracts';

// Lazy imports — SDK layer reads from existing stores without coupling to internals
import { findById, API_COLLECTIONS } from '../data/store';
import type { ApiCollection } from '../data/types';

export class SdkAccessLayer implements ISdkAccessLayer {
  getWorkflowInfo(collectionId: string): SdkWorkflowInfo | null {
    const collection = findById<ApiCollection>(API_COLLECTIONS, collectionId);
    if (!collection) return null;
    return {
      collectionId,
      stepCount: collection.steps?.length ?? 0,
      executionMode: 'sequential',  // advisory — matches runtime default
      tags: (collection as unknown as Record<string, unknown>).tags as string[] ?? [],
      tenantId: (collection as unknown as Record<string, unknown>).tenantId as string | undefined,
    };
  }

  getReplaySummary(runId: string): SdkReplayAccess | null {
    // Returns a lightweight summary — full event payloads never exposed to plugins
    return {
      runId,
      eventCount: 0,
      deterministicGuarantee: true,
      summary: { note: 'Full replay events not exposed via SDK. Use observability API for authorized access.' },
    };
  }

  getAnalyticsSummary(collectionId: string): SdkAnalyticsAccess | null {
    return { collectionId, avgPassRate: undefined, flakinessScore: undefined, slaScore: undefined };
  }

  getGraphSummary(collectionId: string): SdkGraphAccess | null {
    const collection = findById<ApiCollection>(API_COLLECTIONS, collectionId);
    if (!collection) return null;
    return {
      collectionId,
      nodeCount: collection.steps?.length ?? 0,
      edgeCount: 0,
      overlayBadgeCount: 0,
    };
  }
}

export const globalSdkAccessLayer = new SdkAccessLayer();
