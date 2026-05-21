export type AiOverlayBadgeType =
  | 'unstable-dependency'
  | 'retry-hotspot'
  | 'optimization-hint'
  | 'healing-confidence'
  | 'replay-anomaly';

export interface AiOverlayBadge {
  type: AiOverlayBadgeType;
  label: string;
  /** 0–100 */
  confidence: number;
  detail: string;
}

export interface AiGraphAnnotation {
  /** Maps to workflow graph node id */
  nodeId: string;
  stepId: string;
  badges: AiOverlayBadge[];
}

export interface AiGraphOverlayBundle {
  collectionId: string;
  runId?: string;
  generatedAt: string;
  annotations: AiGraphAnnotation[];
  advisoryNote: string;
}
