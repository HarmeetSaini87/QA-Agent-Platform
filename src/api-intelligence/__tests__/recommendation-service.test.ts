// src/api-intelligence/__tests__/recommendation-service.test.ts
import { describe, it, expect } from 'vitest';
import { buildRecommendationBundle } from '../recommendation-service';
import type { ApiCollection, ApiCollectionRunResult } from '../../data/types';

function makeCollection(overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'col-1',
    name: 'Test Collection',
    environmentId: 'env-1',
    steps: [
      {
        id: 's1', name: 'Create', request: { method: 'POST', url: '/items' },
        assertions: [{ field: 'status', operator: 'eq', expected: 201 }],
        extractVariables: [], dependsOn: [], execution: {},
      } as any,
      {
        id: 's2', name: 'Get', request: { method: 'GET', url: '/items/1' },
        assertions: [], extractVariables: [], dependsOn: ['s1'], execution: {},
      } as any,
    ],
    variables: [],
    onFailure: 'stop',
    executionMode: 'sequential',
    ...overrides,
  };
}

describe('buildRecommendationBundle', () => {
  it('returns a bundle with advisory note', () => {
    const bundle = buildRecommendationBundle({ collection: makeCollection(), recentRuns: [], flakinessReport: null });
    expect(bundle.advisoryNote).toBeTruthy();
    expect(bundle.collectionId).toBe('col-1');
  });

  it('recommendations sorted critical > warning > info', () => {
    const col = makeCollection({
      steps: Array.from({ length: 4 }, (_, i) => ({
        id: `s${i}`, name: `Step ${i}`,
        request: { method: 'GET', url: '/x' },
        assertions: [], extractVariables: [], dependsOn: i > 0 ? ['s0'] : [],
        execution: {},
      })) as any,
    });
    // s0 is depended on by s1, s2, s3 → bottleneck (warning)
    const bundle = buildRecommendationBundle({ collection: col, recentRuns: [], flakinessReport: null });
    const severities = bundle.recommendations.map(r => r.severity);
    const order = { critical: 0, warning: 1, info: 2 };
    for (let i = 0; i < severities.length - 1; i++) {
      expect(order[severities[i]]).toBeLessThanOrEqual(order[severities[i + 1]]);
    }
  });

  it('accepts null flakinessReport without throwing', () => {
    expect(() => buildRecommendationBundle({
      collection: makeCollection(), recentRuns: [], flakinessReport: null,
    })).not.toThrow();
  });
});
