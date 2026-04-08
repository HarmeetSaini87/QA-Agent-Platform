/**
 * store.ts
 * JSON-based file storage layer.
 * Each collection lives in  data/<collection>.json
 * Thread-safety: synchronous reads/writes (single-process, no concurrency issues).
 */

import * as fs   from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Generic helpers ────────────────────────────────────────────────────────────

function filePath(collection: string): string {
  return path.join(DATA_DIR, `${collection}.json`);
}

export function readAll<T>(collection: string): T[] {
  const f = filePath(collection);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')) as T[]; }
  catch { return []; }
}

export function writeAll<T>(collection: string, records: T[]): void {
  fs.writeFileSync(filePath(collection), JSON.stringify(records, null, 2));
}

export function findById<T extends { id: string }>(collection: string, id: string): T | undefined {
  return readAll<T>(collection).find(r => r.id === id);
}

export function upsert<T extends { id: string }>(collection: string, record: T): T {
  const all  = readAll<T>(collection);
  const idx  = all.findIndex(r => r.id === record.id);
  if (idx >= 0) all[idx] = record; else all.push(record);
  writeAll(collection, all);
  return record;
}

export function remove(collection: string, id: string): boolean {
  const all     = readAll<{ id: string }>(collection);
  const filtered = all.filter(r => r.id !== id);
  if (filtered.length === all.length) return false;
  writeAll(collection, filtered);
  return true;
}

// ── Collection names ───────────────────────────────────────────────────────────

export const USERS       = 'users';
export const PROJECTS    = 'projects';
export const LOCATORS    = 'locators';
export const FUNCTIONS   = 'functions';
export const AUDIT       = 'audit';
export const SETTINGS    = 'settings';
export const SCRIPTS     = 'scripts';
export const SUITES      = 'suites';
export const COMMON_DATA = 'common_data';
export const SCHEDULES   = 'schedules';
