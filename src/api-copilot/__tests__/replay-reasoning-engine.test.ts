import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayReasoningEngine } from '../replay-reasoning-engine';

describe('ReplayReasoningEngine', () => {
  let engine: ReplayReasoningEngine;

  beforeEach(() => {
    engine = new ReplayReasoningEngine();
  });

  it('summarizeReplay returns summary with correct runId', () => {
    const summary = engine.summarizeReplay('run1', 'col1');
    expect(summary.runId).toBe('run1');
    expect(summary.collectionId).toBe('col1');
  });

  it('summary has summarizedAt timestamp', () => {
    const summary = engine.summarizeReplay('run1', 'col1');
    expect(summary.summarizedAt).toBeTruthy();
    expect(() => new Date(summary.summarizedAt)).not.toThrow();
  });

  it('summary fields are arrays', () => {
    const summary = engine.summarizeReplay('run1', 'col1');
    expect(Array.isArray(summary.failedStepIds)).toBe(true);
    expect(Array.isArray(summary.retryStepIds)).toBe(true);
    expect(Array.isArray(summary.teardownStepIds)).toBe(true);
    expect(Array.isArray(summary.anomalySignals)).toBe(true);
  });

  it('correlateRcaEvidence returns correlation with correct IDs', () => {
    const corr = engine.correlateRcaEvidence('run1', 'col1', 'step3');
    expect(corr.runId).toBe('run1');
    expect(corr.collectionId).toBe('col1');
    expect(corr.primaryFailureStepId).toBe('step3');
  });

  it('correlation has confidence 0–100', () => {
    const corr = engine.correlateRcaEvidence('run1', 'col1', 'step3');
    expect(corr.confidence).toBeGreaterThanOrEqual(0);
    expect(corr.confidence).toBeLessThanOrEqual(100);
  });

  it('correlation has at least one evidence item', () => {
    const corr = engine.correlateRcaEvidence('run1', 'col1', 'step3');
    expect(corr.evidenceItems.length).toBeGreaterThan(0);
  });

  it('correlation evidence weight is 0–1', () => {
    const corr = engine.correlateRcaEvidence('run1', 'col1', 'step3');
    for (const item of corr.evidenceItems) {
      expect(item.weight).toBeGreaterThanOrEqual(0);
      expect(item.weight).toBeLessThanOrEqual(1);
    }
  });

  it('each call produces unique correlationId', () => {
    const c1 = engine.correlateRcaEvidence('run1', 'col1', 'step1');
    const c2 = engine.correlateRcaEvidence('run1', 'col1', 'step1');
    expect(c1.correlationId).not.toBe(c2.correlationId);
  });
});
