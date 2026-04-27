// flakinessEngine.ts — pure stateless flakiness scoring + classification
// No DB, no HTTP, no side effects. All decisions happen here.

export const CURRENT_ENGINE_VERSION = 'v1.0';

export type FlakeCategory = 'timing' | 'network' | 'locator' | 'assertion' | 'environment' | 'unknown';

export interface TestRun {
  testId: string;
  status: 'pass' | 'fail';
  timestamp: number;     // epoch ms
  durationMs: number;
  errorMessage?: string;
  tracePath?: string;
}

export interface FlakinessConfig {
  threshold: number;               // quarantine gate e.g. 0.30
  minRuns: number;                 // e.g. 5
  minRecentRuns: number;           // e.g. 3 within recentWindowDays
  recentWindowDays: number;        // e.g. 7 — MUST be < windowDays
  windowDays: number;              // e.g. 14
  decayHalfLife: number;           // in RUNS (not time) e.g. 6
  quarantineBudget: number;        // e.g. 5
  autoPromoteWindowRuns: number;   // e.g. 10
  autoPromoteMinPassRate: number;  // e.g. 0.95
  autoPromoteLastKRuns: number;    // e.g. 3 — all must pass
  minRunsSinceQuarantine: number;  // cooldown e.g. 3
}

export const DEFAULT_FLAKINESS_CONFIG: FlakinessConfig = {
  threshold: 0.30,
  minRuns: 5,
  minRecentRuns: 3,
  recentWindowDays: 7,
  windowDays: 14,
  decayHalfLife: 6,
  quarantineBudget: 5,
  autoPromoteWindowRuns: 10,
  autoPromoteMinPassRate: 0.95,
  autoPromoteLastKRuns: 3,
  minRunsSinceQuarantine: 3,
};

export interface FlakeSignals {
  timeout: boolean;
  slowTest: boolean;
  locatorError: boolean;
  networkError: boolean;
  assertionError: boolean;
  recentFailSpike: boolean;   // all recentRuns are failures
  durationMs?: number;
  baselineP95?: number;       // from passing runs only; undefined if no passing runs
  rawErrors: string[];        // last 5 errors capped at 300 chars — LLM-ready
  recentFailCount: number;
  recentTotalCount: number;
}

export interface FlakeAnalysis {
  testId: string;
  flakeScore: number;
  failRate: number;
  alternationIndex: number;
  varianceIndex: number;
  confidence: number;

  shouldQuarantine: boolean;
  quarantineReason?: string;
  shouldAutoPromote: boolean;
  decisionState: 'none' | 'candidate_quarantine' | 'candidate_restore';

  classification: {
    primary: FlakeCategory;
    secondary?: FlakeCategory;
    primaryConfidence: number;
  };

  dominantCategory?: FlakeCategory;
  dominantCategoryCount?: number;
  dominantCategoryTotal?: number;

  signals: FlakeSignals;
  scoreVersion: string;
  evaluatedAt: number;
}

// Category priority — deterministic tie-breaker
const CATEGORY_PRIORITY: FlakeCategory[] = [
  'network', 'timing', 'locator', 'assertion', 'environment', 'unknown'
];

export function analyzeFlakiness(
  runs: TestRun[],
  config: FlakinessConfig,
  currentlyQuarantined = false
): FlakeAnalysis | null {

  // 1. Filter to time window, oldest-first
  const cutoff = Date.now() - config.windowDays * 86_400_000;
  const windowed = runs
    .filter(r => r.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (windowed.length < config.minRuns) return null;

  // 2. Recent window (must be a strict sub-window)
  const recentWindowMs = Math.min(
    config.recentWindowDays * 86_400_000,
    config.windowDays * 86_400_000
  );
  const recentCutoff = Date.now() - recentWindowMs;
  const recentRuns = windowed.filter(r => r.timestamp >= recentCutoff);
  if (recentRuns.length < config.minRecentRuns) return null;

  // 3. Exponential decay weights — half-life in RUNS, not time
  const lambda = Math.log(2) / config.decayHalfLife;
  const n = windowed.length;
  const weights = windowed.map((_, i) => Math.exp(-lambda * (n - 1 - i)));
  const wSum = weights.reduce((a, b) => a + b, 0);

  // 4. Weighted fail rate — ONLY gate signal for quarantine
  const failRate = windowed.reduce((acc, r, i) =>
    acc + (r.status === 'fail' ? weights[i] : 0), 0) / wSum;

  // 5. Alternation index [0-1]
  let transitions = 0;
  for (let i = 1; i < windowed.length; i++) {
    if (windowed[i].status !== windowed[i - 1].status) transitions++;
  }
  const alternationIndex = n > 1 ? transitions / (n - 1) : 0;

  // 6. Variance index (weighted stddev of binary pass=0/fail=1)
  const variance = windowed.reduce((acc, r, i) => {
    const v = r.status === 'fail' ? 1 : 0;
    return acc + weights[i] * Math.pow(v - failRate, 2);
  }, 0) / wSum;
  const varianceIndex = Math.sqrt(variance);

  // 7. Composite score (v1.0 weights — do not change without bumping CURRENT_ENGINE_VERSION)
  const flakeScore = 0.7 * failRate + 0.2 * alternationIndex + 0.1 * varianceIndex;

  // 8. Confidence
  const sizeFactor      = Math.min(n / 20, 1);
  const recencyFactor   = Math.min(recentRuns.length / config.minRecentRuns, 1);
  const stabilityFactor = 1 - alternationIndex;
  const confidence = 0.5 * sizeFactor + 0.3 * recencyFactor + 0.2 * stabilityFactor;

  // 9. Quarantine decision — failRate is the ONLY gate
  // Hysteresis: lower threshold by 0.05 when already quarantined to prevent thrashing
  const effectiveThreshold = currentlyQuarantined
    ? Math.max(config.threshold - 0.05, 0)
    : config.threshold;
  const shouldQuarantine = failRate >= effectiveThreshold;
  const quarantineReason = shouldQuarantine
    ? `fail_rate=${failRate.toFixed(2)} >= threshold=${effectiveThreshold.toFixed(2)}`
    : undefined;

  // 10. Auto-promote — four sequential guards
  const lastN = windowed.slice(-config.autoPromoteWindowRuns);
  const lastK = lastN.slice(-config.autoPromoteLastKRuns);
  const passRate = lastN.length > 0
    ? lastN.filter(r => r.status === 'pass').length / lastN.length
    : 0;
  const shouldAutoPromote =
    lastN.length >= config.autoPromoteWindowRuns &&
    lastK.every(r => r.status === 'pass') &&
    passRate >= config.autoPromoteMinPassRate &&
    recentRuns.length >= config.minRecentRuns;

  // 11. Signals + classification
  const testId = runs[0]?.testId ?? '';
  const signals = extractSignals(windowed, recentRuns);
  const classification = classify(signals);
  const { dominantCategory, dominantCategoryCount, dominantCategoryTotal } =
    computeDominant(recentRuns, classify);

  const decisionState: FlakeAnalysis['decisionState'] =
    shouldQuarantine && !currentlyQuarantined ? 'candidate_quarantine' :
    shouldAutoPromote && currentlyQuarantined  ? 'candidate_restore'   : 'none';

  return {
    testId, flakeScore, failRate, alternationIndex, varianceIndex, confidence,
    shouldQuarantine, quarantineReason,
    shouldAutoPromote, decisionState,
    classification, dominantCategory, dominantCategoryCount, dominantCategoryTotal,
    signals,
    scoreVersion: CURRENT_ENGINE_VERSION,
    evaluatedAt: Date.now(),
  };
}

function extractSignals(windowed: TestRun[], recentRuns: TestRun[]): FlakeSignals {
  const failures = windowed.filter(r => r.status === 'fail');
  const passDurations = windowed
    .filter(r => r.status === 'pass')
    .map(r => r.durationMs)
    .sort((a, b) => a - b);

  // Baseline from passing runs only — undefined if no passing runs exist
  const baselineP95 = passDurations.length > 0
    ? passDurations[Math.floor(passDurations.length * 0.95)]
    : undefined;

  // Cap error strings to prevent payload bloat and future LLM token waste
  const rawErrors = failures
    .map(r => (r.errorMessage ?? '').slice(0, 300))
    .filter(Boolean);

  const recentFailSpike = recentRuns.length > 0 && recentRuns.every(r => r.status === 'fail');

  return {
    timeout:         rawErrors.some(e => /timeout|timed out|exceeded.*ms/i.test(e)),
    slowTest:        baselineP95 !== undefined
                       ? failures.some(r => r.durationMs > baselineP95 * 1.5)
                       : false,
    locatorError:    rawErrors.some(e => /locator|element not found|selector|nth\(|getBy/i.test(e)),
    networkError:    rawErrors.some(e => /ECONNRESET|ECONNREFUSED|fetch failed|net::|5\d\d /i.test(e)),
    assertionError:  rawErrors.some(e => /expect\(received\)|toEqual|toBe|assertion/i.test(e)),
    recentFailSpike,
    durationMs:      failures[failures.length - 1]?.durationMs,
    baselineP95,
    rawErrors:       rawErrors.slice(-5),
    recentFailCount: recentRuns.filter(r => r.status === 'fail').length,
    recentTotalCount: recentRuns.length,
  };
}

function classify(s: FlakeSignals): FlakeAnalysis['classification'] {
  const spikeBoost = s.recentFailSpike ? 0.1 : 0;
  const scores: Record<FlakeCategory, number> = {
    network:     Math.min((s.networkError ? 1.0 : 0) + spikeBoost, 1.0),
    timing:      Math.min((s.timeout ? 0.6 : 0) + (s.slowTest ? 0.4 : 0) + spikeBoost, 1.0),
    locator:     s.locatorError   ? 0.9 : 0,
    assertion:   s.assertionError ? 0.8 : 0,
    environment: /crashed|out of memory|killed|SIGKILL/i.test(s.rawErrors.join(' ')) ? 0.9 : 0,
    unknown:     0,
  };

  const sorted = (Object.entries(scores) as [FlakeCategory, number][])
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return CATEGORY_PRIORITY.indexOf(a[0]) - CATEGORY_PRIORITY.indexOf(b[0]);
    });

  const [primary, primaryScore] = sorted[0];
  const [secondary, secondaryScore] = sorted[1];

  return {
    primary:           primaryScore > 0 ? primary : 'unknown',
    secondary:         secondaryScore > 0.3 ? secondary : undefined,
    primaryConfidence: Math.min(primaryScore, 1),
  };
}

function computeDominant(recentRuns: TestRun[], classifyFn: typeof classify) {
  const failures = recentRuns.filter(r => r.status === 'fail');
  if (failures.length === 0) return {};

  // Classify each failure individually, tally categories
  const tally: Record<string, number> = {};
  for (const f of failures) {
    const s = extractSignals([f], [f]);
    const cat = classifyFn(s).primary;
    tally[cat] = (tally[cat] ?? 0) + 1;
  }

  const [dominantCategory, dominantCategoryCount] = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])[0] as [FlakeCategory, number];

  return { dominantCategory, dominantCategoryCount, dominantCategoryTotal: failures.length };
}

export function shouldFailPipeline(quarantinedFailCount: number, budget: number): boolean {
  // Strictly greater: 5/5 = allowed, 6/5 = fail pipeline
  return quarantinedFailCount > budget;
}

export const ACTION_HINTS: Record<FlakeCategory, string> = {
  timing:      'Consider increasing waitForResponse or page load timeout',
  network:     'Check API stability — test may need retry logic or mock',
  locator:     'Locator may be unstable — review selector or add self-healing',
  assertion:   'Data dependency likely — check test isolation or seed data',
  environment: 'Browser crash signal — check agent memory/resource limits',
  unknown:     'Investigate error patterns — insufficient signal for auto-classification',
};

export function getActionHint(category: FlakeCategory): string {
  return ACTION_HINTS[category];
}
