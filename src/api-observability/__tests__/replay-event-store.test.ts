import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { saveReplaySession, loadReplaySession, replaySessionExists } from '../replay-event-store';
import type { ReplaySession } from '../contracts/replay-event.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSession(runId: string): ReplaySession {
  return {
    runId,
    collectionId: 'col-1',
    synthesizedAt: '2026-01-01T00:00:00Z',
    _schemaVersion: 1,
    events: [],
    eventCount: 0,
    stats: { requestsSent: 0, assertionsPassed: 0, assertionsFailed: 0, retriesTriggered: 0, teardownEvents: 0, failuresPropagated: 0 },
  };
}

describe('replay-event-store', () => {
  it('saveReplaySession writes to data/replay-sessions/<runId>.replay.json', () => {
    saveReplaySession(makeSession('run-1'));
    const file = path.join(tmpDir, 'replay-sessions', 'run-1.replay.json');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('loadReplaySession returns null when absent', () => {
    expect(loadReplaySession('missing')).toBeNull();
  });

  it('loadReplaySession returns the saved session', () => {
    saveReplaySession(makeSession('run-2'));
    const loaded = loadReplaySession('run-2');
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe('run-2');
  });

  it('replaySessionExists returns false when absent', () => {
    expect(replaySessionExists('missing')).toBe(false);
  });

  it('replaySessionExists returns true after save', () => {
    saveReplaySession(makeSession('run-3'));
    expect(replaySessionExists('run-3')).toBe(true);
  });

  it('saveReplaySession uses atomic write — no .tmp file left behind', () => {
    saveReplaySession(makeSession('run-4'));
    const tmp = path.join(tmpDir, 'replay-sessions', 'run-4.replay.json.tmp');
    expect(fs.existsSync(tmp)).toBe(false);
  });
});
