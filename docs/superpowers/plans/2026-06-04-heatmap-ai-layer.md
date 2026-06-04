# Heatmap + AI Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Heatmap view mode (thermal colour overlay on actual screenshot) and an on-demand AI Analysis panel (rule-based classifier + optional LLM narrative) to the VRT diff viewer in both execution-report.html and the Visual Baselines diff popup.

**Architecture:** New `vrtAiAnalyser.ts` utility handles all classification logic (rule-based + LLM). A new backend route `POST /api/visual-baselines/:id/ai-analysis` calls it. Frontend changes add a `🌡 Heatmap` mode button and a `🤖 AI Analysis` footer button to both diff viewer surfaces, using shared JS functions. Both surfaces reuse the same CSS classes.

**Tech Stack:** TypeScript · Express · pngjs (already in project) · vitest · existing `nlProvider.ts` / `nlStore.ts` · vanilla JS (execution-report.html is self-contained, no bundler)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/utils/vrtAiAnalyser.ts` | **CREATE** | Rule-based diff classifier + LLM enhancement |
| `src/utils/__tests__/vrtAiAnalyser.test.ts` | **CREATE** | Unit tests for classifier |
| `src/utils/nlProvider.ts` | **MODIFY** | Add `nlRawPrompt()` export (raw-prompt variant) |
| `src/ui/routes/visual.routes.ts` | **MODIFY** | Add `POST /api/visual-baselines/:id/ai-analysis` |
| `src/ui/public/styles_addon.css` | **MODIFY** | Chip, AI panel, heatmap overlay CSS |
| `src/ui/public/execution-report.html` | **MODIFY** | Heatmap mode + AI panel (inline diff viewer) |
| `src/ui/public/js/20-visual-regression.js` | **MODIFY** | Heatmap mode + AI panel (baselines diff popup) |

---

## Task 1: vrtAiAnalyser.ts — Types + Rule-Based Classifier

**Files:**
- Create: `src/utils/vrtAiAnalyser.ts`
- Create: `src/utils/__tests__/vrtAiAnalyser.test.ts`

- [ ] **Step 1.1: Write failing tests for rule-based classifier**

Create `src/utils/__tests__/vrtAiAnalyser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import path from 'path';
import { classifyDiff, buildRecommendation } from '../vrtAiAnalyser';
import type { RunContext, ClassificationResult } from '../vrtAiAnalyser';

const FIXTURES = path.join(__dirname, 'fixtures');

const baseCtx: RunContext = {
  testName: 'Login Page',
  locatorName: 'header',
  diffPct: 3.5,
  diffPixels: 1000,
  totalPixels: 28000,
  baselineWidth: 1280,
  baselineHeight: 720,
  actualWidth: 1280,
  actualHeight: 720,
  ignoreRegions: [],
};

describe('buildRecommendation', () => {
  it('returns approve for style-drift-only with diffPct < 5', () => {
    expect(buildRecommendation(['Style Drift'], 2.0)).toEqual({
      recommendation: 'approve',
      reason: 'Only minor style drift detected (2.0% diff) — no structural changes.',
    });
  });

  it('returns flag for dimension change', () => {
    expect(buildRecommendation(['Dimension Change'], 0)).toEqual({
      recommendation: 'flag',
      reason: 'Dimension change detected — viewport or screenshot size differs from baseline.',
    });
  });

  it('returns flag for layout shift', () => {
    expect(buildRecommendation(['Layout Shift'], 10)).toEqual({
      recommendation: 'flag',
      reason: 'Layout shift detected — element position or size changed significantly.',
    });
  });

  it('returns flag when diffPct > 15', () => {
    expect(buildRecommendation(['Content Change'], 18)).toEqual({
      recommendation: 'flag',
      reason: 'Large diff (18.0%) — exceeds automatic review threshold.',
    });
  });

  it('returns review for content change within threshold', () => {
    expect(buildRecommendation(['Content Change'], 8)).toEqual({
      recommendation: 'review',
      reason: 'Content change detected in 1 region type(s) — human review recommended.',
    });
  });

  it('returns approve for dynamic data only', () => {
    expect(buildRecommendation(['Dynamic Data'], 4)).toEqual({
      recommendation: 'approve',
      reason: 'Change overlaps known dynamic/ignore regions — likely expected noise.',
    });
  });

  it('returns review as fallback', () => {
    expect(buildRecommendation([], 5)).toEqual({
      recommendation: 'review',
      reason: 'No specific change type detected — review recommended.',
    });
  });
});

describe('classifyDiff — dimension mismatch', () => {
  it('returns Dimension Change when dimensions differ', async () => {
    const ctx = { ...baseCtx, actualWidth: 1366 };
    const result = await classifyDiff(null, ctx);
    expect(result.classifications).toContain('Dimension Change');
    expect(result.dimensionMismatch).toBe(true);
  });
});

describe('classifyDiff — no diff file', () => {
  it('returns empty classifications and review when diff path is null', async () => {
    const result = await classifyDiff(null, baseCtx);
    expect(result.classifications).toBeInstanceOf(Array);
    expect(result.recommendation).toBe('review');
    expect(result.stage).toBe('rule-based');
  });
});
```

- [ ] **Step 1.2: Run tests — verify they fail**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run test:unit -- --reporter=verbose src/utils/__tests__/vrtAiAnalyser.test.ts
```

Expected: `FAIL` — `Cannot find module '../vrtAiAnalyser'`

- [ ] **Step 1.3: Create `src/utils/vrtAiAnalyser.ts` with types + rule-based logic**

```typescript
import fs from 'fs';
import { PNG } from 'pngjs';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ChangeClassification =
  | 'Content Change'
  | 'Layout Shift'
  | 'Style Drift'
  | 'Element Added'
  | 'Element Removed'
  | 'Dynamic Data'
  | 'Dimension Change';

export type Recommendation = 'approve' | 'review' | 'flag';

export interface IgnoreRegionRef {
  x: number; y: number; width: number; height: number;
  category?: string;
}

export interface RunContext {
  testName: string;
  locatorName: string;
  diffPct: number;
  diffPixels: number;
  totalPixels: number;
  baselineWidth: number;
  baselineHeight: number;
  actualWidth: number;
  actualHeight: number;
  ignoreRegions: IgnoreRegionRef[];
}

export interface RecommendationResult {
  recommendation: Recommendation;
  reason: string;
}

export interface ClassificationResult {
  classifications: ChangeClassification[];
  regions: number;
  dimensionMismatch: boolean;
  recommendation: Recommendation;
  recommendationReason: string;
  stage: 'rule-based';
}

export interface AiEnhancedResult extends ClassificationResult {
  narrative: string;
  confidence: number;
  suggestedAction: Recommendation;
  model: string;
  stage: 'ai-enhanced';
}

// ── Recommendation logic ───────────────────────────────────────────────────────

export function buildRecommendation(
  classifications: ChangeClassification[],
  diffPct: number,
): RecommendationResult {
  if (classifications.includes('Dimension Change')) {
    return { recommendation: 'flag', reason: 'Dimension change detected — viewport or screenshot size differs from baseline.' };
  }
  if (classifications.includes('Layout Shift')) {
    return { recommendation: 'flag', reason: 'Layout shift detected — element position or size changed significantly.' };
  }
  if (diffPct > 15) {
    return { recommendation: 'flag', reason: `Large diff (${diffPct.toFixed(1)}%) — exceeds automatic review threshold.` };
  }
  if (
    classifications.length > 0 &&
    classifications.every(c => c === 'Dynamic Data' || c === 'Style Drift')
  ) {
    if (classifications.includes('Dynamic Data')) {
      return { recommendation: 'approve', reason: 'Change overlaps known dynamic/ignore regions — likely expected noise.' };
    }
    if (diffPct < 5) {
      return { recommendation: 'approve', reason: `Only minor style drift detected (${diffPct.toFixed(1)}% diff) — no structural changes.` };
    }
  }
  if (classifications.length === 0) {
    return { recommendation: 'review', reason: 'No specific change type detected — review recommended.' };
  }
  return {
    recommendation: 'review',
    reason: `Content change detected in ${classifications.length} region type(s) — human review recommended.`,
  };
}

// ── Pixel analysis helpers ─────────────────────────────────────────────────────

interface DiffStats {
  redPixelRows: number[];       // row indices that contain ≥1 red pixel
  contiguousRegions: Array<{ top: number; bottom: number; left: number; right: number }>;
  totalRedPixels: number;
  width: number;
  height: number;
}

function analyseDiffPng(diffPath: string): DiffStats | null {
  if (!fs.existsSync(diffPath)) return null;
  let png: PNG;
  try {
    png = PNG.sync.read(fs.readFileSync(diffPath));
  } catch {
    return null;
  }
  const { width, height, data } = png;
  const redRows = new Set<number>();
  // per-pixel: diff image uses [255,0,0,*] for changed pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] > 200 && data[i + 1] < 50 && data[i + 2] < 50) {
        redRows.add(y);
      }
    }
  }
  const redPixelRows = Array.from(redRows).sort((a, b) => a - b);

  // Group into contiguous bounding boxes (gap tolerance: 8px)
  const regions: DiffStats['contiguousRegions'] = [];
  if (redPixelRows.length > 0) {
    let start = redPixelRows[0];
    let prev = redPixelRows[0];
    for (let i = 1; i <= redPixelRows.length; i++) {
      const row = redPixelRows[i];
      if (row === undefined || row - prev > 8) {
        // compute left/right bounds for this band
        let left = width; let right = 0;
        for (let y = start; y <= prev; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            if (data[idx] > 200 && data[idx + 1] < 50 && data[idx + 2] < 50) {
              if (x < left) left = x;
              if (x > right) right = x;
            }
          }
        }
        regions.push({ top: start, bottom: prev, left, right });
        start = row; prev = row;
      } else {
        prev = row;
      }
    }
  }

  return { redPixelRows, contiguousRegions: regions, totalRedPixels: redPixelRows.length, width, height };
}

// ── Rule-based classifier ─────────────────────────────────────────────────────

export async function classifyDiff(
  diffPath: string | null,
  ctx: RunContext,
): Promise<ClassificationResult> {
  const classifications: ChangeClassification[] = [];

  // Dimension Change — no image analysis needed
  const dimensionMismatch =
    ctx.baselineWidth !== ctx.actualWidth || ctx.baselineHeight !== ctx.actualHeight;
  if (dimensionMismatch) classifications.push('Dimension Change');

  const stats = diffPath ? analyseDiffPng(diffPath) : null;

  if (stats) {
    const imageArea = stats.width * stats.height;

    // Content Change: text-height bands (8–24px tall)
    const textBands = stats.contiguousRegions.filter(r => {
      const h = r.bottom - r.top + 1;
      return h >= 8 && h <= 24;
    });
    if (textBands.length > 0) classifications.push('Content Change');

    // Layout Shift: single region covering > 20% of image
    const largeRegion = stats.contiguousRegions.find(r => {
      const area = (r.bottom - r.top + 1) * (r.right - r.left + 1);
      return area / imageArea > 0.20;
    });
    if (largeRegion) classifications.push('Layout Shift');

    // Style Drift: diffuse, no region > 5% of area, diffPct < 8%
    const hasLargeRegion = stats.contiguousRegions.some(r => {
      const area = (r.bottom - r.top + 1) * (r.right - r.left + 1);
      return area / imageArea > 0.05;
    });
    if (!hasLargeRegion && ctx.diffPct < 8 && stats.totalRedPixels > 0) {
      classifications.push('Style Drift');
    }

    // Element Added / Removed: region where one side is near-uniform background
    // (heuristic: very low variance in that area of the image — we approximate
    //  by checking if the region is tall enough to be a block element, ≥ 32px)
    for (const r of stats.contiguousRegions) {
      const h = r.bottom - r.top + 1;
      if (h >= 32 && !classifications.includes('Layout Shift')) {
        // We can't easily distinguish added vs removed without loading both images here.
        // Use diffPct heuristic: mostly new pixels → added; mostly missing → removed.
        if (ctx.diffPct > 2) {
          if (!classifications.includes('Element Added') && !classifications.includes('Element Removed')) {
            classifications.push(ctx.diffPct > 8 ? 'Element Added' : 'Element Removed');
          }
        }
      }
    }

    // Dynamic Data: diff overlaps with dynamic/temporal ignore regions
    const dynamicCategories = ['dynamic-data', 'temporal'];
    const hasDynamic = ctx.ignoreRegions.some(r =>
      dynamicCategories.includes(r.category || ''),
    );
    if (hasDynamic) classifications.push('Dynamic Data');
  }

  const { recommendation, reason } = buildRecommendation(classifications, ctx.diffPct);

  return {
    classifications,
    regions: stats?.contiguousRegions.length ?? 0,
    dimensionMismatch,
    recommendation,
    recommendationReason: reason,
    stage: 'rule-based',
  };
}
```

- [ ] **Step 1.4: Run tests — verify they pass**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run test:unit -- --reporter=verbose src/utils/__tests__/vrtAiAnalyser.test.ts
```

Expected: all tests `PASS`

- [ ] **Step 1.5: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && git add src/utils/vrtAiAnalyser.ts src/utils/__tests__/vrtAiAnalyser.test.ts && git commit -m "feat(vrt): add vrtAiAnalyser — rule-based diff classifier"
```

---

## Task 2: Add `nlRawPrompt` to nlProvider + AI Enhancement in vrtAiAnalyser

**Files:**
- Modify: `src/utils/nlProvider.ts` (add one export at the bottom)
- Modify: `src/utils/vrtAiAnalyser.ts` (add `enhanceWithAi` function)
- Modify: `src/utils/__tests__/vrtAiAnalyser.test.ts` (add Stage 2 tests)

- [ ] **Step 2.1: Add failing tests for enhanceWithAi**

Append to `src/utils/__tests__/vrtAiAnalyser.test.ts`:

```typescript
import { enhanceWithAi } from '../vrtAiAnalyser';
import type { ClassificationResult } from '../vrtAiAnalyser';

const baseClassification: ClassificationResult = {
  classifications: ['Content Change'],
  regions: 1,
  dimensionMismatch: false,
  recommendation: 'review',
  recommendationReason: 'Content change detected',
  stage: 'rule-based',
};

describe('enhanceWithAi', () => {
  it('throws when no AI provider configured', async () => {
    // nlStore returns default config with no apiKey
    await expect(enhanceWithAi(baseClassification, baseCtx)).rejects.toThrow(
      'No AI provider configured',
    );
  });
});
```

- [ ] **Step 2.2: Run — verify new test fails**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run test:unit -- --reporter=verbose src/utils/__tests__/vrtAiAnalyser.test.ts 2>&1 | tail -20
```

Expected: `FAIL` — `enhanceWithAi is not a function`

- [ ] **Step 2.3: Add `nlRawPrompt` export to `src/utils/nlProvider.ts`**

Append at the very end of `src/utils/nlProvider.ts` (after the `NL_PROVIDERS` array):

```typescript
/**
 * Raw-prompt variant — sends an arbitrary prompt string to the configured provider
 * and returns the response text. Used by vrtAiAnalyser for VRT AI enhancement.
 */
export async function nlRawPrompt(
  cfg: NlProviderConfig,
  prompt: string,
): Promise<string> {
  switch (cfg.provider) {
    case 'anthropic': {
      const result = await callAnthropic(cfg, prompt);
      return result.text ?? '';
    }
    case 'openai':
      return (await callOpenAICompat(
        { ...cfg, baseUrl: 'https://api.openai.com', model: cfg.model || 'gpt-4o-mini' },
        prompt, 'openai',
      )).text ?? '';
    case 'groq':
      return (await callOpenAICompat(
        { ...cfg, baseUrl: 'https://api.groq.com/openai', model: cfg.model || 'llama-3.1-8b-instant' },
        prompt, 'groq',
      )).text ?? '';
    case 'ollama':
      return (await callOllama(cfg, prompt)).text ?? '';
    case 'gemini' as any:
      return (await callGemini(cfg, prompt)).text ?? '';
    case 'compatible':
      if (!cfg.baseUrl) throw new Error('baseUrl is required for compatible provider');
      return (await callOpenAICompat(cfg, prompt, 'compatible')).text ?? '';
    default:
      throw new Error(`Unknown NL provider: ${(cfg as any).provider}`);
  }
}
```

- [ ] **Step 2.4: Check `NlSuggestion.text` field name**

```bash
grep -n "text\|keywords\|NlSuggestion" "e:/AI Agent/qa-agent-platform-dev/src/utils/nlProvider.ts" | head -10
```

If the field is NOT `text` (e.g. it's `keywords` or `raw`), update the `result.text` references in step 2.3 to the correct field name.

- [ ] **Step 2.5: Add `enhanceWithAi` to `src/utils/vrtAiAnalyser.ts`**

Add these imports at the top of `src/utils/vrtAiAnalyser.ts` (after existing imports):

```typescript
import { nlRawPrompt } from './nlProvider';
import { loadNlConfig } from './nlStore';
```

Then append `enhanceWithAi` at the bottom of `src/utils/vrtAiAnalyser.ts`:

```typescript
// ── AI Enhancement (Stage 2) ──────────────────────────────────────────────────

function buildVrtPrompt(result: ClassificationResult, ctx: RunContext): string {
  return `You are a visual regression testing assistant. Analyse this VRT diff result and provide a concise assessment.

Test: ${ctx.testName}
Element: ${ctx.locatorName}
Diff: ${ctx.diffPct.toFixed(2)}% (${ctx.diffPixels} of ${ctx.totalPixels} pixels changed)
Dimensions: baseline ${ctx.baselineWidth}×${ctx.baselineHeight}, actual ${ctx.actualWidth}×${ctx.actualHeight}
Detected change types: ${result.classifications.length > 0 ? result.classifications.join(', ') : 'None detected'}
Regions affected: ${result.regions}

Provide:
1. A 2-3 sentence plain-English explanation of what likely changed and whether it looks like a regression or an expected change.
2. A suggested action: "approve", "review", or "flag"
3. A confidence score 0-100

Respond ONLY in JSON (no markdown, no extra text):
{ "narrative": "...", "suggestedAction": "approve|review|flag", "confidence": 85 }`;
}

export async function enhanceWithAi(
  classificationResult: ClassificationResult,
  ctx: RunContext,
): Promise<AiEnhancedResult> {
  const cfg = loadNlConfig();
  if (!cfg.apiKey && cfg.provider !== 'ollama') {
    throw new Error('No AI provider configured. Set one up in Admin → Settings → AI.');
  }

  const prompt = buildVrtPrompt(classificationResult, ctx);
  const modelLabel = `${cfg.provider}/${cfg.model || 'default'}`;

  let raw: string;
  try {
    raw = await nlRawPrompt(cfg, prompt);
  } catch (e: any) {
    throw new Error(`AI provider error: ${e.message}`);
  }

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
  let parsed: { narrative: string; suggestedAction: Recommendation; confidence: number };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: AI didn't return valid JSON — use a generic response
    parsed = {
      narrative: raw.slice(0, 500),
      suggestedAction: classificationResult.recommendation,
      confidence: 50,
    };
  }

  return {
    ...classificationResult,
    narrative: parsed.narrative ?? '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 50,
    suggestedAction: (['approve', 'review', 'flag'].includes(parsed.suggestedAction)
      ? parsed.suggestedAction
      : classificationResult.recommendation),
    model: modelLabel,
    stage: 'ai-enhanced',
  };
}
```

- [ ] **Step 2.6: Run all vrtAiAnalyser tests**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run test:unit -- --reporter=verbose src/utils/__tests__/vrtAiAnalyser.test.ts
```

Expected: all tests `PASS` (the `enhanceWithAi` test passes because `loadNlConfig()` returns default config with no `apiKey` → throws "No AI provider configured")

- [ ] **Step 2.7: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && git add src/utils/vrtAiAnalyser.ts src/utils/nlProvider.ts src/utils/__tests__/vrtAiAnalyser.test.ts && git commit -m "feat(vrt): add AI enhancement stage 2 — nlRawPrompt + enhanceWithAi"
```

---

## Task 3: Backend Route — POST /api/visual-baselines/:id/ai-analysis

**Files:**
- Modify: `src/ui/routes/visual.routes.ts`

- [ ] **Step 3.1: Read the top of visual.routes.ts to find imports and baseline path helpers**

```bash
sed -n '1,60p' "e:/AI Agent/qa-agent-platform-dev/src/ui/routes/visual.routes.ts"
```

Note: how baseline entries are loaded (likely via a store function or `loadIndex()`), and the path helper for diff PNG (likely `getDiffPath(baselineId)` or similar).

- [ ] **Step 3.2: Read how diff file paths are resolved in visual.routes.ts**

```bash
grep -n "diffPath\|diff\.png\|getDiff\|baseline.*path\|BASELINES_DIR\|DATA_DIR" "e:/AI Agent/qa-agent-platform-dev/src/ui/routes/visual.routes.ts" | head -20
```

Note the variable name for the baselines data dir (used to construct diff path).

- [ ] **Step 3.3: Add the ai-analysis route to `src/ui/routes/visual.routes.ts`**

Add this import near the top of `visual.routes.ts` (after existing imports):

```typescript
import { classifyDiff, enhanceWithAi } from '../utils/vrtAiAnalyser';
import type { RunContext } from '../utils/vrtAiAnalyser';
```

Then add this route inside the `registerVisualRoutes` function (after the last existing route, before any closing brace):

```typescript
// ── AI Analysis ───────────────────────────────────────────────────────────────
router.post('/:id/ai-analysis', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { enhance = false, runContext } = req.body as {
      enhance?: boolean;
      runContext: RunContext;
    };

    if (!runContext) {
      return res.status(400).json({ error: 'runContext is required' });
    }

    // Load baseline entry to get diff image path
    const index: any[] = loadIndex();  // use the same loadIndex() already used in this file
    const entry = index.find((e: any) => e.id === id);
    if (!entry) return res.status(404).json({ error: 'Baseline not found' });

    // Construct diff path using same pattern as existing routes in this file
    const diffPath = entry.diffPath ?? null;  // adjust field name if different after Step 3.2

    // Merge ignore regions from baseline entry into runContext
    const ctx: RunContext = {
      ...runContext,
      ignoreRegions: (entry.ignoreRegions ?? []).map((r: any) => ({
        x: r.x, y: r.y, width: r.width, height: r.height, category: r.category,
      })),
    };

    const classification = await classifyDiff(diffPath, ctx);

    if (!enhance) {
      return res.json(classification);
    }

    const enhanced = await enhanceWithAi(classification, ctx);
    return res.json(enhanced);
  } catch (err: any) {
    const isNoProvider = err.message?.includes('No AI provider configured');
    return res.status(isNoProvider ? 422 : 500).json({ error: err.message });
  }
});
```

> **NOTE:** After reading the file in Step 3.1–3.2, adjust:
> - `loadIndex()` → use the actual function name already called in this file
> - `entry.diffPath` → use the actual field/path construction already used in this file for diff images

- [ ] **Step 3.4: Build TypeScript to verify no compile errors**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build 2>&1 | tail -20
```

Expected: `0 errors`

- [ ] **Step 3.5: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && git add src/ui/routes/visual.routes.ts && git commit -m "feat(vrt): add POST /api/visual-baselines/:id/ai-analysis route"
```

---

## Task 4: CSS — Chip, AI Panel, Heatmap Overlay Styles

**Files:**
- Modify: `src/ui/public/styles_addon.css`

- [ ] **Step 4.1: Append VRT AI styles to `src/ui/public/styles_addon.css`**

Append at the very end of `src/ui/public/styles_addon.css`:

```css
/* ── VRT Heatmap + AI Analysis ──────────────────────────────────────────────── */

/* Heatmap canvas overlay — sits over actual screenshot */
.vr-heat-canvas {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  pointer-events: none; z-index: 2;
  opacity: 0; transition: opacity .2s;
}
.vr-heat-canvas.vr-heat-on { opacity: 1; }

/* AI Analysis footer button */
.vrt-ai-btn {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 6px; padding: 4px 12px;
  border: 1px solid rgba(99,102,241,.4);
  border-radius: 6px; background: rgba(99,102,241,.1);
  color: #a5b4fc; font-size: 11px; font-weight: 700;
  cursor: pointer; transition: background .15s, border-color .15s;
}
.vrt-ai-btn:hover { background: rgba(99,102,241,.2); border-color: rgba(99,102,241,.65); }
.vrt-ai-btn:disabled { opacity: .5; cursor: not-allowed; }

/* AI Analysis panel (slides down) */
.vrt-ai-panel {
  margin-top: 6px; padding: 10px 12px;
  background: #0d1219; border: 1px solid #1e2536;
  border-radius: 8px; font-size: 11.5px;
  overflow: hidden; max-height: 0;
  transition: max-height .25s ease, padding .25s ease;
}
.vrt-ai-panel.vrt-ai-open { max-height: 400px; padding: 10px 12px; }

/* Classification chips */
.vrt-chip {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 12px;
  font-size: 10.5px; font-weight: 700;
  margin: 2px 3px 2px 0; border: 1px solid transparent;
}
.vrt-chip-content  { background: rgba(59,130,246,.15);  color: #93c5fd; border-color: rgba(59,130,246,.3); }
.vrt-chip-layout   { background: rgba(239,68,68,.15);   color: #f87171; border-color: rgba(239,68,68,.3); }
.vrt-chip-style    { background: rgba(234,179,8,.12);   color: #fbbf24; border-color: rgba(234,179,8,.25); }
.vrt-chip-added    { background: rgba(34,197,94,.12);   color: #4ade80; border-color: rgba(34,197,94,.25); }
.vrt-chip-removed  { background: rgba(249,115,22,.13);  color: #fb923c; border-color: rgba(249,115,22,.28); }
.vrt-chip-dynamic  { background: rgba(156,163,175,.1);  color: #9ca3af; border-color: rgba(156,163,175,.2); }
.vrt-chip-dimension{ background: rgba(168,85,247,.12);  color: #c084fc; border-color: rgba(168,85,247,.25); }

/* Recommendation badge */
.vrt-rec {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 5px;
  font-size: 11px; font-weight: 700; margin-top: 6px;
  border: 1px solid transparent;
}
.vrt-rec-approve { background: rgba(34,197,94,.12);  color: #4ade80; border-color: rgba(34,197,94,.3); }
.vrt-rec-review  { background: rgba(234,179,8,.12);  color: #fbbf24; border-color: rgba(234,179,8,.3); }
.vrt-rec-flag    { background: rgba(239,68,68,.12);  color: #f87171; border-color: rgba(239,68,68,.3); }

/* Recommendation reason */
.vrt-rec-reason { color: #64748b; font-size: 10.5px; margin-top: 4px; }

/* AI narrative block */
.vrt-ai-narrative {
  margin-top: 8px; padding: 8px 10px;
  background: rgba(99,102,241,.07); border: 1px solid rgba(99,102,241,.2);
  border-radius: 6px; color: #cbd5e1; line-height: 1.55;
}
.vrt-ai-meta { font-size: 10px; color: #475569; margin-top: 4px; }

/* Enhance with AI button (inside panel) */
.vrt-enhance-btn {
  margin-top: 8px; padding: 3px 10px;
  border: 1px solid rgba(99,102,241,.35);
  border-radius: 5px; background: transparent;
  color: #818cf8; font-size: 10.5px; font-weight: 600;
  cursor: pointer; transition: background .15s;
}
.vrt-enhance-btn:hover { background: rgba(99,102,241,.12); }
.vrt-enhance-btn:disabled { opacity: .45; cursor: not-allowed; }

/* Loading spinner */
.vrt-ai-spin {
  display: inline-block; width: 12px; height: 12px;
  border: 2px solid rgba(165,180,252,.2);
  border-top-color: #a5b4fc; border-radius: 50%;
  animation: vrt-spin .6s linear infinite; vertical-align: middle; margin-right: 4px;
}
@keyframes vrt-spin { to { transform: rotate(360deg); } }

/* AI error message */
.vrt-ai-error { color: #f87171; font-size: 10.5px; margin-top: 6px; }
.vrt-ai-error a { color: #93c5fd; }
```

- [ ] **Step 4.2: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && git add src/ui/public/styles_addon.css && git commit -m "feat(vrt): add Heatmap + AI Analysis CSS styles"
```

---

## Task 5: execution-report.html — Heatmap Mode + AI Panel

**Files:**
- Modify: `src/ui/public/execution-report.html`

- [ ] **Step 5.1: Read the existing mode bar and diff viewer block**

```bash
sed -n '1148,1180p' "e:/AI Agent/qa-agent-platform-dev/src/ui/public/execution-report.html"
```

Confirm line numbers of: mode buttons (`vr-mb`), the `.vr-sl` slider div, and the 4px heatmap strip div.

- [ ] **Step 5.2: Add `🌡 Heatmap` button to mode bar and heatmap canvas to slider**

Find this block (around line 1155–1158):
```html
                    <button class="vr-mb vr-mb-on" data-mode="slider">⟺ Slider</button>
                    <button class="vr-mb" data-mode="onion">👁 Onion</button>
                    <button class="vr-mb" data-mode="blink">💡 Blink</button>
```

Replace with:
```html
                    <button class="vr-mb vr-mb-on" data-mode="slider">⟺ Slider</button>
                    <button class="vr-mb" data-mode="onion">👁 Onion</button>
                    <button class="vr-mb" data-mode="blink">💡 Blink</button>
                    ${hasDiff ? `<button class="vr-mb" data-mode="heatmap">🌡 Heatmap</button>` : ''}
```

Find the `.vr-sl` div block (around line 1160–1165):
```html
                    <div class="vr-sl">
                      <img class="vr-sl-a" src="${afterSrc}"  alt="Actual"   loading="lazy" onerror="this.style.opacity='.2'">
                      <img class="vr-sl-b" src="${beforeSrc}" alt="Baseline" loading="lazy" onerror="this.style.opacity='.2'">
                      <div class="vr-sl-d"></div>
                      <div class="vr-sl-k">⟺</div>
                      <div class="vr-sl-t"></div>
```

Replace with:
```html
                    <div class="vr-sl">
                      <img class="vr-sl-a" src="${afterSrc}"  alt="Actual"   loading="lazy" onerror="this.style.opacity='.2'">
                      <img class="vr-sl-b" src="${beforeSrc}" alt="Baseline" loading="lazy" onerror="this.style.opacity='.2'">
                      <canvas class="vr-heat-canvas"></canvas>
                      <div class="vr-sl-d"></div>
                      <div class="vr-sl-k">⟺</div>
                      <div class="vr-sl-t"></div>
```

- [ ] **Step 5.3: Add `🤖 AI Analysis` footer button**

Find the line with the 4px heatmap strip (around line 1171):
```javascript
${hasDiff ? `<div style="height:4px;background:#0a0a0a;...
```

Add the AI button immediately **after** that strip div closes. Find the closing of the heatmap strip container and add:
```javascript
${hasDiff ? `<div style="padding:4px 8px 6px;background:#0d1219">
  <button class="vrt-ai-btn" onclick="vrAiAnalyse(this)"
    data-baseline-id="${vr.baselineId || ''}"
    data-diff-pct="${vr.diffPct || 0}"
    data-diff-pixels="${vr.diffPixels || 0}"
    data-total-pixels="${vr.totalPixels || 0}"
    data-baseline-w="${vr.baselineWidth || 0}"
    data-baseline-h="${vr.baselineHeight || 0}"
    data-actual-w="${vr.actualWidth || 0}"
    data-actual-h="${vr.actualHeight || 0}"
    data-test-name="${(vr.testName||'').replace(/"/g,'&quot;')}"
    data-locator="${(vr.locatorName||'').replace(/"/g,'&quot;')}">🤖 AI Analysis</button>
  <div class="vrt-ai-panel"></div>
</div>` : ''}
```

- [ ] **Step 5.4: Add heatmap mode JS and AI analysis JS to execution-report.html**

Find the existing `vrSliderInit` function (around line 1698). Add the following new functions **before** `vrSliderInit`:

```javascript
// ── Heatmap overlay ──────────────────────────────────────────────────────────
function vrDrawHeatOverlay(canvas, diffImgUrl) {
  if (!diffImgUrl) return;
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function() {
    var w = img.naturalWidth, h = img.naturalHeight;
    canvas.width = w; canvas.height = h;
    var offCtx = document.createElement('canvas');
    offCtx.width = w; offCtx.height = h;
    var ox = offCtx.getContext('2d');
    ox.drawImage(img, 0, 0);
    var data = ox.getImageData(0, 0, w, h).data;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    // per-pixel: red pixels [r>200,g<50,b<50] → intensity
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (data[i] > 200 && data[i+1] < 50 && data[i+2] < 50) {
          // intensity = r channel normalised 200-255 → 0-1
          var v = (data[i] - 200) / 55;
          // yellow (low) → orange (mid) → red (high)
          var r = 239, g = Math.round(179 - v * 179), b = 0;
          ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (0.45 + v * 0.45).toFixed(2) + ')';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    canvas.classList.add('vr-heat-on');
  };
  img.src = diffImgUrl;
}

// ── AI Analysis ──────────────────────────────────────────────────────────────
var _vrAiCache = {};

function vrAiChipClass(label) {
  var map = {
    'Content Change': 'vrt-chip-content',
    'Layout Shift':   'vrt-chip-layout',
    'Style Drift':    'vrt-chip-style',
    'Element Added':  'vrt-chip-added',
    'Element Removed':'vrt-chip-removed',
    'Dynamic Data':   'vrt-chip-dynamic',
    'Dimension Change':'vrt-chip-dimension',
  };
  return map[label] || 'vrt-chip-content';
}

function vrAiRenderPanel(panel, result) {
  var chips = (result.classifications || []).map(function(c) {
    return '<span class="vrt-chip ' + vrAiChipClass(c) + '">' + c + '</span>';
  }).join('');
  var recClass = 'vrt-rec-' + (result.recommendation || 'review');
  var recIcon  = result.recommendation === 'approve' ? '✓' : result.recommendation === 'flag' ? '✗' : '⚠';
  var recLabel = result.recommendation ? result.recommendation.charAt(0).toUpperCase() + result.recommendation.slice(1) : 'Review';
  var narrative = result.narrative
    ? '<div class="vrt-ai-narrative">' + result.narrative +
      '<div class="vrt-ai-meta">Model: ' + (result.model || '—') + ' · Confidence: ' + (result.confidence || '—') + '%</div></div>'
    : '<button class="vrt-enhance-btn" onclick="vrAiEnhance(this)">✨ Enhance with AI</button>';

  panel.innerHTML =
    '<div>' + (chips || '<span style="color:#475569;font-size:11px">No specific change type detected</span>') + '</div>' +
    '<div class="vrt-rec ' + recClass + '">' + recIcon + ' ' + recLabel + '</div>' +
    '<div class="vrt-rec-reason">' + (result.recommendationReason || '') + '</div>' +
    '<hr style="border:none;border-top:1px solid #1e2536;margin:8px 0">' +
    narrative;
  panel.classList.add('vrt-ai-open');
  // store result for enhance step
  panel._vrAiResult = result;
}

function vrAiAnalyse(btn) {
  var wrap   = btn.closest('[data-baseline-id]') || btn.parentElement;
  var panel  = btn.parentElement.querySelector('.vrt-ai-panel');
  if (!panel) return;

  // Use cached result if available
  var bid = btn.dataset.baselineId;
  if (bid && _vrAiCache[bid]) { vrAiRenderPanel(panel, _vrAiCache[bid]); return; }

  btn.disabled = true;
  panel.innerHTML = '<span class="vrt-ai-spin"></span> Analysing…';
  panel.classList.add('vrt-ai-open');

  var ctx = {
    testName:      btn.dataset.testName    || '',
    locatorName:   btn.dataset.locator     || '',
    diffPct:       parseFloat(btn.dataset.diffPct)     || 0,
    diffPixels:    parseInt(btn.dataset.diffPixels)    || 0,
    totalPixels:   parseInt(btn.dataset.totalPixels)   || 0,
    baselineWidth: parseInt(btn.dataset.baselineW)     || 0,
    baselineHeight:parseInt(btn.dataset.baselineH)     || 0,
    actualWidth:   parseInt(btn.dataset.actualW)       || 0,
    actualHeight:  parseInt(btn.dataset.actualH)       || 0,
  };

  fetch('/api/visual-baselines/' + bid + '/ai-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enhance: false, runContext: ctx }),
  })
  .then(function(r) { return r.json(); })
  .then(function(result) {
    if (bid) _vrAiCache[bid] = result;
    vrAiRenderPanel(panel, result);
    btn.disabled = false;
  })
  .catch(function(err) {
    panel.innerHTML = '<div class="vrt-ai-error">Analysis failed: ' + err.message + '</div>';
    btn.disabled = false;
  });
}

function vrAiEnhance(enhanceBtn) {
  var panel  = enhanceBtn.closest('.vrt-ai-panel');
  if (!panel || !panel._vrAiResult) return;
  enhanceBtn.disabled = true;
  enhanceBtn.innerHTML = '<span class="vrt-ai-spin"></span> Enhancing…';

  var bid = panel._vrAiResult.baselineId ||
    (panel.previousElementSibling && panel.previousElementSibling.dataset && panel.previousElementSibling.dataset.baselineId) || '';
  var parentBtn = panel.parentElement && panel.parentElement.querySelector('.vrt-ai-btn');
  var ctx = panel._vrAiResult._ctx || {};

  fetch('/api/visual-baselines/' + bid + '/ai-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enhance: true, runContext: ctx }),
  })
  .then(function(r) {
    if (r.status === 422) return r.json().then(function(e) { throw new Error(e.error); });
    return r.json();
  })
  .then(function(result) {
    if (bid) _vrAiCache[bid] = result;
    vrAiRenderPanel(panel, result);
  })
  .catch(function(err) {
    enhanceBtn.disabled = false;
    enhanceBtn.innerHTML = '✨ Enhance with AI';
    var errDiv = panel.querySelector('.vrt-ai-error') || document.createElement('div');
    errDiv.className = 'vrt-ai-error';
    errDiv.innerHTML = err.message.includes('No AI provider')
      ? 'No AI provider configured. <a href="#" onclick="showTab(\'admin\');return false">Set up in Admin → Settings → AI</a>'
      : err.message;
    if (!panel.querySelector('.vrt-ai-error')) panel.appendChild(errDiv);
  });
}
```

- [ ] **Step 5.5: Wire heatmap mode into the existing `setMode` handler**

Find the existing mode-switching logic in execution-report.html (around line 1698–1730, inside `vrSliderInit`). The existing code toggles visibility on mode change. Find the section that handles `data-mode` switching and add the heatmap case.

Find code similar to:
```javascript
mBtns.forEach(function(b) {
  b.addEventListener('click', function() {
    // existing mode switch code
  });
});
```

Inside that click handler, find where modes are applied (e.g. a `switch` or `if` chain). Add after the last existing mode case:

```javascript
var heatCanvas = el.querySelector('.vr-heat-canvas');
if (mode === 'heatmap') {
  // show actual full-width, hide baseline clip and divider
  slBase.style.clipPath = 'inset(0 100% 0 0)';
  slDiv.style.opacity   = '0';
  slKnob.style.opacity  = '0';
  var diffUrl = viewer.dataset.diff || '';
  if (heatCanvas && diffUrl) vrDrawHeatOverlay(heatCanvas, diffUrl);
} else {
  // clear heatmap when switching away
  if (heatCanvas) {
    heatCanvas.classList.remove('vr-heat-on');
    var hctx = heatCanvas.getContext('2d');
    if (hctx) hctx.clearRect(0, 0, heatCanvas.width, heatCanvas.height);
  }
}
```

- [ ] **Step 5.6: Build and verify no errors**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build 2>&1 | tail -10
```

Expected: `0 errors`

- [ ] **Step 5.7: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && git add src/ui/public/execution-report.html && git commit -m "feat(vrt): add Heatmap mode + AI Analysis panel to execution-report"
```

---

## Task 6: 20-visual-regression.js — Same Heatmap + AI in Diff Popup

**Files:**
- Modify: `src/ui/public/js/20-visual-regression.js`

- [ ] **Step 6.1: Read the vrViewDiff modal structure**

```bash
sed -n '550,650p' "e:/AI Agent/qa-agent-platform-dev/src/ui/public/js/20-visual-regression.js"
```

Confirm: location of `.vr-mb-bar` mode buttons, `.vr-sl` slider div, and any existing footer area.

- [ ] **Step 6.2: Add `🌡 Heatmap` button to vrViewDiff mode bar**

Find (around line 618–621):
```javascript
        <button class="vr-mb on" data-mode="slider">&#8660; Slider</button>
        <button class="vr-mb" data-mode="onion">&#128065; Onion</button>
        <button class="vr-mb" data-mode="blink">&#128161; Blink</button>
```

Replace with:
```javascript
        <button class="vr-mb on" data-mode="slider">&#8660; Slider</button>
        <button class="vr-mb" data-mode="onion">&#128065; Onion</button>
        <button class="vr-mb" data-mode="blink">&#128161; Blink</button>
        ${diffUrl ? `<button class="vr-mb" data-mode="heatmap">🌡 Heatmap</button>` : ''}
```

- [ ] **Step 6.3: Add heatmap canvas to the `.vr-sl` div in vrViewDiff**

Find the `.vr-sl` construction inside `vrViewDiff` (the popup's slider div). Add `<canvas class="vr-heat-canvas"></canvas>` as the first child after `<div class="vr-sl">`, matching what was done in Task 5.2.

- [ ] **Step 6.4: Add `🤖 AI Analysis` button below the slider in vrViewDiff**

Find where the diff popup footer/bottom content is rendered (after the `.vr-sl` wrapper). Add:

```javascript
${diffUrl ? `<div style="padding:6px 10px 8px;background:#0d1219;border-top:1px solid #1e1e1e">
  <button class="vrt-ai-btn"
    onclick="vrAiAnalyse(this)"
    data-baseline-id="${escHtml(b.id)}"
    data-diff-pct="${b.diffPct || 0}"
    data-diff-pixels="${b.diffPixels || 0}"
    data-total-pixels="${b.totalPixels || 0}"
    data-baseline-w="${b.width || 0}"
    data-baseline-h="${b.height || 0}"
    data-actual-w="${b.width || 0}"
    data-actual-h="${b.height || 0}"
    data-test-name="${escHtml(b.testName || '')}"
    data-locator="${escHtml(b.locatorName || '')}">🤖 AI Analysis</button>
  <div class="vrt-ai-panel"></div>
</div>` : ''}
```

- [ ] **Step 6.5: Wire heatmap mode into the diff popup mode-switch handler**

Find the mode button click handler inside `vrViewDiff` (around line 681, `mBtns` event listeners). In the same pattern as Task 5.5, add the heatmap case:

```javascript
var heatCanvas = el.querySelector('.vr-heat-canvas');
if (mode === 'heatmap') {
  slBase.style.clipPath = 'inset(0 100% 0 0)';
  slDiv.style.opacity   = '0';
  slKnob.style.opacity  = '0';
  if (heatCanvas && diffUrl) vrDrawHeatOverlay(heatCanvas, diffUrl);
} else {
  if (heatCanvas) {
    heatCanvas.classList.remove('vr-heat-on');
    var hctx = heatCanvas.getContext('2d');
    if (hctx) hctx.clearRect(0, 0, heatCanvas.width, heatCanvas.height);
  }
}
```

Note: `vrDrawHeatOverlay` and `vrAiAnalyse` are defined in execution-report.html. For the baselines module (which runs inside index.html), these functions need to be available globally. Add them to `20-visual-regression.js` as well — copy the exact same function bodies from Task 5.4 into `20-visual-regression.js` (place them near the top of the file, before `vrViewDiff`):

```javascript
// ── Shared Heatmap + AI helpers (also used in execution-report.html) ──────────
// NOTE: keep in sync with execution-report.html versions
function vrDrawHeatOverlay(canvas, diffImgUrl) { /* exact same body as Task 5.4 */ }
var _vrAiCache = window._vrAiCache || {};
function vrAiChipClass(label) { /* exact same body as Task 5.4 */ }
function vrAiRenderPanel(panel, result) { /* exact same body as Task 5.4 */ }
function vrAiAnalyse(btn) { /* exact same body as Task 5.4 */ }
function vrAiEnhance(enhanceBtn) { /* exact same body as Task 5.4 */ }
```

- [ ] **Step 6.6: Run frontend build**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build:js 2>&1 | tail -10
```

Expected: success, `modules.js` regenerated

- [ ] **Step 6.7: Build TypeScript**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build 2>&1 | tail -10
```

Expected: `0 errors`

- [ ] **Step 6.8: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && git add src/ui/public/js/20-visual-regression.js src/ui/public/modules.js && git commit -m "feat(vrt): add Heatmap mode + AI Analysis panel to Visual Baselines diff popup"
```

---

## Task 7: Smoke Test + Promote to Prod

- [ ] **Step 7.1: Run full unit test suite**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run test:unit 2>&1 | tail -20
```

Expected: all tests pass, no regressions

- [ ] **Step 7.2: Verify dev server is up**

```bash
curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"
```

Expected: `200` or `302`. If not, tell the user: *"Dev server needs restart — use Admin → Settings → Reset Server button."* Wait for confirmation before continuing.

- [ ] **Step 7.3: Verify AI Analysis endpoint responds**

```bash
curl -s -X POST http://localhost:3003/api/visual-baselines/nonexistent/ai-analysis \
  -H "Content-Type: application/json" \
  -H "Cookie: $(grep -o 'connect.sid=[^;]*' /dev/null 2>/dev/null || echo '')" \
  -d '{"enhance":false,"runContext":{"testName":"t","locatorName":"l","diffPct":5,"diffPixels":100,"totalPixels":1000,"baselineWidth":1280,"baselineHeight":720,"actualWidth":1280,"actualHeight":720}}' \
  -w "\nHTTP %{http_code}\n"
```

Expected: `HTTP 401` (auth required — confirms route is registered) or `HTTP 404` (baseline not found — also correct)

- [ ] **Step 7.4: Promote to prod**

```bash
cd "e:/AI Agent/qa-agent-platform" && echo "YES\nyes" | node scripts/promote.js 2>&1
```

- [ ] **Step 7.5: Push to GitHub**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && git push origin master
```

---

## UI Testing Checklist (for user after Task 7)

Test in both **Execution Report** (run a suite with a VRT checkpoint) and **Visual Baselines page** (📷 Visual Baselines tab):

### Heatmap Mode
1. Open any test run with a ❌ diff checkpoint → click **🌡 Heatmap** in mode bar
2. Verify: actual screenshot shown full-width with thermal colour overlay (yellow/orange/red on changed regions)
3. Verify: slider divider and knob are hidden
4. Click **⟺ Slider** → verify heatmap disappears, slider returns to normal
5. Repeat on Visual Baselines → View diff popup → click **🌡 Heatmap**

### AI Analysis — Stage 1 (Rule-Based)
6. On a diff checkpoint click **🤖 AI Analysis**
7. Verify: panel slides down with coloured classification chips + Approve/Review/Flag badge + reason text
8. Close panel and re-click → verify instant cached result (no spinner)
9. Repeat on Visual Baselines diff popup

### AI Analysis — Stage 2 (LLM)
10. Ensure AI provider is set in **Admin → Settings → AI**
11. Inside AI Analysis panel click **✨ Enhance with AI**
12. Verify: spinner → narrative text appears with model name + confidence %
13. Verify: Enhance button replaced by result (not re-clickable)
14. Test with no AI configured → verify: `"No AI provider configured"` error with admin link

### Edge Cases
15. Passing checkpoint (0% diff) → verify **🤖 AI Analysis** button does NOT appear
16. Dimension-mismatch checkpoint → verify **Dimension Change** chip appears and recommendation is **Flag**
