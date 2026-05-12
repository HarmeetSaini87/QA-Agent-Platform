/**
 * apiRunnerFacade.test.ts — Phase B Step 10
 * Validates that apiRunner.ts is a thin facade:
 *   - all public exports are present and functional
 *   - DAG compat re-exports produce correct results
 *   - no business logic remains (tested via export surface check)
 */

import { describe, it, expect } from 'vitest';

// ── Group 1: Public export surface ───────────────────────────────────────────

describe('apiRunner facade — export surface', () => {
  it('exports CircularDependencyError', async () => {
    const { CircularDependencyError } = await import('../apiRunner');
    expect(CircularDependencyError).toBeDefined();
    const err = new CircularDependencyError('A -> B -> A');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CircularDependencyError');
  });

  it('exports runCollection as a function', async () => {
    const { runCollection } = await import('../apiRunner');
    expect(typeof runCollection).toBe('function');
  });

  it('exports getVariableEngine returning a live engine', async () => {
    const { getVariableEngine } = await import('../apiRunner');
    const engine = getVariableEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.resolve).toBe('function');
  });

  it('exports getAssertionEngine returning a live engine', async () => {
    const { getAssertionEngine } = await import('../apiRunner');
    const engine = getAssertionEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.evaluate).toBe('function');
  });

  it('exports extractVarRefs', async () => {
    const { extractVarRefs } = await import('../apiRunner');
    expect(typeof extractVarRefs).toBe('function');
  });

  it('exports buildDAG (alias for buildAdjacency)', async () => {
    const { buildDAG } = await import('../apiRunner');
    expect(typeof buildDAG).toBe('function');
  });

  it('exports topoSort', async () => {
    const { topoSort } = await import('../apiRunner');
    expect(typeof topoSort).toBe('function');
  });
});

// ── Group 2: DAG compat re-exports produce correct results ────────────────────

describe('apiRunner facade — DAG compat re-exports', () => {
  it('extractVarRefs returns empty for step with no var refs', async () => {
    const { extractVarRefs } = await import('../apiRunner');
    const step = {
      id: 's1', name: 'S',
      request: { method: 'GET', url: '/api/resource' },
      assertions: [], extractVariables: [], execution: {}, dependsOn: [],
    } as never;
    expect(extractVarRefs(step)).toEqual([]);
  });

  it('extractVarRefs detects double-brace variable references in URL', async () => {
    const { extractVarRefs } = await import('../apiRunner');
    const step = {
      id: 's1', name: 'S',
      request: { method: 'GET', url: '/api/{{userId}}/orders' },
      assertions: [], extractVariables: [], execution: {}, dependsOn: [],
    } as never;
    expect(extractVarRefs(step)).toContain('userId');
  });

  it('buildDAG returns a Map', async () => {
    const { buildDAG } = await import('../apiRunner');
    const steps = [
      { id: 'a', name: 'A', request: { method: 'GET', url: '/a' }, assertions: [], extractVariables: [], execution: {}, dependsOn: [] },
      { id: 'b', name: 'B', request: { method: 'GET', url: '/b' }, assertions: [], extractVariables: [], execution: {}, dependsOn: ['a'] },
    ] as never[];
    const dag = buildDAG(steps);
    expect(dag).toBeInstanceOf(Map);
  });

  it('topoSort places A before B when B dependsOn A', async () => {
    const { topoSort, buildDAG } = await import('../apiRunner');
    const steps = [
      { id: 'b', name: 'B', request: { method: 'GET', url: '/b' }, assertions: [], extractVariables: [], execution: {}, dependsOn: ['a'] },
      { id: 'a', name: 'A', request: { method: 'GET', url: '/a' }, assertions: [], extractVariables: [], execution: {}, dependsOn: [] },
    ] as never[];
    const dag = buildDAG(steps);
    const waves = topoSort(steps, dag);
    expect(waves[0].some((s: { id: string }) => s.id === 'a')).toBe(true);
    expect(waves[1].some((s: { id: string }) => s.id === 'b')).toBe(true);
  });

  it('topoSort throws on cyclic deps (message check)', async () => {
    const { buildDAG, topoSort } = await import('../apiRunner');
    const steps = [
      { id: 'a', name: 'A', request: { method: 'GET', url: '/a' }, assertions: [], extractVariables: [], execution: {}, dependsOn: ['b'] },
      { id: 'b', name: 'B', request: { method: 'GET', url: '/b' }, assertions: [], extractVariables: [], execution: {}, dependsOn: ['a'] },
    ] as never[];
    const dag = buildDAG(steps);
    // Note: dag-builder throws its own CircularDependencyError (from shared-core);
    // apiRunner re-exports a local one. Both have the same name/message — check by name.
    expect(() => topoSort(steps, dag)).toThrow(/circular/i);
  });
});

// ── Group 3: CircularDependencyError contract ─────────────────────────────────

describe('apiRunner facade — CircularDependencyError', () => {
  it('is instanceof Error', async () => {
    const { CircularDependencyError } = await import('../apiRunner');
    expect(new CircularDependencyError('x')).toBeInstanceOf(Error);
  });

  it('is instanceof CircularDependencyError', async () => {
    const { CircularDependencyError } = await import('../apiRunner');
    const err = new CircularDependencyError('A -> B -> A');
    expect(err).toBeInstanceOf(CircularDependencyError);
  });

  it('message contains cycle path', async () => {
    const { CircularDependencyError } = await import('../apiRunner');
    const err = new CircularDependencyError('Step A -> Step B -> Step A');
    expect(err.message).toContain('Step A -> Step B -> Step A');
    expect(err.message).toContain('Circular dependency');
  });

  it('is catchable by type', async () => {
    const { CircularDependencyError } = await import('../apiRunner');
    expect(() => { throw new CircularDependencyError('cycle'); }).toThrow(CircularDependencyError);
  });
});

// ── Group 4: No dead exports (Phase B Step 10 cleanup validation) ─────────────

describe('apiRunner facade — dead-code removal validation', () => {
  it('does not export makeRateLimiter (moved to workflow-engine)', async () => {
    const mod = await import('../apiRunner') as Record<string, unknown>;
    expect(mod['makeRateLimiter']).toBeUndefined();
  });

  it('does not export runChunked (moved to workflow-engine)', async () => {
    const mod = await import('../apiRunner') as Record<string, unknown>;
    expect(mod['runChunked']).toBeUndefined();
  });

  it('does not export evaluateCondition (moved to workflow-engine)', async () => {
    const mod = await import('../apiRunner') as Record<string, unknown>;
    expect(mod['evaluateCondition']).toBeUndefined();
  });

  it('does not export executeStep (inlined into executeStepWithRetry)', async () => {
    const mod = await import('../apiRunner') as Record<string, unknown>;
    expect(mod['executeStep']).toBeUndefined();
  });
});
