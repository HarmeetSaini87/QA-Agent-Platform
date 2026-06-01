import { describe, it, expect } from 'vitest';
import type { AiRecommendation, RecommendationBundle, RecommendationBasis } from '../contracts/recommendation.contracts';
import type { RcaHint, RcaHintBundle } from '../contracts/rca-hints.contracts';
import type { AiGraphAnnotation, AiGraphOverlayBundle } from '../contracts/graph-overlay-ai.contracts';

describe('recommendation.contracts', () => {
  it('AiRecommendation has required fields', () => {
    const rec: AiRecommendation = {
      id: 'abc',
      category: 'retry',
      severity: 'warning',
      title: 'Test',
      detail: 'Detail',
      confidence: 80,
      actionHint: 'Fix it',
      provenance: { source: 'retry-intelligence', basis: 'deterministic', evidenceRefs: [], generatedAt: '2026-01-01T00:00:00Z' },
    };
    expect(rec.confidence).toBe(80);
    expect(rec.category).toBe('retry');
  });

  it('RecommendationBundle has advisoryNote', () => {
    const bundle: RecommendationBundle = {
      generatedAt: '2026-01-01T00:00:00Z',
      recommendations: [],
      advisoryNote: 'advisory only',
    };
    expect(bundle.advisoryNote).toBeTruthy();
  });

  it('RcaHint has basis and evidences', () => {
    const hint: RcaHint = {
      id: 'r1',
      runId: 'run1',
      title: 'Failure',
      probableCause: 'assertion failed',
      confidence: 75,
      basis: 'replay-evidence',
      evidences: [{ type: 'replay', ref: 'seq:3', detail: 'step failed' }],
      generatedAt: '2026-01-01T00:00:00Z',
    };
    expect(hint.basis).toBe('replay-evidence');
    expect(hint.evidences).toHaveLength(1);
  });

  it('AiGraphAnnotation has nodeId and badges', () => {
    const ann: AiGraphAnnotation = {
      nodeId: 'step-1',
      stepId: 'step-1',
      badges: [{ type: 'retry-hotspot', label: 'hotspot', confidence: 70, detail: 'retries' }],
    };
    expect(ann.badges[0].type).toBe('retry-hotspot');
  });

  it('AiGraphOverlayBundle has advisoryNote', () => {
    const overlay: AiGraphOverlayBundle = {
      collectionId: 'col-1',
      generatedAt: '2026-01-01T00:00:00Z',
      annotations: [],
      advisoryNote: 'advisory only',
    };
    expect(overlay.advisoryNote).toBeTruthy();
  });
});
