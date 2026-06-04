import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

export type ChangeClassification =
  | 'Content Change'
  | 'Layout Shift'
  | 'Style Drift'
  | 'Element Added'
  | 'Element Removed'
  | 'Dynamic Data'
  | 'Dimension Change';

export type Recommendation = 'approve' | 'review' | 'flag';

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
  ignoreRegions?: Array<{ category?: string; x: number; y: number; width: number; height: number }>;
}

export interface ClassificationResult {
  classifications: ChangeClassification[];
  regions: number;
  recommendation: Recommendation;
  recommendationReason: string;
  dimensionMismatch: boolean;
  stage: 'rule-based';
}

export interface AiEnhancedResult extends ClassificationResult {
  narrative: string;
  confidence: number;
  suggestedAction: Recommendation;
  model: string;
  stage: 'ai-enhanced';
}

export function buildRecommendation(classifications: ChangeClassification[], diffPct: number): Recommendation {
  if (classifications.includes('Dimension Change') || classifications.includes('Layout Shift')) return 'flag';
  if (diffPct > 15) return 'flag';
  const autoApproveOnly = classifications.every(c => c === 'Dynamic Data' || c === 'Style Drift');
  if (autoApproveOnly && classifications.length > 0 && diffPct < 5) return 'approve';
  return 'review';
}

function buildRecommendationReason(classifications: ChangeClassification[], recommendation: Recommendation, diffPct: number): string {
  if (classifications.includes('Dimension Change')) return 'Dimension mismatch detected — baseline and actual image sizes differ';
  if (classifications.includes('Layout Shift')) return 'Major layout shift detected covering >20% of image area';
  if (diffPct > 15) return `High diff percentage (${diffPct.toFixed(1)}%) exceeds flag threshold`;
  if (recommendation === 'approve') return `Only low-risk changes (${classifications.join(', ')}) with diffPct ${diffPct.toFixed(1)}% < 5%`;
  if (classifications.length === 0) return 'No specific change patterns detected — manual review recommended';
  return `${classifications.join(', ')} detected in ${diffPct.toFixed(1)}% of pixels`;
}

interface Region { x: number; y: number; w: number; h: number; pixels: number }

function detectRegions(redMap: boolean[][], width: number, height: number): Region[] {
  const visited = Array.from({ length: height }, () => new Array(width).fill(false));
  const regions: Region[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!redMap[y][x] || visited[y][x]) continue;
      // BFS flood fill
      const queue: [number, number][] = [[x, y]];
      let minX = x, maxX = x, minY = y, maxY = y, pixels = 0;
      while (queue.length) {
        const [cx, cy] = queue.shift()!;
        if (cx < 0 || cy < 0 || cx >= width || cy >= height || visited[cy][cx] || !redMap[cy][cx]) continue;
        visited[cy][cx] = true;
        pixels++;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        queue.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
      }
      if (pixels > 4) regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels });
    }
  }
  return regions;
}

export async function analyseDiffPng(diffPngPath: string, ctx: RunContext): Promise<ChangeClassification[]> {
  const classifications: ChangeClassification[] = [];
  const totalPixels = ctx.totalPixels || (ctx.baselineWidth * ctx.baselineHeight);

  let png: PNG;
  try {
    const buf = fs.readFileSync(diffPngPath);
    png = PNG.sync.read(buf);
  } catch {
    return classifications;
  }

  const { width, height, data } = png;
  const redMap: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] > 200 && data[i+1] < 80 && data[i+2] < 80) {
        redMap[y][x] = true;
      }
    }
  }

  const regions = detectRegions(redMap, width, height);
  const imageArea = width * height;

  // Layout Shift: single region > 20% of image
  const hasLayoutShift = regions.some(r => (r.w * r.h) / imageArea > 0.2);
  if (hasLayoutShift) classifications.push('Layout Shift');

  // Content Change: regions with height 8–24px (text-row height)
  const textLikeRegions = regions.filter(r => r.h >= 8 && r.h <= 24);
  if (textLikeRegions.length >= 1 && !hasLayoutShift) classifications.push('Content Change');

  // Style Drift: many small scattered, no region > 5%, diffPct < 8
  const allSmall = regions.every(r => (r.w * r.h) / imageArea <= 0.05);
  if (allSmall && regions.length > 0 && ctx.diffPct < 8 && !hasLayoutShift && textLikeRegions.length === 0) {
    classifications.push('Style Drift');
  }

  // Element Added / Removed (heuristic — region pixel density)
  for (const r of regions) {
    const density = r.pixels / (r.w * r.h);
    if (density > 0.7 && r.w * r.h > imageArea * 0.01) {
      classifications.push('Element Added');
      break;
    }
  }

  // Element Removed: large bounding box with sparse actual diff pixels (element disappeared)
  for (const r of regions) {
    const density = r.pixels / (r.w * r.h);
    if (density < 0.3 && r.w * r.h > imageArea * 0.01) {
      classifications.push('Element Removed');
      break;
    }
  }

  // Dynamic Data — ignoreRegions overlap
  if (ctx.ignoreRegions?.length) {
    const dynamicCategories = new Set(['dynamic-data', 'temporal']);
    const hasDynamic = ctx.ignoreRegions.some(ir =>
      ir.category && dynamicCategories.has(ir.category) &&
      regions.some(r => r.x < ir.x + ir.width && r.x + r.w > ir.x && r.y < ir.y + ir.height && r.y + r.h > ir.y)
    );
    if (hasDynamic) classifications.push('Dynamic Data');
  }

  return [...new Set(classifications)];
}

export async function classifyDiff(baselineId: string, ctx: RunContext): Promise<ClassificationResult> {
  const classifications: ChangeClassification[] = [];
  let dimensionMismatch = false;

  if (ctx.baselineWidth !== ctx.actualWidth || ctx.baselineHeight !== ctx.actualHeight) {
    classifications.push('Dimension Change');
    dimensionMismatch = true;
  }

  if (!dimensionMismatch) {
    const diffPngPath = path.join(process.cwd(), 'data', 'baselines', `${baselineId}-diff.png`);
    const detected = await analyseDiffPng(diffPngPath, ctx);
    classifications.push(...detected);
  }

  const recommendation = buildRecommendation(classifications, ctx.diffPct);
  const recommendationReason = buildRecommendationReason(classifications, recommendation, ctx.diffPct);

  return {
    classifications,
    regions: classifications.length,
    recommendation,
    recommendationReason,
    dimensionMismatch,
    stage: 'rule-based',
  };
}

export async function enhanceWithAi(classResult: ClassificationResult, ctx: RunContext): Promise<AiEnhancedResult> {
  const { loadNlConfig } = await import('./nlStore');
  const cfg = await loadNlConfig();
  if (!cfg || !cfg.provider) {
    throw new Error('No AI provider configured. Set one up in Admin → Settings → AI.');
  }

  const { nlRawPrompt } = await import('./nlProvider');
  const prompt = `You are a visual regression testing assistant. Analyse this VRT diff result and provide a concise assessment.

Test: ${ctx.testName}
Element: ${ctx.locatorName}
Diff: ${ctx.diffPct}% (${ctx.diffPixels} of ${ctx.totalPixels} pixels changed)
Dimensions: baseline ${ctx.baselineWidth}×${ctx.baselineHeight}, actual ${ctx.actualWidth}×${ctx.actualHeight}
Detected change types: ${classResult.classifications.join(', ') || 'None'}
Regions affected: ${classResult.regions}

Provide:
1. A 2-3 sentence plain-English explanation of what likely changed and whether it looks like a regression or an expected change.
2. A suggested action: "approve", "review", or "flag"
3. A confidence score 0-100

Respond in JSON: { "narrative": "...", "suggestedAction": "approve|review|flag", "confidence": 85 }`;

  const raw = await nlRawPrompt(cfg, prompt);

  let parsed: { narrative: string; suggestedAction: Recommendation; confidence: number };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? raw);
  } catch {
    parsed = { narrative: raw, suggestedAction: classResult.recommendation, confidence: 50 };
  }

  return {
    ...classResult,
    narrative: parsed.narrative ?? raw,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 50,
    suggestedAction: parsed.suggestedAction ?? classResult.recommendation,
    model: cfg.model ?? cfg.provider,
    stage: 'ai-enhanced',
  };
}
