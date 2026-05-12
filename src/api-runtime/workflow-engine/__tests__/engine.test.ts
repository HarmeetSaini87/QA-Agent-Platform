import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine, createWorkflowEngine } from '../engine';
import type { WorkflowEngineConfig } from '../engine';
import type { ApiCollection, ApiEnvironment, ApiTestStep, ApiStepResult } from '../../../data/types';

function makeStep(id: string, overrides: Partial<ApiTestStep> = {}): ApiTestStep {
  return {
    id, name: `Step ${id}`,
    request: { method: 'GET', url: `https://api.test/${id}`, bodyType: 'none' },
    assertions: [], extractVariables: [], dependsOn: [],
    ...overrides,
  } as unknown as ApiTestStep;
}

function passResult(step: ApiTestStep): ApiStepResult {
  return {
    stepId: step.id, stepName: step.name, status: 'passed',
    request: step.request, assertionResults: [], extractedVariables: {}, durationMs: 10,
  };
}

function failResult(step: ApiTestStep): ApiStepResult {
  return { ...passResult(step), status: 'failed' };
}

function makeCollection(steps: ApiTestStep[], overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'col1', name: 'Test Collection', projectId: 'proj1',
    steps, variables: [], executionMode: 'auto', maxConcurrency: 5,
    rateLimit: { requestsPerSecond: 100 },
    ...overrides,
  } as unknown as ApiCollection;
}

function makeEnv(): ApiEnvironment {
  return {
    id: 'env1', name: 'Test Env', projectId: 'proj1',
    variables: [], authConfig: { type: 'none' }, baseUrl: 'https://api.test',
  } as unknown as ApiEnvironment;
}

function makeConfig(executeStepFn?: (step: ApiTestStep) => Promise<ApiStepResult>): WorkflowEngineConfig {
  const writes: ApiStepResult[][] = [];
  return {
    executeStep: executeStepFn
      ? (step) => executeStepFn(step)
      : async (step) => passResult(step),
    resolveAuth: async () => ({}),
    onPartialWrite: vi.fn(),
  };
}

// ── Group 1: sequential mode ──────────────────────────────────────────────────

describe('WorkflowEngine — sequential mode', () => {
  it('executes all steps and returns passed status', async () => {
    const steps = [makeStep('a'), makeStep('b')];
    const engine = createWorkflowEngine(makeConfig());
    const result = await engine.execute(makeCollection(steps, { executionMode: 'sequential' }), makeEnv(), 'run1', {});
    expect(result.status).toBe('passed');
    expect(result.stepResults).toHaveLength(2);
  });
});

// ── Group 2: parallel mode ────────────────────────────────────────────────────

describe('WorkflowEngine — parallel mode', () => {
  it('executes all steps in one wave', async () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c')];
    const engine = createWorkflowEngine(makeConfig());
    const result = await engine.execute(makeCollection(steps, { executionMode: 'parallel' }), makeEnv(), 'run1', {});
    expect(result.stepResults).toHaveLength(3);
    expect(result.status).toBe('passed');
  });
});

// ── Group 3: auto (DAG) mode ──────────────────────────────────────────────────

describe('WorkflowEngine — auto (DAG) mode', () => {
  it('respects dependsOn ordering', async () => {
    const order: string[] = [];
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const engine = createWorkflowEngine({
      ...makeConfig(),
      executeStep: async (step) => { order.push(step.id); return passResult(step); },
      resolveAuth: async () => ({}),
      onPartialWrite: vi.fn(),
    });
    await engine.execute(makeCollection([b, a]), makeEnv(), 'run1', {});
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });
});

// ── Group 4: condition guard ──────────────────────────────────────────────────

describe('WorkflowEngine — condition guard', () => {
  it('skips step when condition is false', async () => {
    const step = makeStep('a', { execution: { condition: 'false' } } as Partial<ApiTestStep>);
    const engine = createWorkflowEngine(makeConfig());
    const result = await engine.execute(makeCollection([step]), makeEnv(), 'run1', {});
    expect(result.stepResults[0].status).toBe('skipped');
  });

  it('executes step when condition is true', async () => {
    const step = makeStep('a', { execution: { condition: 'true' } } as Partial<ApiTestStep>);
    const engine = createWorkflowEngine(makeConfig());
    const result = await engine.execute(makeCollection([step]), makeEnv(), 'run1', {});
    expect(result.stepResults[0].status).toBe('passed');
  });
});

// ── Group 5: onFailure propagation ────────────────────────────────────────────

describe('WorkflowEngine — onFailure', () => {
  it('stops all remaining steps on onFailure=stop', async () => {
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'], execution: { onFailure: 'stop' } } as Partial<ApiTestStep>);
    const c = makeStep('c', { dependsOn: ['b'] });
    const engine = createWorkflowEngine({
      ...makeConfig(),
      executeStep: async (step) => step.id === 'b' ? failResult(step) : passResult(step),
      resolveAuth: async () => ({}),
      onPartialWrite: vi.fn(),
    });
    const col = makeCollection([a, b, c], { onFailure: 'stop' });
    const result = await engine.execute(col, makeEnv(), 'run1', {});
    expect(result.status).toBe('failed');
    // c should not appear in results (aborted)
    const cResult = result.stepResults.find(r => r.stepId === 'c');
    expect(cResult).toBeUndefined();
  });

  it('skips dependents on onFailure=skipDependents', async () => {
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const engine = createWorkflowEngine({
      ...makeConfig(),
      executeStep: async (step) => step.id === 'a' ? failResult(step) : passResult(step),
      resolveAuth: async () => ({}),
      onPartialWrite: vi.fn(),
    });
    const col = makeCollection([a, b], { onFailure: 'skipDependents' });
    const result = await engine.execute(col, makeEnv(), 'run1', {});
    expect(result.status).toBe('failed');
    const bResult = result.stepResults.find(r => r.stepId === 'b');
    expect(bResult).toBeUndefined(); // aborted — not in results
  });
});

// ── Group 6: teardown sequencing ──────────────────────────────────────────────

describe('WorkflowEngine — teardown', () => {
  it('runs teardown steps even when test steps fail', async () => {
    const test = makeStep('test');
    const teardown = makeStep('cleanup', { execution: { teardown: true } } as Partial<ApiTestStep>);
    const engine = createWorkflowEngine({
      ...makeConfig(),
      executeStep: async (step) => step.id === 'test' ? failResult(step) : passResult(step),
      resolveAuth: async () => ({}),
      onPartialWrite: vi.fn(),
    });
    const result = await engine.execute(makeCollection([test, teardown]), makeEnv(), 'run1', {});
    const cleanupResult = result.stepResults.find(r => r.stepId === 'cleanup');
    expect(cleanupResult?.status).toBe('passed');
  });

  it('teardown failure does not change final status', async () => {
    const test = makeStep('test');
    const teardown = makeStep('cleanup', { execution: { teardown: true } } as Partial<ApiTestStep>);
    const engine = createWorkflowEngine({
      ...makeConfig(),
      executeStep: async (step) => step.id === 'cleanup' ? failResult(step) : passResult(step),
      resolveAuth: async () => ({}),
      onPartialWrite: vi.fn(),
    });
    const result = await engine.execute(makeCollection([test, teardown]), makeEnv(), 'run1', {});
    expect(result.status).toBe('passed'); // test passed; teardown failure doesn't count
  });
});

// ── Group 7: partial write hook ───────────────────────────────────────────────

describe('WorkflowEngine — partial write hook', () => {
  it('calls onPartialWrite with running status during execution', async () => {
    const onPartialWrite = vi.fn();
    const engine = createWorkflowEngine({ ...makeConfig(), onPartialWrite });
    await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'run1', {});
    const runningCall = (onPartialWrite.mock.calls as Array<[string, unknown]>).find(c => c[0] === 'running');
    expect(runningCall).toBeTruthy();
  });
});

// ── Group 8: snapshot hooks ───────────────────────────────────────────────────

describe('WorkflowEngine — snapshot hooks', () => {
  it('calls onWaveStart with wave index and node IDs', async () => {
    const onWaveStart = vi.fn();
    const engine = createWorkflowEngine({
      ...makeConfig(),
      hooks: { onWaveStart },
    });
    await engine.execute(makeCollection([makeStep('a'), makeStep('b')]), makeEnv(), 'run1', {});
    expect(onWaveStart).toHaveBeenCalledWith(0, expect.arrayContaining(['a', 'b']));
  });

  it('calls onRunComplete with summary', async () => {
    const onRunComplete = vi.fn();
    const engine = createWorkflowEngine({ ...makeConfig(), hooks: { onRunComplete } });
    await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'run1', {});
    expect(onRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run1', totalNodes: 1 })
    );
  });
});

// ── Group 9: nodeType guard ───────────────────────────────────────────────────

describe('WorkflowEngine — nodeType guard', () => {
  it('throws on unsupported nodeType', async () => {
    const step = makeStep('a');
    (step as unknown as { nodeType: string }).nodeType = 'CONDITION';
    const engine = createWorkflowEngine(makeConfig());
    await expect(engine.execute(makeCollection([step]), makeEnv(), 'run1', {})).rejects.toThrow(/unsupported nodeType/);
  });

  it('accepts HTTP nodeType', async () => {
    const step = makeStep('a');
    (step as unknown as { nodeType: string }).nodeType = 'HTTP';
    const engine = createWorkflowEngine(makeConfig());
    const result = await engine.execute(makeCollection([step]), makeEnv(), 'run1', {});
    expect(result.status).toBe('passed');
  });
});
