import { describe, it, expect } from 'vitest';
import {
  extractVarRefs,
  buildAdjacency,
  topoSort,
  DagBuilder,
  getDagBuilder,
} from '../dag-builder';
import { CircularDependencyError } from '../../../shared-core/contracts/dependency-graph.contract';
import type { ApiTestStep } from '../../../data/types';

function makeStep(id: string, overrides: Partial<ApiTestStep> = {}): ApiTestStep {
  return {
    id,
    name: `Step ${id}`,
    request: { method: 'GET', url: `https://api.test/${id}`, bodyType: 'none' },
    assertions: [],
    extractVariables: [],
    dependsOn: [],
    ...overrides,
  } as unknown as ApiTestStep;
}

// ── Group 1: extractVarRefs ───────────────────────────────────────────────────

describe('extractVarRefs', () => {
  it('extracts {{var}} references from URL', () => {
    const step = makeStep('a', { request: { method: 'GET', url: 'https://api.test/{{userId}}', bodyType: 'none' } });
    expect(extractVarRefs(step)).toContain('userId');
  });

  it('extracts ${var} references from URL', () => {
    const step = makeStep('a', { request: { method: 'GET', url: 'https://api.test/${token}', bodyType: 'none' } });
    expect(extractVarRefs(step)).toContain('token');
  });

  it('extracts from header values (array form)', () => {
    const step = makeStep('a', {
      request: {
        method: 'GET', url: 'https://api.test', bodyType: 'none',
        headers: [{ key: 'Authorization', value: 'Bearer {{authToken}}' }],
      },
    });
    expect(extractVarRefs(step)).toContain('authToken');
  });

  it('extracts from header values (object form)', () => {
    const step = makeStep('a', {
      request: {
        method: 'GET', url: 'https://api.test', bodyType: 'none',
        headers: { Authorization: 'Bearer ${jwt}' },
      },
    });
    expect(extractVarRefs(step)).toContain('jwt');
  });

  it('extracts from body string', () => {
    const step = makeStep('a', {
      request: { method: 'POST', url: 'https://api.test', bodyType: 'json', body: '{"id": "{{userId}}"}' },
    });
    expect(extractVarRefs(step)).toContain('userId');
  });

  it('returns empty array when no refs', () => {
    const step = makeStep('a');
    expect(extractVarRefs(step)).toHaveLength(0);
  });
});

// ── Group 2: buildAdjacency ───────────────────────────────────────────────────

describe('buildAdjacency', () => {
  it('returns empty map for empty steps', () => {
    const adj = buildAdjacency([]);
    expect(adj.size).toBe(0);
  });

  it('respects explicit dependsOn', () => {
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const adj = buildAdjacency([a, b]);
    expect(adj.get('b')?.has('a')).toBe(true);
  });

  it('derives implicit dep from extraction → var ref', () => {
    const a = makeStep('a', { extractVariables: [{ name: 'token', source: 'body', path: '$.token' }] });
    const b = makeStep('b', { request: { method: 'GET', url: 'https://api.test/{{token}}', bodyType: 'none' } });
    const adj = buildAdjacency([a, b]);
    expect(adj.get('b')?.has('a')).toBe(true);
  });

  it('does not add self-dependency', () => {
    const a = makeStep('a', {
      extractVariables: [{ name: 'x', source: 'body', path: '$.x' }],
      request: { method: 'GET', url: 'https://api.test/{{x}}', bodyType: 'none' },
    });
    const adj = buildAdjacency([a]);
    expect(adj.get('a')?.has('a')).toBe(false);
  });

  it('respects group ordering', () => {
    const a = makeStep('a', { group: 'g1', order: 1 } as Partial<ApiTestStep>);
    const b = makeStep('b', { group: 'g1', order: 2 } as Partial<ApiTestStep>);
    const adj = buildAdjacency([a, b]);
    expect(adj.get('b')?.has('a')).toBe(true);
  });
});

// ── Group 3: topoSort ─────────────────────────────────────────────────────────

describe('topoSort', () => {
  it('returns single wave for independent steps', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c')];
    const adj = buildAdjacency(steps);
    const waves = topoSort(steps, adj);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(3);
  });

  it('orders dependent steps into separate waves', () => {
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const adj = buildAdjacency([a, b]);
    const waves = topoSort([a, b], adj);
    expect(waves).toHaveLength(2);
    expect(waves[0].map(s => s.id)).toContain('a');
    expect(waves[1].map(s => s.id)).toContain('b');
  });

  it('handles chain of 3 sequential deps', () => {
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const c = makeStep('c', { dependsOn: ['b'] });
    const adj = buildAdjacency([a, b, c]);
    const waves = topoSort([a, b, c], adj);
    expect(waves).toHaveLength(3);
  });

  it('throws CircularDependencyError on cycle', () => {
    const a = makeStep('a', { dependsOn: ['b'] });
    const b = makeStep('b', { dependsOn: ['a'] });
    const adj = buildAdjacency([a, b]);
    expect(() => topoSort([a, b], adj)).toThrow(CircularDependencyError);
  });

  it('returns empty array for empty steps', () => {
    const waves = topoSort([], new Map());
    expect(waves).toHaveLength(0);
  });
});

// ── Group 4: DagBuilder.build ─────────────────────────────────────────────────

describe('DagBuilder.build', () => {
  it('returns empty DagGraph for empty steps', () => {
    const graph = new DagBuilder().build([]);
    expect(graph.nodes.size).toBe(0);
    expect(graph.hasCycle).toBe(false);
  });

  it('builds nodes with correct layer', () => {
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const graph = new DagBuilder().build([a, b]);
    expect(graph.nodes.get('a')?.layer).toBe(0);
    expect(graph.nodes.get('b')?.layer).toBe(1);
  });

  it('builds edges array', () => {
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const graph = new DagBuilder().build([a, b]);
    expect(graph.edges).toContainEqual({ fromId: 'a', toId: 'b' });
  });

  it('sets hasCycle true on cycle and does not throw', () => {
    const a = makeStep('a', { dependsOn: ['b'] });
    const b = makeStep('b', { dependsOn: ['a'] });
    const graph = new DagBuilder().build([a, b]);
    expect(graph.hasCycle).toBe(true);
  });

  it('rejects unsupported nodeType', () => {
    const a = makeStep('a');
    (a as unknown as { nodeType: string }).nodeType = 'CONDITION';
    expect(() => new DagBuilder().build([a])).toThrow(/unsupported nodeType/);
  });

  it('getDagBuilder returns singleton', () => {
    expect(getDagBuilder()).toBe(getDagBuilder());
  });
});
