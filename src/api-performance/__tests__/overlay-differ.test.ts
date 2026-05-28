// src/api-performance/__tests__/overlay-differ.test.ts
import { describe, it, expect } from 'vitest';
import { diffOverlays } from '../optimization/overlay-differ';
import type { AiGraphOverlayBundle, AiGraphAnnotation } from '../../api-intelligence/contracts/graph-overlay-ai.contracts';

function makeOverlay(collectionId: string, annotations: AiGraphAnnotation[]): AiGraphOverlayBundle {
  return { collectionId, generatedAt: new Date().toISOString(), annotations, advisoryNote: 'advisory' };
}

function makeAnnotation(nodeId: string, badgeTypes: string[]): AiGraphAnnotation {
  return {
    nodeId,
    stepId: nodeId,
    badges: badgeTypes.map(type => ({ type: type as never, label: type, confidence: 80, detail: type })),
  };
}

describe('diffOverlays', () => {
  it('noop when overlays are identical', () => {
    const a = makeAnnotation('n1', ['retry-hotspot']);
    const overlay = makeOverlay('col1', [a]);
    const diff = diffOverlays(overlay, overlay);
    expect(diff.isNoop).toBe(true);
    expect(diff.totalChangedNodes).toBe(0);
  });

  it('detects added nodes', () => {
    const prev = makeOverlay('col1', [makeAnnotation('n1', ['retry-hotspot'])]);
    const next = makeOverlay('col1', [makeAnnotation('n1', ['retry-hotspot']), makeAnnotation('n2', ['unstable-dependency'])]);
    const diff = diffOverlays(prev, next);
    expect(diff.nodesAdded).toContain('n2');
    expect(diff.isNoop).toBe(false);
  });

  it('detects removed nodes', () => {
    const prev = makeOverlay('col1', [makeAnnotation('n1', ['retry-hotspot']), makeAnnotation('n2', ['unstable-dependency'])]);
    const next = makeOverlay('col1', [makeAnnotation('n1', ['retry-hotspot'])]);
    const diff = diffOverlays(prev, next);
    expect(diff.nodesRemoved).toContain('n2');
  });

  it('detects badge changes within a node', () => {
    const prev = makeOverlay('col1', [makeAnnotation('n1', ['retry-hotspot'])]);
    const next = makeOverlay('col1', [makeAnnotation('n1', ['retry-hotspot', 'optimization-hint'])]);
    const diff = diffOverlays(prev, next);
    expect(diff.nodesChanged).toHaveLength(1);
    expect(diff.nodesChanged[0].addedBadges[0].type).toBe('optimization-hint');
  });

  it('null prev overlay: all nodes are added', () => {
    const next = makeOverlay('col1', [makeAnnotation('n1', ['retry-hotspot']), makeAnnotation('n2', ['unstable-dependency'])]);
    const diff = diffOverlays(null, next);
    expect(diff.nodesAdded).toHaveLength(2);
    expect(diff.nodesRemoved).toHaveLength(0);
  });
});
