/**
 * snapshot-foundation.test.ts
 * Phase C Step 2: execution-store, snapshot-sanitizer, timeline-builder enrichment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sanitizeSnapshot } from '../snapshot-sanitizer';
import { saveExecutionSnapshot, loadExecutionSnapshot, deleteExecutionSnapshot } from '../execution-store';
import { buildTimelineFromRecords } from '../timeline-builder';
import type { ExecutionSnapshot } from '../../../../shared-core/contracts/dependency-graph.contract';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot {
  return {
    runId: 'run-test-1',
    collectionId: 'col-1',
    projectId: 'proj-1',
    capturedAt: '2026-05-11T00:00:00.000Z',
    graph: {
      nodes: {},
      edges: [],
      layers: [],
      executionOrder: [],
      hasCycle: false,
    },
    nodeRecords: {},
    completedNodeIds: [],
    runningNodeIds: [],
    pendingNodeIds: [],
    blockedNodeIds: [],
    failedNodeIds: [],
    skippedNodeIds: [],
    variableState: {},
    runStatus: 'completed',
    ...overrides,
  };
}

// ── snapshot-sanitizer ────────────────────────────────────────────────────────

describe('sanitizeSnapshot', () => {
  it('passes snapshot with no sensitive vars unchanged', () => {
    const snap = makeSnapshot({
      nodeRecords: {
        n1: {
          nodeId: 'n1', nodeName: 'Step 1', status: 'completed',
          variablesBefore: { userId: '42' },
          variablesAfter: { orderId: 'abc' },
        },
      },
      variableState: { userId: '42' },
    });
    const result = sanitizeSnapshot(snap);
    expect(result.nodeRecords['n1'].variablesBefore?.['userId']).toBe('42');
    expect(result.nodeRecords['n1'].variablesAfter?.['orderId']).toBe('abc');
    expect(result.variableState['userId']).toBe('42');
  });

  it('masks token in variablesBefore', () => {
    const snap = makeSnapshot({
      nodeRecords: {
        n1: {
          nodeId: 'n1', nodeName: 'Auth', status: 'completed',
          variablesBefore: { authToken: 'supersecret', userId: '1' },
        },
      },
    });
    const result = sanitizeSnapshot(snap);
    expect(result.nodeRecords['n1'].variablesBefore?.['authToken']).toBe('***');
    expect(result.nodeRecords['n1'].variablesBefore?.['userId']).toBe('1');
  });

  it('masks password in variablesAfter', () => {
    const snap = makeSnapshot({
      nodeRecords: {
        n1: {
          nodeId: 'n1', nodeName: 'Login', status: 'completed',
          variablesAfter: { password: 'hunter2', name: 'Alice' },
        },
      },
    });
    const result = sanitizeSnapshot(snap);
    expect(result.nodeRecords['n1'].variablesAfter?.['password']).toBe('***');
    expect(result.nodeRecords['n1'].variablesAfter?.['name']).toBe('Alice');
  });

  it('masks api_key, secret, credential, apiKey in variableState', () => {
    const snap = makeSnapshot({
      variableState: {
        api_key: 'abc123',
        secret: 'shh',
        credential: 'xyz',
        apiKey: 'k1',
        publicData: 'ok',
      },
    });
    const result = sanitizeSnapshot(snap);
    expect(result.variableState['api_key']).toBe('***');
    expect(result.variableState['secret']).toBe('***');
    expect(result.variableState['credential']).toBe('***');
    expect(result.variableState['apiKey']).toBe('***');
    expect(result.variableState['publicData']).toBe('ok');
  });

  it('does not mutate the original snapshot', () => {
    const original: ExecutionSnapshot = makeSnapshot({
      variableState: { token: 'real' },
    });
    sanitizeSnapshot(original);
    expect(original.variableState['token']).toBe('real');
  });

  it('handles undefined variablesBefore/After gracefully', () => {
    const snap = makeSnapshot({
      nodeRecords: {
        n1: { nodeId: 'n1', nodeName: 'S', status: 'skipped' },
      },
    });
    const result = sanitizeSnapshot(snap);
    expect(result.nodeRecords['n1'].variablesBefore).toBeUndefined();
    expect(result.nodeRecords['n1'].variablesAfter).toBeUndefined();
  });
});

// ── execution-store ───────────────────────────────────────────────────────────

describe('execution-store', () => {
  let tmpDir: string;
  const origDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testforge-snap-'));
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origDataDir;
  });

  it('saves and loads snapshot round-trip', async () => {
    const snap = makeSnapshot({ runId: 'rtt-1', variableState: { x: '1' } });
    await saveExecutionSnapshot(snap);
    const loaded = await loadExecutionSnapshot('rtt-1');
    expect(loaded).toBeDefined();
    expect(loaded?.runId).toBe('rtt-1');
    expect(loaded?.variableState['x']).toBe('1');
  });

  it('sanitizes secrets before writing to disk', async () => {
    const snap = makeSnapshot({
      runId: 'sec-run',
      variableState: { token: 'mysecret', name: 'Alice' },
    });
    await saveExecutionSnapshot(snap);
    // Read raw file — must be masked
    const snapDir = path.join(tmpDir, 'api-snapshots');
    const raw = JSON.parse(fs.readFileSync(path.join(snapDir, 'sec-run.snapshot.json'), 'utf-8'));
    expect(raw.variableState.token).toBe('***');
    expect(raw.variableState.name).toBe('Alice');
  });

  it('returns ArtifactRef with correct type and runId', async () => {
    const snap = makeSnapshot({ runId: 'ref-run' });
    const ref = await saveExecutionSnapshot(snap);
    expect(ref.type).toBe('execution-snapshot');
    expect(ref.runId).toBe('ref-run');
    expect(ref.filePath).toContain('ref-run.snapshot.json');
    expect(ref.sizeBytes).toBeGreaterThan(0);
  });

  it('returns undefined for missing runId', async () => {
    const result = await loadExecutionSnapshot('no-such-run');
    expect(result).toBeUndefined();
  });

  it('creates api-snapshots dir if missing', async () => {
    const snapDir = path.join(tmpDir, 'api-snapshots');
    expect(fs.existsSync(snapDir)).toBe(false);
    await saveExecutionSnapshot(makeSnapshot({ runId: 'mkdir-run' }));
    expect(fs.existsSync(snapDir)).toBe(true);
  });

  it('deleteExecutionSnapshot removes file', async () => {
    const snap = makeSnapshot({ runId: 'del-run' });
    await saveExecutionSnapshot(snap);
    await deleteExecutionSnapshot('del-run');
    const result = await loadExecutionSnapshot('del-run');
    expect(result).toBeUndefined();
  });

  it('deleteExecutionSnapshot is a no-op for non-existent file', async () => {
    await expect(deleteExecutionSnapshot('ghost-run')).resolves.not.toThrow();
  });
});

// ── buildTimelineFromRecords ──────────────────────────────────────────────────

describe('buildTimelineFromRecords', () => {
  const runStartedAt = '2026-05-11T10:00:00.000Z';

  it('emits node-started and node-completed for a completed node', () => {
    const records = {
      n1: {
        nodeId: 'n1', nodeName: 'Get User', status: 'completed' as const,
        startedAt: '2026-05-11T10:00:01.000Z',
        completedAt: '2026-05-11T10:00:02.000Z',
        durationMs: 1000,
      },
    };
    const tl = buildTimelineFromRecords('r1', 'c1', records, runStartedAt);
    const types = tl.events.map(e => e.eventType);
    expect(types).toContain('node-started');
    expect(types).toContain('node-completed');
  });

  it('uses accurate startedAt from record, not run start', () => {
    const records = {
      n1: {
        nodeId: 'n1', nodeName: 'Step', status: 'completed' as const,
        startedAt: '2026-05-11T10:00:05.000Z',
        completedAt: '2026-05-11T10:00:06.000Z',
        durationMs: 1000,
      },
    };
    const tl = buildTimelineFromRecords('r1', 'c1', records, runStartedAt);
    const started = tl.events.find(e => e.eventType === 'node-started');
    expect(started?.timestamp).toBe('2026-05-11T10:00:05.000Z');
    expect(started?.timestamp).not.toBe(runStartedAt);
  });

  it('emits node-failed for failed node with error detail', () => {
    const records = {
      n1: {
        nodeId: 'n1', nodeName: 'Post Order', status: 'failed' as const,
        startedAt: '2026-05-11T10:00:01.000Z',
        completedAt: '2026-05-11T10:00:02.000Z',
        durationMs: 1000,
        error: '500 Internal Server Error',
      },
    };
    const tl = buildTimelineFromRecords('r1', 'c1', records, runStartedAt);
    const failed = tl.events.find(e => e.eventType === 'node-failed');
    expect(failed).toBeDefined();
    expect(failed?.detail).toBe('500 Internal Server Error');
  });

  it('emits node-skipped for skipped node with skip reason', () => {
    const records = {
      n1: {
        nodeId: 'n1', nodeName: 'Cleanup', status: 'skipped' as const,
        skipReason: 'dependency-failed' as const,
      },
    };
    const tl = buildTimelineFromRecords('r1', 'c1', records, runStartedAt);
    const skipped = tl.events.find(e => e.eventType === 'node-skipped');
    expect(skipped?.detail).toBe('dependency-failed');
  });

  it('emits node-retrying events for each retry attempt', () => {
    const records = {
      n1: {
        nodeId: 'n1', nodeName: 'Flaky', status: 'completed' as const,
        startedAt: '2026-05-11T10:00:01.000Z',
        completedAt: '2026-05-11T10:00:04.000Z',
        durationMs: 3000,
        retryState: { attempt: 2, maxRetries: 3, delayMs: 500, retriedOnStatuses: [503, 503] },
      },
    };
    const tl = buildTimelineFromRecords('r1', 'c1', records, runStartedAt);
    const retrying = tl.events.filter(e => e.eventType === 'node-retrying');
    expect(retrying).toHaveLength(2);
  });

  it('events sorted by timestamp', () => {
    const records = {
      n2: {
        nodeId: 'n2', nodeName: 'Second', status: 'completed' as const,
        startedAt: '2026-05-11T10:00:05.000Z',
        completedAt: '2026-05-11T10:00:06.000Z',
        durationMs: 1000,
      },
      n1: {
        nodeId: 'n1', nodeName: 'First', status: 'completed' as const,
        startedAt: '2026-05-11T10:00:01.000Z',
        completedAt: '2026-05-11T10:00:02.000Z',
        durationMs: 1000,
      },
    };
    const tl = buildTimelineFromRecords('r1', 'c1', records, runStartedAt);
    const timestamps = tl.events.map(e => e.timestamp);
    const sorted = [...timestamps].sort();
    expect(timestamps).toEqual(sorted);
  });

  it('returns zero totalDurationMs for empty records', () => {
    const tl = buildTimelineFromRecords('r1', 'c1', {}, runStartedAt);
    expect(tl.totalDurationMs).toBe(0);
    expect(tl.events).toHaveLength(0);
  });

  it('sums durationMs across all completed nodes', () => {
    const records = {
      n1: { nodeId: 'n1', nodeName: 'A', status: 'completed' as const, durationMs: 200 },
      n2: { nodeId: 'n2', nodeName: 'B', status: 'completed' as const, durationMs: 300 },
    };
    const tl = buildTimelineFromRecords('r1', 'c1', records, runStartedAt);
    expect(tl.totalDurationMs).toBe(500);
  });
});
