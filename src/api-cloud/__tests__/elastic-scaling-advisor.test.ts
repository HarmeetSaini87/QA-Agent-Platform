// src/api-cloud/__tests__/elastic-scaling-advisor.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ElasticScalingAdvisor } from '../elastic-scaling-advisor';

describe('ElasticScalingAdvisor', () => {
  let advisor: ElasticScalingAdvisor;

  beforeEach(() => {
    advisor = new ElasticScalingAdvisor();
    advisor.registerPolicy({
      policyId: 'p1',
      minWorkers: 1,
      maxWorkers: 5,
      scaleUpThreshold: 4,
      scaleDownThreshold: 1,
      burstContainmentLimit: 3,
    });
  });

  it('scale-up: queue above threshold', () => {
    const d = advisor.advise('p1', 2, 5);
    expect(d.direction).toBe('scale-up');
    expect(d.recommendedWorkers).toBe(3);
  });

  it('scale-down: queue below threshold', () => {
    const d = advisor.advise('p1', 3, 0);
    expect(d.direction).toBe('scale-down');
    expect(d.recommendedWorkers).toBe(2);
  });

  it('hold: queue within thresholds', () => {
    const d = advisor.advise('p1', 2, 2);
    expect(d.direction).toBe('hold');
    expect(d.recommendedWorkers).toBe(2);
  });

  it('cap at maxWorkers', () => {
    const d = advisor.advise('p1', 5, 10);
    expect(d.recommendedWorkers).toBe(5);
    expect(d.direction).toBe('hold');
  });

  it('floor at minWorkers', () => {
    const d = advisor.advise('p1', 1, 0);
    expect(d.recommendedWorkers).toBe(1);
    expect(d.direction).toBe('hold');
  });

  it('unknown policy: hold with reason', () => {
    const d = advisor.advise('unknown', 2, 5);
    expect(d.direction).toBe('hold');
    expect(d.reason).toBe('no-policy-registered');
  });

  it('advisoryNote is always present', () => {
    const d = advisor.advise('p1', 2, 5);
    expect(d.advisoryNote).toBeTruthy();
  });
});
