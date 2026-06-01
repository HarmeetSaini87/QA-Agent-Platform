import * as path from 'path';
import * as fs from 'fs';
import type { SuggestedStep, NlSuggestResponse } from '../../data/types';

const _nlCache = new Map<string, { result: NlSuggestResponse; expiresAt: number }>();
export const NL_CACHE_TTL_MS = 60_000;

const _nlSessionHits = new Map<string, { count: number; resetAt: number }>();
let _nlGlobalHits = 0;
let _nlGlobalReset = Date.now() + 60_000;

export function nlRateCheck(sessionId: string): boolean {
  const now = Date.now();
  if (now > _nlGlobalReset) { _nlGlobalHits = 0; _nlGlobalReset = now + 60_000; }
  if (_nlGlobalHits >= 100) return false;
  const s = _nlSessionHits.get(sessionId) || { count: 0, resetAt: now + 60_000 };
  if (now > s.resetAt) { s.count = 0; s.resetAt = now + 60_000; }
  if (s.count >= 10) return false;
  _nlGlobalHits++;
  s.count++;
  _nlSessionHits.set(sessionId, s);
  return true;
}

const NL_LOG_PATH = path.resolve('data', 'nl-log.ndjson');
const NL_LOG_MAX = 10 * 1024 * 1024;

export function logNL(entry: object): void {
  try {
    if (fs.existsSync(NL_LOG_PATH) && fs.statSync(NL_LOG_PATH).size > NL_LOG_MAX) {
      fs.renameSync(NL_LOG_PATH, NL_LOG_PATH + '.1');
    }
    const safe = JSON.stringify(entry)
      .replace(/"[^"]*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}[^"]*"/g, '"[REDACTED]"')
      .replace(/"(sk-|Bearer |gsk_|AIza)[^"]{4,}"/g, '"[REDACTED]"');
    fs.appendFileSync(NL_LOG_PATH, safe + '\n', 'utf8');
  } catch { /* non-fatal */ }
}

export function nlValidateStep(
  step: SuggestedStep,
  allowedKeywords: string[],
  knownLocators: string[],
): SuggestedStep {
  if (step.keyword && !allowedKeywords.includes(step.keyword)) {
    step.keyword = null;
    step.matched = false;
    step.source = 'rule';
  }
  if (step.locatorName && !knownLocators.includes(step.locatorName)) {
    step.locatorName = null;
    step.confidenceBreakdown.locator = 0;
  }
  step.confidence = Math.min(1, Math.max(0, step.confidence));
  step.confidenceBreakdown.verb = Math.min(1, Math.max(0, step.confidenceBreakdown.verb));
  step.confidenceBreakdown.locator = Math.min(1, Math.max(0, step.confidenceBreakdown.locator));
  step.confidenceBreakdown.value = Math.min(1, Math.max(0, step.confidenceBreakdown.value));
  return step;
}

export { _nlCache };