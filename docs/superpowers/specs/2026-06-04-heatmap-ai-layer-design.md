# Heatmap + AI Layer — Design Spec
**Date:** 2026-06-04
**Status:** Approved
**Surfaces:** execution-report.html · Visual Baselines diff viewer (20-visual-regression.js)

---

## 1. Problem Statement

The existing VRT diff viewer (Slider / Onion / Blink / Diff modes) shows *where* pixels changed but gives no visual sense of *intensity* (how much changed per region) and no intelligent classification of *why* the change occurred. QA engineers must manually inspect every diff and decide approve/flag with no AI assistance. This feature adds two capabilities without breaking any existing modes or flows.

---

## 2. Feature Summary

### 2A — Heatmap Mode
A new 5th mode button in the existing mode bar. Renders a thermal colour overlay (yellow → orange → red) on the **actual screenshot**, showing pixel-change intensity per region. Powered by the column-density data already computed by the existing `drawHeatCols()` function — no new pixel processing needed.

### 2B — AI Analysis Panel
A `🤖 AI Analysis` footer action button below each diff card (not in the mode bar — it is an action, not a view). Two-stage execution:
- **Stage 1 (instant, always free):** Rule-based classifier analyses diff image pixel data → returns classification chips + approve/review/flag recommendation
- **Stage 2 (on-demand, LLM):** "✨ Enhance with AI" secondary button inside the panel → sends structured context to the Admin-configured AI provider via existing `nlProvider.ts` → returns a plain-English narrative + confidence score

---

## 3. Surfaces — Both Required

All Heatmap Mode and AI Analysis Panel changes apply identically to **both** surfaces:

| Surface | Location | Diff viewer entry point |
|---|---|---|
| Execution Report | `src/ui/public/execution-report.html` | Inline per-checkpoint block (`.vr-slider-wrap`) |
| Visual Baselines | `src/ui/public/js/20-visual-regression.js` | Diff viewer popup (`vrViewDiff()`) |

Shared JS helper functions are extracted so both surfaces call the same code paths. No duplication.

---

## 4. Architecture

### 4.1 Backend — New Endpoint

```
POST /api/visual-baselines/:id/ai-analysis
```

**Auth:** `requireAuth`

**Request body:**
```json
{
  "enhance": false,
  "runContext": {
    "testName": "string",
    "locatorName": "string",
    "diffPct": 3.4,
    "diffPixels": 1200,
    "totalPixels": 35000,
    "baselineWidth": 1280,
    "baselineHeight": 720,
    "actualWidth": 1280,
    "actualHeight": 720
  }
}
```

**Response (Stage 1 — rule-based, always returned):**
```json
{
  "classifications": ["Content Change", "Style Drift"],
  "regions": 2,
  "recommendation": "review",
  "recommendationReason": "Content change detected in 2 regions, diffPct within review threshold",
  "dimensionMismatch": false,
  "stage": "rule-based"
}
```

**Response (Stage 2 — when `enhance: true`):**
```json
{
  "classifications": ["Content Change", "Style Drift"],
  "regions": 2,
  "recommendation": "approve",
  "recommendationReason": "...",
  "dimensionMismatch": false,
  "narrative": "The heading text appears to have changed from the baseline — likely a content update rather than a regression. No structural or layout changes detected. The style drift is minor (spacing). Recommended action: Approve.",
  "confidence": 87,
  "suggestedAction": "approve",
  "model": "anthropic/claude-haiku-4-5",
  "stage": "ai-enhanced"
}
```

**Route file:** `src/ui/routes/visual.routes.ts` (new route added to existing visual router)

**Service file:** `src/utils/vrtAiAnalyser.ts` (new utility — see §4.2)

### 4.2 Backend — vrtAiAnalyser.ts

New utility at `src/utils/vrtAiAnalyser.ts`. Two exported functions:

**`classifyDiff(baselineId, runContext): ClassificationResult`**
- Loads diff PNG via pngjs
- Runs rule-based classification (see §5)
- Returns `ClassificationResult` synchronously (no I/O beyond reading the already-saved diff file)
- Falls back gracefully if diff PNG not found (returns `{ classifications: [], recommendation: 'review' }`)

**`enhanceWithAi(classificationResult, runContext): Promise<AiEnhancedResult>`**
- Loads AI config via `nlStore.loadNlConfig()`
- Builds structured prompt (see §6.2)
- Calls `nlProvider.getSuggestion(config, prompt)`
- Parses response → extracts narrative, confidence, suggestedAction
- Throws if no AI provider configured (caller handles gracefully — UI shows "No AI provider configured. Set one up in Admin → Settings → AI.")

### 4.3 Frontend — Heatmap Mode

**New mode button** added after existing Diff button in mode bar:
```html
<button class="vr-mode-btn" data-mode="heatmap" title="Heatmap overlay">🌡 Heatmap</button>
```

**New canvas layer** `.vr-heat-overlay`:
- `position: absolute; inset: 0; pointer-events: none; z-index: 2`
- Drawn by new JS function `drawHeatOverlay(canvas, diffImgUrl)`
- Reuses column-density data already computed by `drawHeatCols()` — extends it to 2D (per-pixel intensity rather than per-column strip)
- Colour scale: `rgba(0,0,0,0)` (no change) → `rgba(234,179,8,0.5)` (yellow, low) → `rgba(249,115,22,0.65)` (orange, medium) → `rgba(239,68,68,0.8)` (red, high)
- Renders on the **actual screenshot** (not the diff image)
- When Heatmap mode is active: actual screenshot shown full-width, overlay canvas drawn on top, baseline hidden, divider hidden

**Mode switching logic** (extends existing `setMode()`):
- `heatmap` mode: show actual image full width + draw overlay canvas
- All other modes: hide/clear overlay canvas (zero performance cost when not active)

### 4.4 Frontend — AI Analysis Panel

**Footer action button** below each diff card (below the 4px heatmap strip):
```html
<button class="vrt-ai-btn" onclick="vrAiAnalyse(this)">🤖 AI Analysis</button>
```
Only rendered when `hasDiff === true` (no point analysing passing checkpoints).

**Result panel** `.vrt-ai-panel`:
- Slides down below the button (max-height animation, no layout shift)
- Contains:
  - Classification chips (coloured pill badges, one per detected category)
  - Recommendation badge: `✓ Approve` (green) / `⚠ Review` (yellow) / `✗ Flag` (red)
  - Recommendation reason (one line, muted text)
  - Divider
  - `✨ Enhance with AI` button (fires Stage 2 LLM call)
  - AI narrative block (appears after Stage 2 completes — shows model name + confidence %)
  - Loading spinner during both stages
  - Error state: "No AI provider configured. Go to Admin → Settings → AI." (links to admin panel)

**State management:**
- Each diff card tracks its own analysis state independently
- Stage 1 result cached in DOM data attribute — re-clicking "🤖 AI Analysis" shows cached result instantly
- Stage 2 cached separately — "✨ Enhance with AI" button replaced with result once fired

---

## 5. Rule-Based Classification Logic

All classification is performed on the already-saved diff PNG (`<baselineId>-diff.png`). The diff image uses the existing bounding-box rendering (red borders + 20% fill).

| Classification | Detection rule |
|---|---|
| **Content Change** | Diff bands with height 8–24px (text-row height range), count ≥ 1 |
| **Layout Shift** | Single diff region covering > 20% of total image area |
| **Style Drift** | Many small scattered diff pixels, no contiguous region > 5% of image area, diffPct < 8% |
| **Element Added** | Diff region where baseline pixels are all background-coloured (near-uniform), actual pixels are varied |
| **Element Removed** | Diff region where actual pixels are all background-coloured, baseline pixels are varied |
| **Dynamic Data** | `runContext.ignoreRegions` contains regions of category `dynamic-data` or `temporal` that overlap with diff area |
| **Dimension Change** | `baselineWidth !== actualWidth` OR `baselineHeight !== actualHeight` |

Multiple classifications can apply to the same diff (e.g. Content Change + Style Drift).

**Recommendation logic:**

| Condition | Recommendation |
|---|---|
| Only Dynamic Data or Style Drift, diffPct < 5% | `approve` |
| Dimension Change detected | `flag` |
| Layout Shift detected | `flag` |
| diffPct > 15% | `flag` |
| Content Change or Element Added/Removed, diffPct < 15% | `review` |
| Fallback | `review` |

---

## 6. AI Enhancement (Stage 2)

### 6.1 Trigger
Only fires when user explicitly clicks "✨ Enhance with AI". Requires a configured AI provider in Admin → Settings → AI. If no provider configured, shows inline error with link to admin panel.

### 6.2 Prompt Structure
```
You are a visual regression testing assistant. Analyse this VRT diff result and provide a concise assessment.

Test: {testName}
Element: {locatorName}
Diff: {diffPct}% ({diffPixels} of {totalPixels} pixels changed)
Dimensions: baseline {W}×{H}, actual {W}×{H}
Detected change types: {classifications.join(', ')}
Regions affected: {regions}

Provide:
1. A 2-3 sentence plain-English explanation of what likely changed and whether it looks like a regression or an expected change.
2. A suggested action: "approve", "review", or "flag"
3. A confidence score 0-100

Respond in JSON: { "narrative": "...", "suggestedAction": "approve|review|flag", "confidence": 85 }
```

### 6.3 Provider Reuse
- Calls `nlStore.loadNlConfig()` → gets provider, apiKey, model, baseUrl
- Calls `nlProvider.getSuggestion(config, prompt)` → existing function, no changes
- If provider is `ollama` or `compatible` — works as-is (OpenAI-compatible)
- Timeout: 15s (VRT analysis is low-latency expectation)

---

## 7. Styling

Matches existing dark VRT panel styles (`#0d1219` background, `#1e2536` borders, `#94a3b8` muted text).

**Classification chip colours** (match existing ignore-region category colours):

| Classification | Chip colour |
|---|---|
| Content Change | Blue `rgba(59,130,246,...)` |
| Layout Shift | Red `rgba(239,68,68,...)` |
| Style Drift | Yellow `rgba(234,179,8,...)` |
| Element Added | Green `rgba(34,197,94,...)` |
| Element Removed | Orange `rgba(249,115,22,...)` |
| Dynamic Data | Gray `rgba(156,163,175,...)` |
| Dimension Change | Purple `rgba(168,85,247,...)` |

**Recommendation badge colours:**
- `approve` — green border + text
- `review` — yellow border + text
- `flag` — red border + text

---

## 8. Sandbox VRT URL

The sandbox diff viewer at `/vrt` (or equivalent sandbox route) must be updated to include:
- Heatmap mode button
- AI Analysis footer button
- Both wired to the same shared JS functions

Exact route to be verified during implementation by checking `src/ui/routes/visual.routes.ts` for the sandbox endpoint.

---

## 9. What Does NOT Change

- `src/utils/visualRegression.ts` — diff generation untouched
- Baseline storage, approve flow, ignore regions — untouched
- Existing Slider / Onion / Blink / Diff modes — untouched
- `nlProvider.ts` / `nlStore.ts` — reused as-is, zero modifications
- `data/` structure — no new files, no schema changes
- Auth middleware — existing `requireAuth` reused

---

## 10. Testing Checklist (for user after implementation)

### Heatmap Mode
1. Open any test run with a visual diff checkpoint
2. Click **🌡 Heatmap** in the mode bar
3. Verify: actual screenshot is shown full-width with thermal colour overlay (red = most changed)
4. Verify: slider divider is hidden, baseline image is hidden
5. Click any other mode (Slider/Onion/Blink/Diff) — verify heatmap overlay disappears cleanly
6. Repeat steps 2–5 on the **Visual Baselines** page diff viewer popup

### AI Analysis — Stage 1 (Rule-Based)
7. On a diff checkpoint, click **🤖 AI Analysis**
8. Verify: panel slides down with classification chip(s) and a recommendation badge (Approve / Review / Flag)
9. Verify: recommendation reason text is present
10. Close and re-open — verify result is cached (no second API call, instant display)
11. Repeat on **Visual Baselines** page diff viewer popup

### AI Analysis — Stage 2 (LLM Enhanced)
12. Ensure AI provider is configured in Admin → Settings → AI
13. Inside the AI Analysis panel, click **✨ Enhance with AI**
14. Verify: spinner appears, then narrative text appears with model name + confidence %
15. Verify: "✨ Enhance with AI" button is replaced by the result (not clickable twice)
16. Test with no AI provider configured — verify inline error message with link to Admin → Settings → AI

### Passing Checkpoints
17. Open a checkpoint with 0% diff (pass) — verify **🤖 AI Analysis** button is NOT shown

### Sandbox VRT URL
18. Navigate to the sandbox VRT diff URL — verify Heatmap mode and AI Analysis button are present and functional

---

## 11. Files To Create / Modify

| File | Change |
|---|---|
| `src/utils/vrtAiAnalyser.ts` | **NEW** — rule-based classifier + AI enhancement |
| `src/ui/routes/visual.routes.ts` | **MODIFY** — add `POST /api/visual-baselines/:id/ai-analysis` |
| `src/ui/public/execution-report.html` | **MODIFY** — Heatmap mode button + canvas + AI footer button + panel |
| `src/ui/public/js/20-visual-regression.js` | **MODIFY** — same Heatmap + AI in diff viewer popup |
| `src/ui/public/styles_addon.css` | **MODIFY** — chip, panel, heatmap overlay styles |
