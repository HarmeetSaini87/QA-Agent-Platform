/**
 * apiRunnerDag.test.ts
 * DAG safety tests — Phase B extraction guardrails.
 *
 * PURPOSE: Lock current buildDAG + topoSort behavior BEFORE Phase B extraction.
 * These tests must remain green throughout all Phase B extractions.
 * If any test here breaks during extraction, STOP and investigate before continuing.
 *
 * Coverage:
 *   A. Sequential dependencies (A → B → C)
 *   B. Parallel-safe nodes (A → B, A → C)
 *   C. Mixed dependency graphs (diamond, fan-out, fan-in)
 *   D. Missing / unknown dependency handling
 *   E. Circular dependency detection
 *   F. Variable-reference auto-dependency (implicit DAG edges from {{varRef}})
 *   G. Group ordering (same group + order field)
 *   H. Stable deterministic topo ordering
 *   I. Empty and single-step collections
 *   J. nodeType guard — future non-HTTP node safety
 */

import { describe, it, expect } from 'vitest';
import type { ApiTestStep } from '../../data/types';
import {
  buildDAG,
  topoSort,
  extractVarRefs,
  CircularDependencyError,
} from '../apiRunner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function step(
  id: string,
  overrides: Partial<ApiTestStep> = {}
): ApiTestStep {
  return {
    id,
    name: `Step ${id}`,
    request: { method: 'GET', url: `/api/${id}` },
    assertions: [],
    extractVariables: [],
    execution: {},
    dependsOn: [],
    ...overrides,
  };
}

/** Returns wave as sorted id arrays for deterministic comparison */
function waveIds(waves: ApiTestStep[][]): string[][] {
  return waves.map(w => w.map(s => s.id).sort());
}

// ── A. Sequential dependencies ────────────────────────────────────────────────

describe('topoSort — A. Sequential dependencies', () => {
  it('A → B → C produces three sequential waves', () => {
    const steps = [
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['B'] }),
    ];
    const deps = buildDAG(steps);
    const waves = topoSort(steps, deps);
    expect(waves).toHaveLength(3);
    expect(waveIds(waves)).toEqual([['A'], ['B'], ['C']]);
  });

  it('A → B → C → D produces four sequential waves', () => {
    const steps = [
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['B'] }),
      step('D', { dependsOn: ['C'] }),
    ];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(4);
    expect(waveIds(waves)).toEqual([['A'], ['B'], ['C'], ['D']]);
  });

  it('step order in input does not affect sequential wave output', () => {
    // Reversed input — should still sort correctly
    const steps = [
      step('C', { dependsOn: ['B'] }),
      step('B', { dependsOn: ['A'] }),
      step('A'),
    ];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(3);
    expect(waveIds(waves)).toEqual([['A'], ['B'], ['C']]);
  });
});

// ── B. Parallel-safe nodes ────────────────────────────────────────────────────

describe('topoSort — B. Parallel-safe nodes', () => {
  it('A → B and A → C: B and C are in same wave', () => {
    const steps = [
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['A'] }),
    ];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(2);
    expect(waveIds(waves)[0]).toEqual(['A']);
    expect(waveIds(waves)[1]).toEqual(['B', 'C']);
  });

  it('independent nodes A, B, C produce single wave', () => {
    const steps = [step('A'), step('B'), step('C')];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(1);
    expect(waveIds(waves)[0]).toEqual(['A', 'B', 'C']);
  });

  it('four independent nodes — all in wave 1', () => {
    const steps = [step('W'), step('X'), step('Y'), step('Z')];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(1);
    expect(waveIds(waves)[0]).toHaveLength(4);
  });
});

// ── C. Mixed / diamond dependency graphs ─────────────────────────────────────

describe('topoSort — C. Mixed dependency graphs', () => {
  it('diamond: A → B, A → C, B+C → D', () => {
    const steps = [
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['A'] }),
      step('D', { dependsOn: ['B', 'C'] }),
    ];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(3);
    expect(waveIds(waves)[0]).toEqual(['A']);
    expect(waveIds(waves)[1]).toEqual(['B', 'C']);
    expect(waveIds(waves)[2]).toEqual(['D']);
  });

  it('fan-out then fan-in with extra leaf', () => {
    // A → B, A → C, B → D, C → D, A → E (E is independent leaf after A)
    const steps = [
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['A'] }),
      step('D', { dependsOn: ['B', 'C'] }),
      step('E', { dependsOn: ['A'] }),
    ];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(3);
    expect(waveIds(waves)[0]).toEqual(['A']);
    expect(waveIds(waves)[1]).toEqual(['B', 'C', 'E']);
    expect(waveIds(waves)[2]).toEqual(['D']);
  });

  it('two independent chains execute in parallel', () => {
    // Chain 1: A → B; Chain 2: X → Y — should interleave in waves
    const steps = [
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('X'),
      step('Y', { dependsOn: ['X'] }),
    ];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(2);
    expect(waveIds(waves)[0]).toEqual(['A', 'X']);
    expect(waveIds(waves)[1]).toEqual(['B', 'Y']);
  });
});

// ── D. Missing dependency handling ────────────────────────────────────────────

describe('buildDAG — D. Missing dependency handling', () => {
  it('dependsOn referencing non-existent step ID is included in dep set', () => {
    // buildDAG does NOT validate existence — it just records the dep
    // topoSort will hang/throw if the ghost dep is unresolvable
    const steps = [step('A', { dependsOn: ['GHOST'] }), step('B')];
    const deps = buildDAG(steps);
    expect(deps.get('A')?.has('GHOST')).toBe(true);
  });

  it('step with empty dependsOn has empty dep set (no implicit deps)', () => {
    const steps = [step('A', { dependsOn: [] })];
    const deps = buildDAG(steps);
    expect(deps.get('A')?.size).toBe(0);
  });

  it('step with undefined dependsOn treated as empty', () => {
    const s = step('A');
    delete (s as Partial<ApiTestStep>).dependsOn;
    const deps = buildDAG([s]);
    expect(deps.get('A')?.size).toBe(0);
  });
});

// ── E. Circular dependency detection ─────────────────────────────────────────

describe('topoSort — E. Circular dependency detection', () => {
  it('direct cycle A → B → A throws CircularDependencyError', () => {
    const steps = [
      step('A', { dependsOn: ['B'] }),
      step('B', { dependsOn: ['A'] }),
    ];
    expect(() => topoSort(steps, buildDAG(steps))).toThrow(CircularDependencyError);
  });

  it('three-node cycle A → B → C → A throws CircularDependencyError', () => {
    const steps = [
      step('A', { dependsOn: ['C'] }),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['B'] }),
    ];
    expect(() => topoSort(steps, buildDAG(steps))).toThrow(CircularDependencyError);
  });

  it('self-referencing step A → A throws CircularDependencyError', () => {
    const steps = [step('A', { dependsOn: ['A'] })];
    expect(() => topoSort(steps, buildDAG(steps))).toThrow(CircularDependencyError);
  });

  it('cycle in larger graph with some acyclic nodes still throws', () => {
    const steps = [
      step('X'),
      step('Y', { dependsOn: ['X'] }),
      step('A', { dependsOn: ['B'] }),
      step('B', { dependsOn: ['A'] }),
    ];
    expect(() => topoSort(steps, buildDAG(steps))).toThrow(CircularDependencyError);
  });

  it('CircularDependencyError has correct name and message', () => {
    const steps = [
      step('A', { dependsOn: ['B'] }),
      step('B', { dependsOn: ['A'] }),
    ];
    try {
      topoSort(steps, buildDAG(steps));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CircularDependencyError);
      expect((e as CircularDependencyError).name).toBe('CircularDependencyError');
      expect((e as CircularDependencyError).message).toContain('Circular dependency');
    }
  });
});

// ── F. Variable-reference auto-dependency ─────────────────────────────────────

describe('buildDAG — F. Variable-reference auto-dependency (implicit edges)', () => {
  it('step referencing {{token}} produced by another step gets implicit dep', () => {
    const producer = step('login', {
      extractVariables: [{ name: 'token', source: 'responseBody', path: '$.token' }],
    });
    const consumer = step('get-profile', {
      request: { method: 'GET', url: '/api/profile?token={{token}}' },
    });
    const deps = buildDAG([producer, consumer]);
    expect(deps.get('get-profile')?.has('login')).toBe(true);
  });

  it('step referencing ${token} (ES6 syntax) also gets implicit dep', () => {
    const producer = step('login', {
      extractVariables: [{ name: 'token', source: 'responseBody', path: '$.token' }],
    });
    const consumer = step('use-token', {
      request: { method: 'POST', url: '/api/action', body: '{"auth": "${token}"}' },
    });
    const deps = buildDAG([producer, consumer]);
    expect(deps.get('use-token')?.has('login')).toBe(true);
  });

  it('variable ref in request header generates implicit dep', () => {
    const producer = step('auth', {
      extractVariables: [{ name: 'sessionId', source: 'responseBody', path: '$.session' }],
    });
    const consumer = step('call', {
      request: {
        method: 'GET',
        url: '/api/data',
        headers: [{ key: 'X-Session', value: '{{sessionId}}', enabled: true }],
      },
    });
    const deps = buildDAG([producer, consumer]);
    expect(deps.get('call')?.has('auth')).toBe(true);
  });

  it('step does NOT get dep on itself for its own extracted variables', () => {
    const s = step('self', {
      extractVariables: [{ name: 'myVar', source: 'responseBody', path: '$.x' }],
      request: { method: 'GET', url: '/api/test?x={{myVar}}' },
    });
    const deps = buildDAG([s]);
    expect(deps.get('self')?.has('self')).toBe(false);
  });

  it('variable not produced by any step generates no implicit dep', () => {
    const s = step('A', {
      request: { method: 'GET', url: '/api/test?x={{orphanVar}}' },
    });
    const deps = buildDAG([s]);
    // orphanVar has no producer — no dep added
    expect(deps.get('A')?.size).toBe(0);
  });

  it('implicit var dep + explicit dependsOn are both present', () => {
    const producer = step('auth', {
      extractVariables: [{ name: 'token', source: 'responseBody', path: '$.token' }],
    });
    const explicit = step('setup');
    const consumer = step('action', {
      dependsOn: ['setup'],
      request: { method: 'POST', url: '/api/action', body: '{"t":"{{token}}"}' },
    });
    const deps = buildDAG([producer, explicit, consumer]);
    expect(deps.get('action')?.has('auth')).toBe(true);
    expect(deps.get('action')?.has('setup')).toBe(true);
  });
});

// ── G. Group ordering ─────────────────────────────────────────────────────────

describe('buildDAG — G. Group ordering', () => {
  it('steps in same group ordered by order field get sequential deps', () => {
    const steps = [
      step('g1', { group: 'checkout', order: 1 } as Partial<ApiTestStep> & ApiTestStep),
      step('g2', { group: 'checkout', order: 2 } as Partial<ApiTestStep> & ApiTestStep),
      step('g3', { group: 'checkout', order: 3 } as Partial<ApiTestStep> & ApiTestStep),
    ];
    const deps = buildDAG(steps);
    // g2 depends on g1 (lower order in same group)
    expect(deps.get('g2')?.has('g1')).toBe(true);
    // g3 depends on g1 and g2
    expect(deps.get('g3')?.has('g1')).toBe(true);
    expect(deps.get('g3')?.has('g2')).toBe(true);
  });

  it('steps in different groups do not get cross-group deps', () => {
    const steps = [
      step('a1', { group: 'groupA', order: 1 } as Partial<ApiTestStep> & ApiTestStep),
      step('b1', { group: 'groupB', order: 1 } as Partial<ApiTestStep> & ApiTestStep),
    ];
    const deps = buildDAG(steps);
    expect(deps.get('a1')?.has('b1')).toBe(false);
    expect(deps.get('b1')?.has('a1')).toBe(false);
  });

  it('steps without group are not affected by group ordering', () => {
    const steps = [
      step('ungrouped'),
      step('g1', { group: 'myGroup', order: 1 } as Partial<ApiTestStep> & ApiTestStep),
    ];
    const deps = buildDAG(steps);
    expect(deps.get('ungrouped')?.has('g1')).toBe(false);
    expect(deps.get('g1')?.has('ungrouped')).toBe(false);
  });
});

// ── H. Deterministic topo ordering ───────────────────────────────────────────

describe('topoSort — H. Stable / deterministic ordering', () => {
  it('same steps in different input order produce same wave structure', () => {
    const makeSteps = () => [
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['A'] }),
      step('D', { dependsOn: ['B', 'C'] }),
    ];
    const order1 = waveIds(topoSort(makeSteps(), buildDAG(makeSteps())));
    const shuffled = [makeSteps()[3], makeSteps()[1], makeSteps()[0], makeSteps()[2]];
    const order2 = waveIds(topoSort(shuffled, buildDAG(shuffled)));
    expect(order1).toEqual(order2);
  });

  it('multiple independent runs produce identical wave counts', () => {
    const steps = [
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['B'] }),
    ];
    const run1 = topoSort(steps, buildDAG(steps));
    const run2 = topoSort(steps, buildDAG(steps));
    expect(run1.length).toBe(run2.length);
    expect(waveIds(run1)).toEqual(waveIds(run2));
  });
});

// ── I. Edge cases — empty and single-step collections ─────────────────────────

describe('topoSort — I. Edge cases', () => {
  it('empty step array returns empty waves', () => {
    const waves = topoSort([], buildDAG([]));
    expect(waves).toHaveLength(0);
  });

  it('single step with no deps returns single wave of one', () => {
    const steps = [step('only')];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(1);
    expect(waves[0][0].id).toBe('only');
  });

  it('two independent steps return single wave of two', () => {
    const steps = [step('X'), step('Y')];
    const waves = topoSort(steps, buildDAG(steps));
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(2);
  });
});

// ── J. extractVarRefs unit tests ──────────────────────────────────────────────

describe('extractVarRefs — J. Variable reference extraction', () => {
  it('extracts {{var}} from URL', () => {
    const s = step('A', { request: { method: 'GET', url: '/api/{{userId}}' } });
    expect(extractVarRefs(s)).toContain('userId');
  });

  it('extracts ${var} from URL', () => {
    const s = step('A', { request: { method: 'GET', url: '/api/${userId}' } });
    expect(extractVarRefs(s)).toContain('userId');
  });

  it('extracts multiple refs from URL', () => {
    const s = step('A', { request: { method: 'GET', url: '/{{base}}/{{resource}}/{{id}}' } });
    const refs = extractVarRefs(s);
    expect(refs).toContain('base');
    expect(refs).toContain('resource');
    expect(refs).toContain('id');
  });

  it('extracts refs from string body', () => {
    const s = step('A', {
      request: { method: 'POST', url: '/api/x', body: '{"token":"{{authToken}}"}' },
    });
    expect(extractVarRefs(s)).toContain('authToken');
  });

  it('extracts refs from array headers', () => {
    const s = step('A', {
      request: {
        method: 'GET',
        url: '/api/x',
        headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
      },
    });
    expect(extractVarRefs(s)).toContain('token');
  });

  it('extracts refs from object headers', () => {
    const s = step('A', {
      request: {
        method: 'GET',
        url: '/api/x',
        headers: { 'X-User': '{{userId}}' } as unknown as [],
      },
    });
    expect(extractVarRefs(s)).toContain('userId');
  });

  it('returns empty array when no refs present', () => {
    const s = step('A', { request: { method: 'GET', url: '/api/static' } });
    expect(extractVarRefs(s)).toHaveLength(0);
  });

  it('non-string body does not cause errors', () => {
    const s = step('A', {
      request: { method: 'POST', url: '/api/x', body: { key: 'value' } },
    });
    expect(() => extractVarRefs(s)).not.toThrow();
  });
});

// ── K. nodeType guard — future non-HTTP node safety ──────────────────────────

describe('nodeType guard — K. Future WorkflowNode safety', () => {
  it('HTTP nodeType is the only currently supported type', () => {
    // This test documents the contract: Phase B extraction code MUST guard
    // against non-HTTP nodes. Any switch(node.nodeType) without a default
    // throw is a bug. This test serves as a living documentation checkpoint.
    const supportedTypes = ['HTTP'] as const;
    const futureTypes = ['ASSERTION', 'EXTRACT', 'CONDITION', 'TRANSFORM', 'PARALLEL', 'CONTRACT', 'AI', 'LOOP'];

    // Guard pattern that MUST be used in Phase B workflow-engine switch statements:
    function guardNodeType(nodeType: string): void {
      if (!supportedTypes.includes(nodeType as typeof supportedTypes[number])) {
        throw new Error(`Unsupported nodeType: ${nodeType} — Phase B supports HTTP only`);
      }
    }

    expect(() => guardNodeType('HTTP')).not.toThrow();
    for (const t of futureTypes) {
      expect(() => guardNodeType(t)).toThrow('Unsupported nodeType');
    }
  });

  it('DAG functions accept ApiTestStep regardless of future nodeType field', () => {
    // ApiTestStep has no nodeType field — DAG functions must remain nodeType-agnostic
    // This test confirms buildDAG + topoSort work without any nodeType awareness
    const steps = [
      step('A'),
      step('B', { dependsOn: ['A'] }),
    ];
    expect(() => {
      const deps = buildDAG(steps);
      topoSort(steps, deps);
    }).not.toThrow();
  });
});
