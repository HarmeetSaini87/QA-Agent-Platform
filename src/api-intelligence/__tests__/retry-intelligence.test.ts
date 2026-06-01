import { describe, it, expect } from 'vitest';
import { analyzeRetryIntelligence } from '../engines/retry-intelligence';
import type { ApiTestStep, ApiCollectionRunResult } from '../../data/types';

function makeStep(overrides: Partial<ApiTestStep> = {}): ApiTestStep {
  return {
    id: 'step-1',
    name: 'Get User',
    request: { method: 'GET', url: '/users/1' },
    assertions: [],
    extractVariables: [],
    dependsOn: [],
    execution: {},
    ...overrides,
  } as ApiTestStep;
}

describe('analyzeRetryIntelligence', () => {
  it('flags teardown step with retries configured', () => {
    const steps = [makeStep({ id: 's1', name: 'Cleanup', execution: { teardown: true, retryPolicy: { maxRetries: 2, delayMs: 500 } } })];
    const { recommendations } = analyzeRetryIntelligence(steps, [], 'col-1');
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].severity).toBe('warning');
    expect(recommendations[0].category).toBe('retry');
    expect(recommendations[0].stepId).toBe('s1');
  });

  it('flags step with maxRetries > 2 and no assertions', () => {
    const steps = [makeStep({ id: 's2', name: 'Poll', assertions: [], execution: { retryPolicy: { maxRetries: 5, delayMs: 1000 } } })];
    const { recommendations } = analyzeRetryIntelligence(steps, [], 'col-1');
    expect(recommendations.some(r => r.category === 'retry' && r.stepId === 's2')).toBe(true);
  });

  it('returns no annotations for steps with no retry policy', () => {
    const steps = [makeStep({ id: 's3', execution: {} })];
    const { annotations } = analyzeRetryIntelligence(steps, [], 'col-1');
    expect(annotations).toHaveLength(0);
  });
});
