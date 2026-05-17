// src/workflow-graph/__tests__/graph-projection-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildGraphProjection } from '../projection/graph-projection-builder';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';

function makeEnvelope(overrides: Partial<WorkflowEnvelope['workflow']> = {}, metaOverrides: Partial<WorkflowEnvelope['metadata']> = {}): WorkflowEnvelope {
  return {
    schemaVersion: '1.0',
    workflow: {
      id: 'col-1',
      name: 'Test Collection',
      legacyNodes: [],
      nodes: [],
      ...overrides,
    },
    execution: { mode: 'sequential' },
    metadata: {
      createdAt: '2026-05-16T00:00:00.000Z',
      source: 'manual',
      collectionId: 'col-1',
      ...metaOverrides,
    },
  };
}

function makeNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    nodeType: 'HTTP' as const,
    step: { id, name: `Step ${id}`, method: 'GET', url: 'https://example.com', headers: [], assertions: [], dependsOn: [] },
    dependsOn: [],
    hierarchyPath: [],
    ...overrides,
  };
}

const OPTS = { projectedAt: '2026-05-17T00:00:00.000Z' };

describe('buildGraphProjection', () => {
  it('returns empty nodes/edges for envelope with no nodes', () => {
    const result = buildGraphProjection(makeEnvelope(), OPTS);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('uses stored position when present', () => {
    const env = makeEnvelope({
      nodes: [makeNode('n1', { position: { x: 100, y: 200, locked: false } })],
    });
    const { nodes } = buildGraphProjection(env, OPTS);
    expect(nodes[0].position).toEqual({ x: 100, y: 200, locked: false });
    expect(nodes[0].isAutoPositioned).toBe(false);
  });

  it('auto-computes position when no stored position', () => {
    const env = makeEnvelope({ nodes: [makeNode('n1')] });
    const { nodes } = buildGraphProjection(env, OPTS);
    expect(nodes[0].isAutoPositioned).toBe(true);
    expect(nodes[0].position.x).toBe(0);
    expect(nodes[0].position.y).toBe(0);
  });

  it('preserves locked=true on stored position', () => {
    const env = makeEnvelope({
      nodes: [makeNode('n1', { position: { x: 10, y: 20, locked: true } })],
    });
    const { nodes } = buildGraphProjection(env, OPTS);
    expect(nodes[0].position.locked).toBe(true);
  });

  it('emits LEGACY_NODE_PROJECTION warning when shimming legacyNodes', () => {
    const env = makeEnvelope({ nodes: undefined, legacyNodes: [{ id: 'l1', name: 'Legacy', method: 'GET', url: 'https://x.com', headers: [], assertions: [], dependsOn: [] }] });
    const result = buildGraphProjection(env, OPTS);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.code === 'LEGACY_NODE_PROJECTION')).toBe(true);
  });

  it('emits LARGE_GRAPH_WARNING when nodeCount > 500', () => {
    const manyNodes = Array.from({ length: 501 }, (_, i) => makeNode(`n${i}`));
    const env = makeEnvelope({ nodes: manyNodes });
    const result = buildGraphProjection(env, OPTS);
    expect(result.warnings!.some(w => w.code === 'LARGE_GRAPH_WARNING')).toBe(true);
  });

  it('builds depends_on edges from dependsOn field', () => {
    const env = makeEnvelope({
      nodes: [
        makeNode('n1'),
        makeNode('n2', { dependsOn: ['n1'] }),
      ],
    });
    const { edges } = buildGraphProjection(env, OPTS);
    const dep = edges.find(e => e.edgeType === 'depends_on');
    expect(dep).toBeDefined();
    expect(dep!.id).toBe('n1:n2:depends_on');
  });

  it('drops dangling depends_on ref and emits INFERRED_EDGE_DROPPED warning', () => {
    const env = makeEnvelope({
      nodes: [makeNode('n1', { dependsOn: ['ghost'] })],
    });
    const result = buildGraphProjection(env, OPTS);
    expect(result.warnings!.some(w => w.code === 'INFERRED_EDGE_DROPPED')).toBe(true);
    expect(result.edges).toHaveLength(0);
  });

  it('deduplicates edges — same source:target:type not duplicated', () => {
    const env = makeEnvelope({
      nodes: [
        makeNode('n1'),
        makeNode('n2', { dependsOn: ['n1'] }),
      ],
    });
    const { edges } = buildGraphProjection(env, OPTS);
    const ids = edges.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('depends_on edges come before inferred edges in output', () => {
    const env = makeEnvelope({
      nodes: [
        makeNode('n1'),
        makeNode('n2', { dependsOn: ['n1'] }),
        makeNode('n3'),
      ],
    });
    const { edges } = buildGraphProjection(env, OPTS);
    const firstDepIdx = edges.findIndex(e => e.edgeType === 'depends_on');
    const firstInferIdx = edges.findIndex(e => e.edgeType === 'inferred');
    if (firstDepIdx !== -1 && firstInferIdx !== -1) {
      expect(firstDepIdx).toBeLessThan(firstInferIdx);
    }
  });

  it('projectionStrategy is stored when all nodes have positions', () => {
    const env = makeEnvelope({
      nodes: [
        makeNode('n1', { position: { x: 0, y: 0 } }),
        makeNode('n2', { position: { x: 100, y: 0 } }),
      ],
    });
    const { meta } = buildGraphProjection(env, OPTS);
    expect(meta.projectionStrategy).toBe('stored');
  });

  it('projectionStrategy is auto-layout when no nodes have positions', () => {
    const env = makeEnvelope({ nodes: [makeNode('n1'), makeNode('n2')] });
    const { meta } = buildGraphProjection(env, OPTS);
    expect(meta.projectionStrategy).toBe('auto-layout');
  });

  it('projectionStrategy is hybrid when some nodes have positions', () => {
    const env = makeEnvelope({
      nodes: [
        makeNode('n1', { position: { x: 0, y: 0 } }),
        makeNode('n2'),
      ],
    });
    const { meta } = buildGraphProjection(env, OPTS);
    expect(meta.projectionStrategy).toBe('hybrid');
  });

  it('is deterministic — same input produces identical output', () => {
    const env = makeEnvelope({ nodes: [makeNode('n1'), makeNode('n2', { dependsOn: ['n1'] })] });
    const r1 = buildGraphProjection(env, OPTS);
    const r2 = buildGraphProjection(env, OPTS);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('meta fields are correctly populated', () => {
    const env = makeEnvelope({ nodes: [makeNode('n1')] }, { normalizationSource: 'postman' });
    const { meta } = buildGraphProjection(env, OPTS);
    expect(meta.collectionId).toBe('col-1');
    expect(meta.projectedAt).toBe(OPTS.projectedAt);
    expect(meta.projectionVersion).toBe(1);
    expect(meta.normalizationSource).toBe('postman');
    expect(meta.nodeCount).toBe(1);
  });

  it('indexWithinLayer is set on every VisualNode', () => {
    const env = makeEnvelope({ nodes: [makeNode('n1'), makeNode('n2'), makeNode('n3')] });
    const { nodes } = buildGraphProjection(env, OPTS);
    nodes.forEach((n, i) => expect(n.indexWithinLayer).toBe(i));
  });

  it('no warnings field when no warnings emitted', () => {
    const env = makeEnvelope({ nodes: [makeNode('n1')] });
    const result = buildGraphProjection(env, OPTS);
    expect(result.warnings).toBeUndefined();
  });
});
