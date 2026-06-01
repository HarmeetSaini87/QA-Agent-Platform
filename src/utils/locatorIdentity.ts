/**
 * locatorIdentity.ts — Centralized locator identity utilities
 *
 * Single source of truth for:
 *   - fingerprintProfile()  : semantic identity hash from healingProfile
 *   - inferNameSource()     : heuristic detection of auto-generated names
 *   - isUserDefined()       : guard used before any name mutation
 *
 * Import from here — never inline these in routes or parsers.
 */

import { HealingProfile } from '../data/types';

// ── Auto-generated name pattern ───────────────────────────────────────────────
// Matches recorder-generated names ONLY:
//   "Click M211p", "Input M99p", "Select Element 42", "Choose File Element 7"
// Does NOT match business names like "Sign In to Gateway Portal"
const AUTO_PATTERN = /^(Click|Type|Select|Choose File|Check|Uncheck|Hover|Assert|Navigate|Set Date|Upload)\s+(M\d+p|Element\s+\d+)$/i;

/**
 * Infer whether a name was auto-generated or user-defined.
 * Used during one-time migration of legacy locators that have no nameSource.
 *
 * Conservative: anything NOT matching recorder pattern → 'user'
 * This protects existing curated business names.
 */
export function inferNameSource(name: string): 'auto' | 'user' {
  return AUTO_PATTERN.test((name ?? '').trim()) ? 'auto' : 'user';
}

/**
 * Guard: returns true if the locator name must NOT be overwritten.
 * Use before any name mutation in routes, parsers, or healing.
 *
 * Treats missing nameSource conservatively — infers from name pattern.
 */
export function isUserDefined(locator: { name: string; nameSource?: 'auto' | 'user' }): boolean {
  const source = locator.nameSource ?? inferNameSource(locator.name);
  return source === 'user';
}

/**
 * Semantic fingerprint from healingProfile.
 *
 * Uses 7 fields for collision resistance:
 *   testId, ariaLabel, text, role, tag, parentTag, domDepth
 *
 * More fields = fewer false merges on pages with repeated elements (e.g. two Submit buttons).
 * domDepth included as tie-breaker for same-text elements at different nesting levels.
 *
 * Returns '' (empty string) if profile is missing or all fields are null/empty —
 * caller must treat '' as "no fingerprint available, fall through to selector match".
 */
export function fingerprintProfile(profile?: HealingProfile): string {
  if (!profile) return '';
  const parts = [
    profile.testId,
    profile.ariaLabel,
    profile.text,
    profile.role,
    (profile as any).tag ?? (profile as any).tagName ?? null,
    profile.parentTag,
    profile.domDepth != null ? String(profile.domDepth) : null,
    profile.siblingIndex != null ? String(profile.siblingIndex) : null,
  ]
    .map(v => (v != null ? String(v).trim().toLowerCase() : ''))
    .filter(Boolean);
  return parts.length >= 2 ? parts.join('|') : '';
}
