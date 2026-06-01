/**
 * visualRegression.ts — baseline capture, comparison, diff generation
 *
 * Storage layout:
 *   data/visual-baselines/<projectId>/<baselineId>.png        ← approved baseline
 *   data/visual-baselines/<projectId>/<baselineId>-actual.png ← last captured actual
 *   data/visual-baselines/<projectId>/<baselineId>-diff.png   ← pixel diff image
 *   data/visual-baselines/index.json                          ← metadata registry
 */

import * as fs   from 'fs';
import * as path from 'path';
import { PNG }   from 'pngjs';
import pixelmatch from 'pixelmatch';

const BASELINES_DIR  = path.resolve('data', 'visual-baselines');
const INDEX_FILE     = path.join(BASELINES_DIR, 'index.json');

export interface BaselineEntry {
  id:           string;    // slugified key e.g. "projectId__testName__locatorName"
  projectId:    string;
  testName:     string;
  locatorName:  string;
  threshold:    number;    // 0–1, default 0.1
  status:       'approved' | 'pending-review' | 'no-baseline';
  diffPct?:     number;    // last diff percentage
  lastRunAt?:   string;
  createdAt:    string;
  approvedAt?:  string;
  approvedBy?:  string;
  width?:       number;
  height?:      number;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function readIndex(): BaselineEntry[] {
  if (!fs.existsSync(INDEX_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')); } catch { return []; }
}

function writeIndex(entries: BaselineEntry[]) {
  ensureDir(BASELINES_DIR);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2));
}

export function makeBaselineId(projectId: string, testName: string, locatorName: string): string {
  const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  return `${slug(projectId)}__${slug(testName)}__${slug(locatorName)}`;
}

function projectDir(projectId: string): string {
  const slug = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(BASELINES_DIR, slug);
}

export function getBaseline(id: string): BaselineEntry | undefined {
  return readIndex().find(e => e.id === id);
}

export function getAllBaselines(projectId?: string): BaselineEntry[] {
  const all = readIndex();
  return projectId ? all.filter(e => e.projectId === projectId) : all;
}

export function baselineImagePath(projectId: string, id: string, type: 'baseline' | 'actual' | 'diff'): string {
  const suffix = type === 'baseline' ? '' : `-${type}`;
  return path.join(projectDir(projectId), `${id}${suffix}.png`);
}

export interface CompareResult {
  matched:    boolean;
  diffPct:    number;      // 0–100
  diffPixels: number;
  totalPixels: number;
  hasDiff:    boolean;
  message:    string;
  status:     'pass' | 'fail' | 'new-baseline';
}

/**
 * Compare a captured screenshot (PNG buffer) against the stored baseline.
 * If no baseline exists, saves the buffer as the new baseline and returns status='new-baseline'.
 */
export function compareScreenshot(
  projectId:   string,
  testName:    string,
  locatorName: string,
  actualBuffer: Buffer,
  threshold:   number = 0.1,
  approvedBy?: string,
): CompareResult {
  ensureDir(projectDir(projectId));

  const id           = makeBaselineId(projectId, testName, locatorName);
  const baselinePath = baselineImagePath(projectId, id, 'baseline');
  const actualPath   = baselineImagePath(projectId, id, 'actual');
  const diffPath     = baselineImagePath(projectId, id, 'diff');

  // Always save actual
  fs.writeFileSync(actualPath, actualBuffer);

  const index   = readIndex();
  const existing = index.find(e => e.id === id);

  // No baseline yet — save as baseline, mark approved
  if (!existing || !fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, actualBuffer);
    const entry: BaselineEntry = {
      id, projectId, testName, locatorName, threshold,
      status: 'approved',
      createdAt:  new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      approvedBy: approvedBy ?? 'auto',
      lastRunAt:  new Date().toISOString(),
    };
    const newIndex = existing ? index.map(e => e.id === id ? entry : e) : [...index, entry];
    writeIndex(newIndex);
    return { matched: true, diffPct: 0, diffPixels: 0, totalPixels: 0, hasDiff: false, message: 'New baseline captured', status: 'new-baseline' };
  }

  // Load baseline and actual PNGs
  let baselinePng: PNG, actualPng: PNG;
  try {
    baselinePng = PNG.sync.read(fs.readFileSync(baselinePath));
    actualPng   = PNG.sync.read(actualBuffer);
  } catch (err) {
    return { matched: false, diffPct: 100, diffPixels: 0, totalPixels: 0, hasDiff: false, message: `PNG read error: ${(err as Error).message}`, status: 'fail' };
  }

  // Resize actual to match baseline dimensions if they differ
  const { width, height } = baselinePng;
  const totalPixels = width * height;

  // If dimensions differ — treat as 100% fail
  if (actualPng.width !== width || actualPng.height !== height) {
    const msg = `Dimension mismatch — baseline ${width}×${height}, actual ${actualPng.width}×${actualPng.height}`;
    _updateIndex(index, id, { status: 'pending-review', diffPct: 100, lastRunAt: new Date().toISOString() });
    return { matched: false, diffPct: 100, diffPixels: totalPixels, totalPixels, hasDiff: true, message: msg, status: 'fail' };
  }

  const diff       = new PNG({ width, height });
  const diffPixels = pixelmatch(
    baselinePng.data, actualPng.data, diff.data,
    width, height,
    { threshold, includeAA: false }
  );
  const diffPct    = (diffPixels / totalPixels) * 100;
  const matched    = diffPct <= (threshold * 100);

  // Save diff image
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const newStatus: BaselineEntry['status'] = matched ? 'approved' : 'pending-review';
  _updateIndex(index, id, {
    status:    newStatus,
    diffPct:   Math.round(diffPct * 100) / 100,
    lastRunAt: new Date().toISOString(),
    width, height,
  });

  return {
    matched,
    diffPct:     Math.round(diffPct * 100) / 100,
    diffPixels,
    totalPixels,
    hasDiff:     diffPixels > 0,
    message:     matched
      ? `Visual match — ${diffPct.toFixed(2)}% diff (within ${(threshold * 100).toFixed(0)}% threshold)`
      : `Visual mismatch — ${diffPct.toFixed(2)}% diff exceeds ${(threshold * 100).toFixed(0)}% threshold`,
    status: matched ? 'pass' : 'fail',
  };
}

function _updateIndex(index: BaselineEntry[], id: string, patch: Partial<BaselineEntry>) {
  const idx = index.findIndex(e => e.id === id);
  if (idx >= 0) Object.assign(index[idx], patch);
  writeIndex(index);
}

/**
 * Approve a pending-review baseline — copies actual → baseline
 */
export function approveBaseline(id: string, approvedBy: string): boolean {
  const index   = readIndex();
  const entry   = index.find(e => e.id === id);
  if (!entry) return false;
  const actualPath   = baselineImagePath(entry.projectId, id, 'actual');
  const baselinePath = baselineImagePath(entry.projectId, id, 'baseline');
  if (!fs.existsSync(actualPath)) return false;
  fs.copyFileSync(actualPath, baselinePath);
  Object.assign(entry, { status: 'approved', approvedAt: new Date().toISOString(), approvedBy, diffPct: 0 });
  writeIndex(index);
  return true;
}

/**
 * Delete baseline — next run will treat as new
 */
export function deleteBaseline(id: string): boolean {
  const index = readIndex();
  const entry = index.find(e => e.id === id);
  if (!entry) return false;
  for (const type of ['baseline', 'actual', 'diff'] as const) {
    const p = baselineImagePath(entry.projectId, id, type);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  writeIndex(index.filter(e => e.id !== id));
  return true;
}
