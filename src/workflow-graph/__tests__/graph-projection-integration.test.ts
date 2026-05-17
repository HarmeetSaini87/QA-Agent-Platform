// src/workflow-graph/__tests__/graph-projection-integration.test.ts
import { describe, it, expect } from 'vitest';
import { buildGraphProjection } from '../projection/graph-projection-builder';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';

const OPTS = { projectedAt: '2026-05-17T00:00:00.000Z' };

function makeEnvelope(nodeCount = 2): WorkflowEnvelope {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    nodeType: 'HTTP' as const,
    step: { id: `n${i}`, name: `Step ${i}`, method: 'GET', url: 'https://example.com', headers: [], assertions: [], dependsOn: i > 0 ? [`n${i - 1}`] : [] },
    dependsOn: i > 0 ? [`n${i - 1}`] : [],
    hierarchyPath: [],
  }));
  return {
    schemaVersion: '1.0',
    workflow: { id: 'col-integration', name: 'Integration Test', legacyNodes: [], nodes },
    execution: { mode: 'dag' },
    metadata: { createdAt: '2026-05-17T00:00:00.000Z', source: 'manual', collectionId: 'col-integration', normalizationSource: 'manual', metadataVersion: 1 },
  };
}

describe('GraphProjection integration', () => {
  it('output has correct top-level shape: nodes, edges, hierarchy, clusters, meta', () => {
    const result = buildGraphProjection(makeEnvelope(), OPTS);
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(result).toHaveProperty('hierarchy');
    expect(result).toHaveProperty('clusters');
    expect(result).toHaveProperty('meta');
  });

  it('meta.nodeCount and meta.edgeCount match array lengths', () => {
    const result = buildGraphProjection(makeEnvelope(3), OPTS);
    expect(result.meta.nodeCount).toBe(result.nodes.length);
    expect(result.meta.edgeCount).toBe(result.edges.length);
  });

  it('no runtime-only fields present on projection', () => {
    const result = buildGraphProjection(makeEnvelope(), OPTS) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty('schedulerState');
    expect(result).not.toHaveProperty('retryBudget');
    expect(result).not.toHaveProperty('dagBuilder');
  });

  it('hierarchy.rootId is null when no folderHierarchy provided', () => {
    const result = buildGraphProjection(makeEnvelope(), OPTS);
    expect(result.hierarchy.rootId).toBeNull();
  });
});
