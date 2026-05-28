// src/api-copilot/contracts/copilot-guidance.contracts.ts
// Phase E Step 10: AI copilot guidance contracts. Advisory + governed only. Never mutates runtime.

export type CopilotQueryType =
  | 'workflow-guidance'
  | 'orchestration-recommendation'
  | 'replay-debug'
  | 'flakiness-investigation'
  | 'dependency-optimization'
  | 'retry-tuning'
  | 'environment-anomaly';

export type CopilotGuidanceSeverity = 'info' | 'warning' | 'critical';

export interface CopilotQuery {
  readonly queryId: string;
  readonly queryType: CopilotQueryType;
  readonly collectionId: string;
  readonly runId?: string;
  readonly actorId: string;
  readonly tenantId?: string;
  readonly context: Record<string, unknown>;
  readonly askedAt: string;
}

export interface CopilotGuidanceItem {
  readonly guidanceId: string;
  readonly queryId: string;
  readonly title: string;
  readonly body: string;
  readonly severity: CopilotGuidanceSeverity;
  readonly confidence: number;     // 0–100
  readonly actionHint: string;
  /** Provenance: what evidence this guidance is based on. */
  readonly evidenceRefs: readonly string[];
  readonly provenance: { source: string; basis: string };
  readonly advisoryNote: string;
}

export interface CopilotGuidanceResult {
  readonly queryId: string;
  readonly collectionId: string;
  readonly queryType: CopilotQueryType;
  readonly items: readonly CopilotGuidanceItem[];
  readonly generatedAt: string;
  readonly governanceNote: string;
}

export interface ICopilotGuidanceEngine {
  /** Produce advisory guidance for a given query. Never mutates any runtime state. */
  guide(query: CopilotQuery): CopilotGuidanceResult;
  /** List guidance history for a collection (audit trail). */
  listHistory(collectionId: string): CopilotGuidanceResult[];
}
