// src/api-copilot/copilot-guidance-engine.ts
// Phase E Step 10: AI copilot guidance engine. Advisory only — never mutates runtime.

import { randomUUID } from 'crypto';
import {
  CopilotQuery,
  CopilotGuidanceResult,
  CopilotGuidanceItem,
  ICopilotGuidanceEngine,
  CopilotGuidanceSeverity,
} from './contracts/copilot-guidance.contracts';

const GOVERNANCE_NOTE =
  'All guidance is advisory only. No runtime state, WorkflowEnvelope, DAG, or replay data is mutated.';

function _severityForQueryType(queryType: CopilotQuery['queryType']): CopilotGuidanceSeverity {
  switch (queryType) {
    case 'flakiness-investigation':
    case 'retry-tuning':
      return 'warning';
    case 'environment-anomaly':
    case 'replay-debug':
      return 'critical';
    default:
      return 'info';
  }
}

function _buildItem(query: CopilotQuery, index: number): CopilotGuidanceItem {
  const severity = _severityForQueryType(query.queryType);
  const confidence = 70 + (index % 3) * 10;   // deterministic spread: 70/80/90
  return {
    guidanceId: randomUUID(),
    queryId: query.queryId,
    title: `${query.queryType} guidance`,
    body: `Advisory: review ${query.queryType} signals for collection ${query.collectionId}. No automatic changes will be made.`,
    severity,
    confidence,
    actionHint: `Inspect collection ${query.collectionId} run history and retry patterns.`,
    evidenceRefs: query.runId ? [query.runId] : [],
    provenance: { source: 'copilot-guidance-engine', basis: query.queryType },
    advisoryNote: GOVERNANCE_NOTE,
  };
}

export class CopilotGuidanceEngine implements ICopilotGuidanceEngine {
  private readonly _history = new Map<string, CopilotGuidanceResult[]>();

  guide(query: CopilotQuery): CopilotGuidanceResult {
    const items: CopilotGuidanceItem[] = [_buildItem(query, 0), _buildItem(query, 1)];
    const result: CopilotGuidanceResult = {
      queryId: query.queryId,
      collectionId: query.collectionId,
      queryType: query.queryType,
      items,
      generatedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    const prev = this._history.get(query.collectionId) ?? [];
    this._history.set(query.collectionId, [...prev, result]);
    return result;
  }

  listHistory(collectionId: string): CopilotGuidanceResult[] {
    return this._history.get(collectionId) ?? [];
  }

  _reset(): void {
    this._history.clear();
  }
}

export const globalCopilotGuidanceEngine = new CopilotGuidanceEngine();
