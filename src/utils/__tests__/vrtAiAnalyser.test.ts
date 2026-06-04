import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import * as analyser from '../vrtAiAnalyser';

vi.mock('../../utils/nlStore', () => ({
  loadNlConfig: vi.fn().mockResolvedValue(null),
}));

const BASE_CTX = {
  testName: 'Login Test',
  locatorName: '#submit-btn',
  diffPct: 3.4,
  diffPixels: 1200,
  totalPixels: 35000,
  baselineWidth: 1280,
  baselineHeight: 720,
  actualWidth: 1280,
  actualHeight: 720,
};

describe('buildRecommendation', () => {
  it('flags on Dimension Change', () => {
    expect(analyser.buildRecommendation(['Dimension Change'], 3)).toBe('flag');
  });
  it('flags on Layout Shift', () => {
    expect(analyser.buildRecommendation(['Layout Shift'], 3)).toBe('flag');
  });
  it('flags when diffPct > 15', () => {
    expect(analyser.buildRecommendation(['Content Change'], 16)).toBe('flag');
  });
  it('approves on only Dynamic Data + diffPct < 5', () => {
    expect(analyser.buildRecommendation(['Dynamic Data'], 4)).toBe('approve');
  });
  it('approves on only Style Drift + diffPct < 5', () => {
    expect(analyser.buildRecommendation(['Style Drift'], 2)).toBe('approve');
  });
  it('reviews on Content Change below threshold', () => {
    expect(analyser.buildRecommendation(['Content Change'], 5)).toBe('review');
  });
  it('reviews on empty classifications', () => {
    expect(analyser.buildRecommendation([], 3)).toBe('review');
  });
});

describe('classifyDiff', () => {
  it('returns Dimension Change when dimensions differ', async () => {
    const ctx = { ...BASE_CTX, actualWidth: 1440 };
    const result = await analyser.classifyDiff('nonexistent-id', ctx);
    expect(result.classifications).toContain('Dimension Change');
    expect(result.recommendation).toBe('flag');
    expect(result.dimensionMismatch).toBe(true);
  });

  it('returns empty classifications with review when diff PNG not found', async () => {
    const result = await analyser.classifyDiff('nonexistent-id', BASE_CTX);
    expect(result.classifications).toEqual([]);
    expect(result.recommendation).toBe('review');
  });
});

describe('enhanceWithAi', () => {
  it('throws when no AI provider configured', async () => {
    const classResult = {
      classifications: ['Content Change'] as analyser.ChangeClassification[],
      regions: 1,
      recommendation: 'review' as analyser.Recommendation,
      recommendationReason: 'test',
      dimensionMismatch: false,
      stage: 'rule-based' as const,
    };
    await expect(analyser.enhanceWithAi(classResult, BASE_CTX)).rejects.toThrow();
  });
});
