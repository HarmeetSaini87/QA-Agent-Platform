import { describe, it, expect } from 'vitest';
import { sanitizeVariableMap, sanitizeNodeRecord, sanitizeSnapshot } from '../snapshot-sanitizer';
import type { ExecutionSnapshot, NodeExecutionRecord } from '../../../shared-core/contracts/dependency-graph.contract';

describe('sanitizeVariableMap', () => {
  it('masks password key', () => {
    const result = sanitizeVariableMap({ password: 'secret123', name: 'Alice' });
    expect(result.password).toBe('***');
    expect(result.name).toBe('Alice');
  });

  it('masks token key', () => {
    const result = sanitizeVariableMap({ authToken: 'Bearer xyz', userId: '42' });
    expect(result.authToken).toBe('***');
    expect(result.userId).toBe('42');
  });

  it('masks apiKey, api_key variants', () => {
    const result = sanitizeVariableMap({ apiKey: 'k1', api_key: 'k2', label: 'ok' });
    expect(result.apiKey).toBe('***');
    expect(result.api_key).toBe('***');
    expect(result.label).toBe('ok');
  });

  it('masks secret, credential, auth keys', () => {
    const result = sanitizeVariableMap({ clientSecret: 'x', myCredential: 'y', authHeader: 'z' });
    expect(result.clientSecret).toBe('***');
    expect(result.myCredential).toBe('***');
    expect(result.authHeader).toBe('***');
  });

  it('preserves non-secret keys unchanged', () => {
    const result = sanitizeVariableMap({ baseUrl: 'http://x', timeout: '5000', userId: 'u1' });
    expect(result).toEqual({ baseUrl: 'http://x', timeout: '5000', userId: 'u1' });
  });

  it('does not mutate input', () => {
    const input = { password: 'secret', name: 'Alice' };
    sanitizeVariableMap(input);
    expect(input.password).toBe('secret');
  });
});

describe('sanitizeNodeRecord', () => {
  const base: NodeExecutionRecord = {
    nodeId: 'n1',
    nodeName: 'Login',
    status: 'completed',
  };

  it('masks variablesBefore', () => {
    const rec: NodeExecutionRecord = { ...base, variablesBefore: { token: 'abc', url: 'http://x' } };
    const result = sanitizeNodeRecord(rec);
    expect(result.variablesBefore?.token).toBe('***');
    expect(result.variablesBefore?.url).toBe('http://x');
  });

  it('masks variablesAfter', () => {
    const rec: NodeExecutionRecord = { ...base, variablesAfter: { password: 'pw', count: '3' } };
    const result = sanitizeNodeRecord(rec);
    expect(result.variablesAfter?.password).toBe('***');
    expect(result.variablesAfter?.count).toBe('3');
  });

  it('handles undefined variablesBefore/After without error', () => {
    const result = sanitizeNodeRecord(base);
    expect(result.variablesBefore).toBeUndefined();
    expect(result.variablesAfter).toBeUndefined();
  });

  it('does not mutate input record', () => {
    const rec: NodeExecutionRecord = { ...base, variablesBefore: { token: 'abc' } };
    sanitizeNodeRecord(rec);
    expect(rec.variablesBefore?.token).toBe('abc');
  });
});

describe('sanitizeSnapshot', () => {
  const makeSnapshot = (): ExecutionSnapshot => ({
    runId: 'run-1',
    collectionId: 'col-1',
    capturedAt: new Date().toISOString(),
    graph: { edges: [], layers: [], executionOrder: [], hasCycle: false, nodes: {} },
    nodeRecords: {
      n1: {
        nodeId: 'n1', nodeName: 'Login', status: 'completed',
        variablesBefore: { token: 'abc', baseUrl: 'http://x' },
        variablesAfter: { userId: 'u1', password: 'pw' },
      },
    },
    completedNodeIds: ['n1'],
    runningNodeIds: [],
    pendingNodeIds: [],
    blockedNodeIds: [],
    failedNodeIds: [],
    skippedNodeIds: [],
    variableState: { password: 'secret', name: 'Alice' },
    runStatus: 'completed',
  });

  it('masks variableState secrets', () => {
    const result = sanitizeSnapshot(makeSnapshot());
    expect(result.variableState.password).toBe('***');
    expect(result.variableState.name).toBe('Alice');
  });

  it('masks nodeRecord variable secrets', () => {
    const result = sanitizeSnapshot(makeSnapshot());
    expect(result.nodeRecords.n1.variablesBefore?.token).toBe('***');
    expect(result.nodeRecords.n1.variablesBefore?.baseUrl).toBe('http://x');
    expect(result.nodeRecords.n1.variablesAfter?.password).toBe('***');
    expect(result.nodeRecords.n1.variablesAfter?.userId).toBe('u1');
  });

  it('returns a structurally valid ExecutionSnapshot', () => {
    const result = sanitizeSnapshot(makeSnapshot());
    expect(result.runId).toBe('run-1');
    expect(result.runStatus).toBe('completed');
    expect(result.completedNodeIds).toEqual(['n1']);
  });

  it('does not mutate input snapshot', () => {
    const snap = makeSnapshot();
    sanitizeSnapshot(snap);
    expect(snap.variableState.password).toBe('secret');
    expect(snap.nodeRecords.n1.variablesBefore?.token).toBe('abc');
  });
});
