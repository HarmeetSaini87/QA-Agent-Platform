import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-query-test-'));
  process.env.DATA_DIR = tmpDir;
});
afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

vi.mock('../../storage-provider/execution-store', () => ({
  loadRunResult: vi.fn(),
  loadSnapshot: vi.fn(),
}));
vi.mock('../../api-runtime/artifact-engine/timeline-builder', () => ({
  loadTimeline: vi.fn(),
}));
vi.mock('../replay-event-store', () => ({
  loadReplaySession: vi.fn(),
  replaySessionExists: vi.fn(),
  saveReplaySession: vi.fn(),
}));

import { getObservabilitySummary } from '../observability-query';
import { loadRunResult, loadSnapshot } from '../../storage-provider/execution-store';
import { loadTimeline } from '../../api-runtime/artifact-engine/timeline-builder';
import { loadReplaySession, replaySessionExists, saveReplaySession } from '../replay-event-store';

const mockLoadRunResult = vi.mocked(loadRunResult);
const mockLoadSnapshot = vi.mocked(loadSnapshot);
const mockLoadTimeline = vi.mocked(loadTimeline);
const mockLoadReplaySession = vi.mocked(loadReplaySession);
const mockReplaySessionExists = vi.mocked(replaySessionExists);
const mockSaveReplaySession = vi.mocked(saveReplaySession);

function makeRun() {
  return {
    id: 'run-1', collectionId: 'col-1', startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:01Z', status: 'passed' as const,
    stepResults: [], variableContext: {},
  };
}

describe('getObservabilitySummary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null when run result not found', async () => {
    mockLoadRunResult.mockReturnValue(undefined);
    const result = await getObservabilitySummary('run-x');
    expect(result).toBeNull();
  });

  it('returns summary with run metadata when run exists', async () => {
    mockLoadRunResult.mockReturnValue(makeRun() as any);
    mockLoadSnapshot.mockReturnValue(undefined);
    mockLoadTimeline.mockResolvedValue(undefined);
    mockReplaySessionExists.mockReturnValue(false);
    mockLoadReplaySession.mockReturnValue(null);
    mockSaveReplaySession.mockReturnValue(undefined);

    const summary = await getObservabilitySummary('run-1');
    expect(summary).not.toBeNull();
    expect(summary!.runId).toBe('run-1');
    expect(summary!.collectionId).toBe('col-1');
  });

  it('synthesizes and caches replay session when not yet stored', async () => {
    mockLoadRunResult.mockReturnValue(makeRun() as any);
    mockLoadSnapshot.mockReturnValue(undefined);
    mockLoadTimeline.mockResolvedValue(undefined);
    mockReplaySessionExists.mockReturnValue(false);
    mockLoadReplaySession.mockReturnValue(null);
    mockSaveReplaySession.mockReturnValue(undefined);

    await getObservabilitySummary('run-1');
    expect(mockSaveReplaySession).toHaveBeenCalledOnce();
  });

  it('loads cached replay session when already stored', async () => {
    mockLoadRunResult.mockReturnValue(makeRun() as any);
    mockLoadSnapshot.mockReturnValue(undefined);
    mockLoadTimeline.mockResolvedValue(undefined);
    mockReplaySessionExists.mockReturnValue(true);
    mockLoadReplaySession.mockReturnValue({
      runId: 'run-1', collectionId: 'col-1', synthesizedAt: '2026-01-01T00:00:00Z',
      _schemaVersion: 1, events: [], eventCount: 0,
      stats: { requestsSent: 0, assertionsPassed: 0, assertionsFailed: 0, retriesTriggered: 0, teardownEvents: 0, failuresPropagated: 0 },
    });

    const summary = await getObservabilitySummary('run-1');
    expect(mockSaveReplaySession).not.toHaveBeenCalled();
    expect(summary!.replay).not.toBeNull();
  });

  it('includes hasSnapshot and hasTimeline in summary', async () => {
    mockLoadRunResult.mockReturnValue(makeRun() as any);
    mockLoadSnapshot.mockReturnValue({ runId: 'run-1' } as any);
    mockLoadTimeline.mockResolvedValue({ runId: 'run-1', events: [] } as any);
    mockReplaySessionExists.mockReturnValue(false);
    mockLoadReplaySession.mockReturnValue(null);
    mockSaveReplaySession.mockReturnValue(undefined);

    const summary = await getObservabilitySummary('run-1');
    expect(summary!.hasSnapshot).toBe(true);
    expect(summary!.hasTimeline).toBe(true);
  });
});
