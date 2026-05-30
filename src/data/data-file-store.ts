/**
 * data-file-store.ts — persistence for uploaded CSV/JSON data files.
 *
 * Metadata is stored in data/api-data-files/index.json.
 * Row data is stored in data/api-data-files/<id>.rows.json.
 * Uses atomic write pattern (write .tmp then rename) consistent with other stores.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ApiDataFile } from './types';

const DATA_FILES_DIR = path.resolve('data', 'api-data-files');
const INDEX_FILE     = path.join(DATA_FILES_DIR, 'index.json');

function ensureDir(): void {
  if (!fs.existsSync(DATA_FILES_DIR)) fs.mkdirSync(DATA_FILES_DIR, { recursive: true });
}

function atomicWrite(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function listDataFiles(projectId?: string): ApiDataFile[] {
  ensureDir();
  if (!fs.existsSync(INDEX_FILE)) return [];
  try {
    const all = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) as ApiDataFile[];
    return projectId ? all.filter(f => f.projectId === projectId) : all;
  } catch { return []; }
}

export function getDataFile(id: string): ApiDataFile | null {
  return listDataFiles().find(f => f.id === id) ?? null;
}

export function getDataFileRows(id: string): Record<string, string>[] {
  ensureDir();
  const rowsFile = path.join(DATA_FILES_DIR, `${id}.rows.json`);
  if (!fs.existsSync(rowsFile)) return [];
  try { return JSON.parse(fs.readFileSync(rowsFile, 'utf-8')); } catch { return []; }
}

export function saveDataFile(
  meta: Omit<ApiDataFile, 'id' | 'createdAt'>,
  rows: Record<string, string>[],
): ApiDataFile {
  ensureDir();
  const id     = uuidv4();
  const record: ApiDataFile = { ...meta, id, createdAt: new Date().toISOString() };
  const all    = listDataFiles();
  atomicWrite(INDEX_FILE, [...all, record]);
  atomicWrite(path.join(DATA_FILES_DIR, `${id}.rows.json`), rows);
  return record;
}

export function updateDataFileLastUsed(id: string): void {
  ensureDir();
  const all = listDataFiles();
  const idx = all.findIndex(f => f.id === id);
  if (idx === -1) return;
  all[idx].lastUsedAt = new Date().toISOString();
  atomicWrite(INDEX_FILE, all);
}

export function renameDataFile(id: string, newName: string): ApiDataFile | null {
  ensureDir();
  const all = listDataFiles();
  const idx = all.findIndex(f => f.id === id);
  if (idx === -1) return null;
  all[idx].name = newName.trim().slice(0, 100);
  atomicWrite(INDEX_FILE, all);
  return all[idx];
}

export function deleteDataFile(id: string): boolean {
  ensureDir();
  const all = listDataFiles();
  const idx = all.findIndex(f => f.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  atomicWrite(INDEX_FILE, all);
  const rowsFile = path.join(DATA_FILES_DIR, `${id}.rows.json`);
  if (fs.existsSync(rowsFile)) fs.unlinkSync(rowsFile);
  return true;
}
