import * as fs from 'fs';
import * as path from 'path';
import type { ReplaySession } from './contracts/replay-event.contracts';

function replayDir(): string {
  return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'replay-sessions');
}

function sessionPath(runId: string): string {
  return path.join(replayDir(), `${runId}.replay.json`);
}

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function saveReplaySession(session: ReplaySession): void {
  atomicWrite(sessionPath(session.runId), JSON.stringify(session, null, 2));
}

export function loadReplaySession(runId: string): ReplaySession | null {
  const file = sessionPath(runId);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as ReplaySession; }
  catch { return null; }
}

export function replaySessionExists(runId: string): boolean {
  return fs.existsSync(sessionPath(runId));
}
