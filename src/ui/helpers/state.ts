import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../framework/config';
import type { RunRecord, DebugSession } from './types';

export const runs = new Map<string, RunRecord>();
export const debugSessions = new Map<string, DebugSession>();
export const debugPollers = new Map<string, NodeJS.Timeout>();
export const cronJobs = new Map<string, any>();

export function loadRunFromDisk(runId: string): RunRecord | null {
  const runFile = path.join(config.paths.results, `run-${runId}.json`);
  if (!fs.existsSync(runFile)) return null;
  try { return JSON.parse(fs.readFileSync(runFile, 'utf-8')) as RunRecord; } catch { return null; }
}

export function getRun(runId: string): RunRecord | null {
  const mem = runs.get(runId);
  if (mem) return mem;
  return loadRunFromDisk(runId);
}