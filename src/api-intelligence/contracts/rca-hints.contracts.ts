import type { RecommendationBasis } from './recommendation.contracts';

export type RcaHintSource = 'replay' | 'flakiness' | 'graph' | 'retry-history';

export interface RcaHintEvidence {
  type: RcaHintSource;
  /** runId / stepId / seq:N / eventId */
  ref: string;
  detail: string;
}

export interface RcaHint {
  id: string;
  runId: string;
  stepId?: string;
  stepName?: string;
  title: string;
  probableCause: string;
  /** 0–100 */
  confidence: number;
  basis: RecommendationBasis;
  evidences: RcaHintEvidence[];
  generatedAt: string;
}

export interface RcaHintBundle {
  runId: string;
  generatedAt: string;
  hints: RcaHint[];
  advisoryNote: string;
}
