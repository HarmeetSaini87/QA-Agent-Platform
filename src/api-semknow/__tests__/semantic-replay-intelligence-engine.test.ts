import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticReplayIntelligenceEngine } from '../semantic-replay-intelligence-engine';

describe('SemanticReplayIntelligenceEngine', () => {
  let engine: SemanticReplayIntelligenceEngine;

  beforeEach(() => {
    engine = new SemanticReplayIntelligenceEngine();
  });

  it('correlateSemantics returns one correlation per category', () => {
    const results = engine.correlateSemantics('col1', 'run1', ['execution-context', 'retry-semantic']);
    expect(results).toHaveLength(2);
  });

  it('correlateSemantics entries have isAnonymized and isExplainable true', () => {
    const results = engine.correlateSemantics('col1', 'run1', ['execution-context']);
    expect(results[0].isAnonymized).toBe(true);
    expect(results[0].isExplainable).toBe(true);
  });

  it('correlateSemantics returns empty array for empty categories', () => {
    expect(engine.correlateSemantics('col1', 'run1', [])).toHaveLength(0);
  });

  it('correlateSemantics each correlation has unique correlationId', () => {
    const results = engine.correlateSemantics('col1', 'run1', ['execution-context', 'dependency-semantic']);
    expect(results[0].correlationId).not.toBe(results[1].correlationId);
  });

  it('correlateSemantics has governanceNote', () => {
    const results = engine.correlateSemantics('col1', 'run1', ['orchestration-intent']);
    expect(results[0].governanceNote).toBeTruthy();
  });

  it('inferOrchestrationIntent returns isExplainable true', () => {
    expect(engine.inferOrchestrationIntent('col1', ['sig1']).isExplainable).toBe(true);
  });

  it('inferOrchestrationIntent with many signals infers complex orchestration', () => {
    const result = engine.inferOrchestrationIntent('col1', ['a', 'b', 'c']);
    expect(result.inferredIntent).toContain('Complex');
  });

  it('inferOrchestrationIntent with few signals infers sequential', () => {
    const result = engine.inferOrchestrationIntent('col1', ['a']);
    expect(result.inferredIntent).toContain('Sequential');
  });

  it('categorizeRetrySemantics detects cascade from signal', () => {
    const result = engine.categorizeRetrySemantics('col1', ['cascade failure']);
    expect(result.retryCategory).toBe('dependency-cascade');
    expect(result.isExplainable).toBe(true);
  });

  it('categorizeRetrySemantics detects environment-instability', () => {
    const result = engine.categorizeRetrySemantics('col1', ['environment timeout']);
    expect(result.retryCategory).toBe('environment-instability');
  });

  it('categorizeRetrySemantics defaults to unknown for empty signals', () => {
    expect(engine.categorizeRetrySemantics('col1', []).retryCategory).toBe('unknown');
  });

  it('categorizeRetrySemantics has recommendedSemanticAction', () => {
    const result = engine.categorizeRetrySemantics('col1', ['transient error']);
    expect(result.recommendedSemanticAction).toBeTruthy();
  });

  it('analyzeSlaSemantics returns isExplainable true', () => {
    expect(engine.analyzeSlaSemantics('col1', 70).isExplainable).toBe(true);
  });

  it('analyzeSlaSemantics reflects currentScore in slaContext', () => {
    const result = engine.analyzeSlaSemantics('col1', 55);
    expect(result.slaContext).toContain('55');
  });

  it('analyzeSlaSemantics has non-empty optimizationSemantics', () => {
    expect(engine.analyzeSlaSemantics('col1', 80).optimizationSemantics.length).toBeGreaterThan(0);
  });
});
