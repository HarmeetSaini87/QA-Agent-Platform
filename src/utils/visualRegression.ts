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
import type { VrtConfig, VrtStepOptions } from '../data/types';

const BASELINES_DIR  = path.resolve('data', 'visual-baselines');
const INDEX_FILE     = path.join(BASELINES_DIR, 'index.json');

// Category → RGB colour for hatched diff overlay
const IGNORE_CATEGORY_COLORS: Record<string, [number, number, number]> = {
  'dynamic-data':  [34,  197, 94],   // green  #22c55e
  'temporal':      [59,  130, 246],  // blue   #3b82f6
  'advertisement': [234, 179, 8],    // yellow #eab308
  'user-specific': [168, 85,  247],  // purple #a855f7
  'animated':      [249, 115, 22],   // orange #f97316
  'third-party':   [148, 163, 184],  // gray   #94a3b8
};
const IGNORE_COLOR_DEFAULT: [number, number, number] = [148, 163, 184];

export type IgnoreRegionCategory =
  | 'dynamic-data'
  | 'temporal'
  | 'advertisement'
  | 'user-specific'
  | 'animated'
  | 'third-party';

export interface IgnoreRegion {
  id:         string;                  // uuid
  name:       string;                  // "Live Clock", "Ad Banner"
  category:   IgnoreRegionCategory;
  x:          number;                  // pixels from left of baseline image
  y:          number;                  // pixels from top
  width:      number;
  height:     number;
  selector?:  string;                  // CSS selector — documentation/intent only
  reason?:    string;                  // why this region is ignored
  createdAt:  string;
  createdBy?: string;
}

export interface BaselineEntry {
  id:             string;    // slugified key e.g. "projectId__testName__locatorName"
  projectId:      string;
  testName:       string;
  locatorName:    string;
  browser?:       string;    // 'chromium' | 'firefox' | 'webkit' — absent for legacy entries
  threshold:      number;    // 0–1, default 0.1
  status:         'approved' | 'pending-review' | 'no-baseline';
  diffPct?:       number;    // last diff percentage
  lastRunAt?:     string;
  createdAt:      string;
  approvedAt?:    string;
  approvedBy?:    string;
  width?:         number;
  height?:        number;
  ignoreRegions?:          IgnoreRegion[];  // per-baseline ignore regions
  lastSavedPixels?:        number;          // pixels neutralised on last run
  totalRunsProtected?:     number;          // cumulative: runs where ignore regions fired
  totalPixelsSavedAllTime?: number;         // cumulative: total pixels neutralised across all runs
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

// OLD: export function makeBaselineId(projectId: string, testName: string, locatorName: string): string {
// OLD:   const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
// OLD:   return `${slug(projectId)}__${slug(testName)}__${slug(locatorName)}`;
// OLD: }
export function makeBaselineId(projectId: string, testName: string, locatorName: string, browser?: string): string {
  const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const base = `${slug(projectId)}__${slug(testName)}__${slug(locatorName)}`;
  return browser ? `${base}__${browser.toLowerCase()}` : base;
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

export interface RegionSavings {
  regionId:    string;
  regionName:  string;
  savedPixels: number;
}

export interface CompareResult {
  matched:           boolean;
  diffPct:           number;      // 0–100
  diffPixels:        number;
  totalPixels:       number;
  hasDiff:           boolean;
  message:           string;
  status:            'pass' | 'fail' | 'new-baseline';
  regionSavings?:    RegionSavings[];
  totalSavedPixels?: number;
}

// Merged VRT config — project defaults overridden by step-level options
export interface ResolvedVrtConfig {
  threshold:         number;
  maxDiffPixels:     number | null;
  maxDiffPixelRatio: number;
  animations:        'disabled' | 'allow';
  scale:             'css' | 'device';
  caret:             'hide' | 'initial';
  maskColor:         string;
  stylePath?:        string;
  timeout?:          number;
  // step-only
  mask?:             string[];
  omitBackground?:   boolean;
  clip?:             { x: number; y: number; width: number; height: number };
}

export const VRT_DEFAULTS: ResolvedVrtConfig = {
  threshold:         0.2,
  maxDiffPixels:     null,
  maxDiffPixelRatio: 0.02,  // 2% — ratio (0–1) stored format; OLD: 0.05 (5%) was too loose, 4.2% break diffs passed
  animations:        'disabled',
  scale:             'css',
  caret:             'hide',
  maskColor:         '#FF00FF',
};

export function mergeVrtConfig(
  projectConfig?: VrtConfig,
  stepOptions?:   VrtStepOptions,
): ResolvedVrtConfig {
  return {
    ...VRT_DEFAULTS,
    ...(projectConfig ?? {}),
    ...(stepOptions   ?? {}),
  } as ResolvedVrtConfig;
}

function drawHatchedIgnoreRegion(
  dp: Buffer,
  imgWidth: number,
  imgHeight: number,
  region: IgnoreRegion
): void {
  const [cr, cg, cb] = IGNORE_CATEGORY_COLORS[region.category] ?? IGNORE_COLOR_DEFAULT;
  const BORDER       = 2;   // solid border thickness px
  const HATCH_STEP   = 10;  // diagonal hatch period px
  const HATCH_WIDTH  = 3;   // hatch line thickness px
  const FILL_ALPHA   = 0.25;
  const BORDER_ALPHA = 0.85;

  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(imgWidth  - 1, region.x + region.width  - 1);
  const y1 = Math.min(imgHeight - 1, region.y + region.height - 1);

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const b = (py * imgWidth + px) * 4;
      const onBorder = py < y0 + BORDER || py > y1 - BORDER || px < x0 + BORDER || px > x1 - BORDER;
      const onHatch  = (px + py) % HATCH_STEP < HATCH_WIDTH;

      if (onBorder) {
        dp[b]     = Math.round(dp[b]     * (1 - BORDER_ALPHA) + cr * BORDER_ALPHA);
        dp[b + 1] = Math.round(dp[b + 1] * (1 - BORDER_ALPHA) + cg * BORDER_ALPHA);
        dp[b + 2] = Math.round(dp[b + 2] * (1 - BORDER_ALPHA) + cb * BORDER_ALPHA);
        dp[b + 3] = 255;
      } else if (onHatch) {
        dp[b]     = Math.round(dp[b]     * (1 - FILL_ALPHA) + cr * FILL_ALPHA);
        dp[b + 1] = Math.round(dp[b + 1] * (1 - FILL_ALPHA) + cg * FILL_ALPHA);
        dp[b + 2] = Math.round(dp[b + 2] * (1 - FILL_ALPHA) + cb * FILL_ALPHA);
        dp[b + 3] = 255;
      }
      // non-border, non-hatch pixels left as-is (actual image shows through)
    }
  }
}

/**
 * Compare a captured screenshot (PNG buffer) against the stored baseline.
 * If no baseline exists, saves the buffer as the new baseline and returns status='new-baseline'.
 * config = mergeVrtConfig(project.vrtConfig, step.vrtOptions)
 */
export function compareScreenshot(
  projectId:    string,
  testName:     string,
  locatorName:  string,
  actualBuffer: Buffer,
  config:       Partial<ResolvedVrtConfig> = {},
  approvedBy?:  string,
  browser?:     string,
): CompareResult {
  const resolved: ResolvedVrtConfig = { ...VRT_DEFAULTS, ...config };
  ensureDir(projectDir(projectId));

  const id           = makeBaselineId(projectId, testName, locatorName, browser);
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
      id, projectId, testName, locatorName,
      browser: browser || undefined,
      threshold: resolved.threshold,
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

  // If dimensions differ — generate a side-by-side composite diff image so the user
  // can see WHAT changed (baseline vs actual), not just "Diff: none".
  // OLD: returned early with no diff image → "Diff: none" shown in UI, zero context.
  if (actualPng.width !== width || actualPng.height !== height) {
    const msg = `Dimension mismatch — baseline ${width}×${height}, actual ${actualPng.width}×${actualPng.height}`;

    // Build composite: [baseline | 4px red divider | actual], height = max of both
    const cW  = width + 4 + actualPng.width;
    const cH  = Math.max(height, actualPng.height);
    const composite = new PNG({ width: cW, height: cH });
    composite.data.fill(240); // light gray background

    // Paint baseline (left)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4;
        const dst = (y * cW + x) * 4;
        composite.data[dst]     = baselinePng.data[src];
        composite.data[dst + 1] = baselinePng.data[src + 1];
        composite.data[dst + 2] = baselinePng.data[src + 2];
        composite.data[dst + 3] = 255;
      }
    }
    // Red divider (center 4px)
    for (let y = 0; y < cH; y++) {
      for (let x = width; x < width + 4; x++) {
        const dst = (y * cW + x) * 4;
        composite.data[dst] = 220; composite.data[dst + 1] = 38; composite.data[dst + 2] = 38; composite.data[dst + 3] = 255;
      }
    }
    // Paint actual (right)
    for (let y = 0; y < actualPng.height; y++) {
      for (let x = 0; x < actualPng.width; x++) {
        const src = (y * actualPng.width + x) * 4;
        const dst = (y * cW + (width + 4 + x)) * 4;
        composite.data[dst]     = actualPng.data[src];
        composite.data[dst + 1] = actualPng.data[src + 1];
        composite.data[dst + 2] = actualPng.data[src + 2];
        composite.data[dst + 3] = 255;
      }
    }

    fs.writeFileSync(diffPath, PNG.sync.write(composite));
    _updateIndex(index, id, { status: 'pending-review', diffPct: 100, lastRunAt: new Date().toISOString(), width, height });
    return { matched: false, diffPct: 100, diffPixels: totalPixels, totalPixels, hasDiff: true, message: msg, status: 'fail', regionSavings: [], totalSavedPixels: 0 };
  }

  // Load ignore regions for this baseline
  const ignoreRegions: IgnoreRegion[] = existing?.ignoreRegions ?? [];

  // Clone buffers — comparisons run on copies; originals preserved for diff rendering
  const baselineForCmp = Buffer.from(baselinePng.data);
  const actualForCmp   = Buffer.from(actualPng.data);

  // Neutralise ignored areas: paint identical neutral gray on both copies
  // → pixelmatch sees no diff there → pixels not counted as changed
  const NEUTRAL = [180, 180, 180, 255] as const;
  for (const region of ignoreRegions) {
    const rx0 = Math.max(0, region.x);
    const ry0 = Math.max(0, region.y);
    const rx1 = Math.min(width  - 1, region.x + region.width  - 1);
    const ry1 = Math.min(height - 1, region.y + region.height - 1);
    for (let py = ry0; py <= ry1; py++) {
      for (let px = rx0; px <= rx1; px++) {
        const idx = (py * width + px) * 4;
        baselineForCmp[idx] = NEUTRAL[0]; baselineForCmp[idx+1] = NEUTRAL[1]; baselineForCmp[idx+2] = NEUTRAL[2]; baselineForCmp[idx+3] = NEUTRAL[3];
        actualForCmp[idx]   = NEUTRAL[0]; actualForCmp[idx+1]   = NEUTRAL[1]; actualForCmp[idx+2]   = NEUTRAL[2]; actualForCmp[idx+3]   = NEUTRAL[3];
      }
    }
  }

  // Raw mask — no ignoring — used to compute savings per region
  const rawMask = new PNG({ width, height });
  pixelmatch(baselinePng.data, actualPng.data, rawMask.data, width, height,
    { threshold: resolved.threshold, includeAA: false, alpha: 0, diffColor: [255, 0, 0], aaColor: [255, 0, 0] });

  // Compute false-positive savings per region
  const regionSavings: RegionSavings[] = [];
  let totalSavedPixels = 0;
  for (const region of ignoreRegions) {
    let saved = 0;
    const rx0 = Math.max(0, region.x);
    const ry0 = Math.max(0, region.y);
    const rx1 = Math.min(width  - 1, region.x + region.width  - 1);
    const ry1 = Math.min(height - 1, region.y + region.height - 1);
    for (let py = ry0; py <= ry1; py++) {
      for (let px = rx0; px <= rx1; px++) {
        const idx = (py * width + px) * 4;
        if (rawMask.data[idx] === 255 && rawMask.data[idx+1] === 0 && rawMask.data[idx+2] === 0) saved++;
      }
    }
    regionSavings.push({ regionId: region.id, regionName: region.name, savedPixels: saved });
    totalSavedPixels += saved;
  }

  // Step 1: Run pixelmatch into a temp buffer to identify which pixels changed.
  // We do NOT use this buffer as the final diff image — it's a change mask only.
  const tempDiff   = new PNG({ width, height });
  const diffPixels = pixelmatch(
    baselineForCmp, actualForCmp, tempDiff.data,
    width, height,
    // Use a distinctive diffColor so changed pixels are reliably detectable.
    // includeAA: false — skip anti-aliasing detection noise.
    { threshold: resolved.threshold, includeAA: false, alpha: 0, diffColor: [255, 0, 0], aaColor: [255, 0, 0] }
  );

  // Step 2: Enterprise-grade diff rendering — bounding-box region highlighting.
  // Strategy: same as Percy, Chromatic, Chrome DevTools layout-shift overlay.
  //   - Start with actual screenshot at full fidelity (no baseline pixels, no tinting).
  //   - Detect changed pixel rows → group into contiguous bands (8px gap tolerance).
  //   - Draw each band as a red rectangle: solid 3px border + 20% red fill.
  //   - Content inside rectangle stays readable; rectangle clearly marks the changed region.
  // Result: "Record Saved" is readable in the actual; the rectangle tells the user that region changed.
  // No ghost text, no superimposition, full page context preserved.

  const ap = actualPng.data;
  const tp = tempDiff.data;  // change mask: [255,0,0] = changed, [255,255,255] = unchanged (alpha:0)

  // 2a. Find row extents of changed pixels
  const rowMap = new Map<number, { minX: number; maxX: number }>();
  for (let i = 0; i < width * height; i++) {
    if (tp[i * 4] === 255 && tp[i * 4 + 1] === 0 && tp[i * 4 + 2] === 0) {
      const x = i % width;
      const y = Math.floor(i / width);
      const r = rowMap.get(y);
      if (r) { r.minX = Math.min(r.minX, x); r.maxX = Math.max(r.maxX, x); }
      else rowMap.set(y, { minX: x, maxX: x });
    }
  }

  // 2b. Group consecutive changed rows into bands (8px gap tolerance)
  type Band = { minX: number; maxX: number; minY: number; maxY: number };
  const bands: Band[] = [];
  const GAP = 8;
  for (const [y, { minX, maxX }] of Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0])) {
    const last = bands[bands.length - 1];
    if (last && y - last.maxY <= GAP) {
      last.maxY = y;
      last.minX = Math.min(last.minX, minX);
      last.maxX = Math.max(last.maxX, maxX);
    } else {
      bands.push({ minX, maxX, minY: y, maxY: y });
    }
  }

  // 2c. Build diff: copy actual, then draw bounding-box highlights
  const diff = new PNG({ width, height });
  const dp   = diff.data;
  for (let i = 0; i < ap.length; i++) dp[i] = ap[i];  // start with full-fidelity actual

  const PAD    = 5;   // padding around each band
  const BORDER = 3;   // border thickness in pixels
  const FILL   = 0.18; // fill alpha (20% red tint — content still readable)
  const BR = 220, BG = 38, BB = 38;  // red: #DC2626

  for (const band of bands) {
    const x0 = Math.max(0, band.minX - PAD);
    const y0 = Math.max(0, band.minY - PAD);
    const x1 = Math.min(width  - 1, band.maxX + PAD);
    const y1 = Math.min(height - 1, band.maxY + PAD);

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const b = (py * width + px) * 4;
        const onBorder = py < y0 + BORDER || py > y1 - BORDER || px < x0 + BORDER || px > x1 - BORDER;
        if (onBorder) {
          // Solid red border — fully opaque, no actual content visible
          dp[b] = BR; dp[b + 1] = BG; dp[b + 2] = BB; dp[b + 3] = 255;
        } else {
          // Light red fill — blend actual pixel with red so content is readable
          dp[b]     = Math.round(ap[b]     * (1 - FILL) + BR * FILL);
          dp[b + 1] = Math.round(ap[b + 1] * (1 - FILL) + BG * FILL);
          dp[b + 2] = Math.round(ap[b + 2] * (1 - FILL) + BB * FILL);
          dp[b + 3] = 255;
        }
      }
    }
  }

  const diffPct    = (diffPixels / totalPixels) * 100;
  // Pass check: diffPct within threshold AND within maxDiffPixelRatio AND within maxDiffPixels (if set)
  const withinRatio    = diffPct / 100 <= resolved.maxDiffPixelRatio;
  const withinPixels   = resolved.maxDiffPixels == null || diffPixels <= resolved.maxDiffPixels;
  const matched        = withinRatio && withinPixels;

  // Overlay hatched ignore regions on the diff image
  // Each region renders in its category colour so reviewers know WHY it was ignored
  for (const region of ignoreRegions) {
    drawHatchedIgnoreRegion(dp, width, height, region);
  }

  // Save diff image
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const newStatus: BaselineEntry['status'] = matched ? 'approved' : 'pending-review';
  // Read fresh entry for cumulative counters (avoid stale snapshot)
  const freshEntry = readIndex().find(e => e.id === id);
  const prevRunsProtected  = freshEntry?.totalRunsProtected     ?? 0;
  const prevPixelsSaved    = freshEntry?.totalPixelsSavedAllTime ?? 0;
  _updateIndex(index, id, {
    status:                 newStatus,
    diffPct:                Math.round(diffPct * 100) / 100,
    lastRunAt:              new Date().toISOString(),
    width, height,
    lastSavedPixels:        totalSavedPixels,
    totalRunsProtected:     totalSavedPixels > 0 ? prevRunsProtected  + 1 : prevRunsProtected,
    totalPixelsSavedAllTime: totalSavedPixels > 0 ? prevPixelsSaved + totalSavedPixels : prevPixelsSaved,
  });

  // hasDiff: true if pixels changed OR if ignore regions actively neutralised pixels
  // (so the diff image — which shows hatched overlays — is always surfaced when regions are working)
  const hasDiff = diffPixels > 0 || totalSavedPixels > 0;

  return {
    matched,
    diffPct:          Math.round(diffPct * 100) / 100,
    diffPixels,
    totalPixels,
    hasDiff,
    message:          matched
      ? `Visual match — ${diffPct.toFixed(2)}% diff (threshold ${(resolved.threshold * 100).toFixed(0)}%, ratio ${(resolved.maxDiffPixelRatio * 100).toFixed(0)}%)`
      : `Visual mismatch — ${diffPct.toFixed(2)}% diff (${diffPixels}px) exceeds configured tolerance`,
    status:           matched ? 'pass' : 'fail',
    regionSavings,
    totalSavedPixels,
  };
}

function _updateIndex(_stale: BaselineEntry[], id: string, patch: Partial<BaselineEntry>) {
  // OLD: wrote stale snapshot back — concurrent calls overwrote each other's status
  // Re-read fresh to avoid race between parallel ASSERT VISUAL steps
  const fresh = readIndex();
  const idx = fresh.findIndex(e => e.id === id);
  if (idx >= 0) Object.assign(fresh[idx], patch);
  writeIndex(fresh);
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

// ── Ignore Region CRUD helpers ──────────────────────────────────────────────

export function getIgnoreRegions(id: string): IgnoreRegion[] {
  const entry = getBaseline(id);
  return entry?.ignoreRegions ?? [];
}

export function addIgnoreRegion(id: string, region: Omit<IgnoreRegion, 'id' | 'createdAt'>): IgnoreRegion | null {
  const index = readIndex();
  const entry = index.find(e => e.id === id);
  if (!entry) return null;
  const newRegion: IgnoreRegion = { ...region, id: require('crypto').randomUUID(), createdAt: new Date().toISOString() };
  if (!entry.ignoreRegions) entry.ignoreRegions = [];
  entry.ignoreRegions.push(newRegion);
  writeIndex(index);
  return newRegion;
}

export function updateIgnoreRegion(id: string, regionId: string, patch: Partial<Omit<IgnoreRegion, 'id' | 'createdAt'>>): IgnoreRegion | null {
  const index = readIndex();
  const entry = index.find(e => e.id === id);
  if (!entry || !entry.ignoreRegions) return null;
  const region = entry.ignoreRegions.find(r => r.id === regionId);
  if (!region) return null;
  Object.assign(region, patch);
  writeIndex(index);
  return region;
}

export function deleteIgnoreRegion(id: string, regionId: string): boolean {
  const index = readIndex();
  const entry = index.find(e => e.id === id);
  if (!entry || !entry.ignoreRegions) return false;
  const before = entry.ignoreRegions.length;
  entry.ignoreRegions = entry.ignoreRegions.filter(r => r.id !== regionId);
  if (entry.ignoreRegions.length === before) return false;
  writeIndex(index);
  return true;
}
