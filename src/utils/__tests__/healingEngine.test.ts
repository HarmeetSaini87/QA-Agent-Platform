import { describe, it, expect } from 'vitest';
import {
  scoreCandidate,
  scoreCandidates,
  toLocatorAlternative,
  T3_AUTO_THRESHOLD,
  MAX_SCORE,
  WEIGHTS,
  type DomCandidate,
} from '../healingEngine';
import type { HealingProfile } from '../../data/types';

const baseProfile: HealingProfile = {
  tag:          'button',
  text:         'Save Patient',
  ariaLabel:    'save-patient',
  role:         'button',
  classes:      ['btn', 'btn-primary'],
  placeholder:  null,
  testId:       null,
  parentTag:    'div',
  parentId:     null,
  parentClass:  'form-actions',
  domDepth:     5,
  siblingIndex: 2,
  capturedAt:   '2026-04-01T00:00:00.000Z',
  capturedFrom: 'recorder',
};

const baseCandidate: DomCandidate = {
  tag:          'button',
  id:           null,
  testId:       null,
  ariaLabel:    'save-patient',
  role:         'button',
  text:         'Save Patient',
  classes:      ['btn', 'btn-primary'],
  placeholder:  null,
  name:         null,
  parentTag:    'div',
  parentId:     null,
  parentClass:  'form-actions',
  domDepth:     5,
  siblingIndex: 2,
  cssSelector:  'div > button',
};

describe('scoreCandidate', () => {
  it('scores a full-signal match (no testId) at 71', () => {
    const result = scoreCandidate(baseProfile, baseCandidate);
    // ariaLabel(9)+text(8)+role(7)+class(5)+parentTag(3)+domDepth(2)+siblingIdx(1) = 35 → 71/100
    expect(result.rawScore).toBe(35);
    expect(result.score).toBe(71);
    expect(result.breakdown).toBeDefined();
  });

  it('scores ≥ T3_AUTO_THRESHOLD when testId matches', () => {
    const profile = { ...baseProfile, testId: 'save-btn' };
    const candidate = { ...baseCandidate, testId: 'save-btn' };
    const result = scoreCandidate(profile, candidate);
    // testId(10)+ariaLabel(9)+text(8)+role(7)+class(5)+parentTag(3)+domDepth(2)+siblingIdx(1) = 45 → 92/100
    expect(result.score).toBeGreaterThanOrEqual(T3_AUTO_THRESHOLD);
  });

  it('awards testId max weight when both match', () => {
    const profile = { ...baseProfile, testId: 'save-btn' };
    const candidate = { ...baseCandidate, testId: 'save-btn' };
    const result = scoreCandidate(profile, candidate);
    expect(result.breakdown.testId).toBe(WEIGHTS.testId);
  });

  it('awards zero testId when values differ', () => {
    const profile = { ...baseProfile, testId: 'save-btn' };
    const candidate = { ...baseCandidate, testId: 'cancel-btn' };
    const result = scoreCandidate(profile, candidate);
    expect(result.breakdown.testId).toBe(0);
  });

  it('awards ariaLabel score on exact match', () => {
    const result = scoreCandidate(baseProfile, baseCandidate);
    expect(result.breakdown.ariaLabel).toBe(WEIGHTS.ariaLabel);
  });

  it('awards zero ariaLabel when profile has no ariaLabel', () => {
    const profile = { ...baseProfile, ariaLabel: null };
    const result = scoreCandidate(profile, baseCandidate);
    expect(result.breakdown.ariaLabel).toBe(0);
  });

  it('awards text score on partial containment', () => {
    const candidate = { ...baseCandidate, text: 'Save Patient Record' };
    const result = scoreCandidate(baseProfile, candidate);
    expect(result.breakdown.text).toBe(WEIGHTS.text);
  });

  it('awards zero text for short strings (< 3 chars)', () => {
    const profile = { ...baseProfile, text: 'OK' };
    const candidate = { ...baseCandidate, text: 'OK' };
    const result = scoreCandidate(profile, candidate);
    expect(result.breakdown.text).toBe(0);
  });

  it('awards class score when at least one class overlaps', () => {
    const candidate = { ...baseCandidate, classes: ['btn', 'btn-danger'] };
    const result = scoreCandidate(baseProfile, candidate);
    expect(result.breakdown.class).toBe(WEIGHTS.class);
  });

  it('awards zero class when no class overlaps', () => {
    const candidate = { ...baseCandidate, classes: ['nav-item', 'header-link'] };
    const result = scoreCandidate(baseProfile, candidate);
    expect(result.breakdown.class).toBe(0);
  });

  it('awards domDepth when within ±2 levels', () => {
    const candidate = { ...baseCandidate, domDepth: 6 };
    const result = scoreCandidate(baseProfile, candidate);
    expect(result.breakdown.domDepth).toBe(WEIGHTS.domDepth);
  });

  it('awards zero domDepth when more than 2 levels apart', () => {
    const candidate = { ...baseCandidate, domDepth: 10 };
    const result = scoreCandidate(baseProfile, candidate);
    expect(result.breakdown.domDepth).toBe(0);
  });

  it('awards siblingIdx when within ±2 positions', () => {
    const candidate = { ...baseCandidate, siblingIndex: 3 };
    const result = scoreCandidate(baseProfile, candidate);
    expect(result.breakdown.siblingIdx).toBe(WEIGHTS.siblingIdx);
  });

  it('normalises score to 0–100 range', () => {
    const result = scoreCandidate(baseProfile, baseCandidate);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('MAX_SCORE equals sum of all weights', () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(MAX_SCORE).toBe(total);
    expect(MAX_SCORE).toBe(49);
  });

  it('returns score = 0 for completely unrelated candidate', () => {
    const unrelated: DomCandidate = {
      tag:          'span',
      id:           null,
      testId:       null,
      ariaLabel:    null,
      role:         null,
      text:         null,
      classes:      [],
      placeholder:  null,
      name:         null,
      parentTag:    null,
      parentId:     null,
      parentClass:  null,
      domDepth:     20,
      siblingIndex: 10,
      cssSelector:  'span',
    };
    const profile = { ...baseProfile, ariaLabel: null, role: null, text: null, classes: [], parentTag: null };
    const result = scoreCandidate(profile, unrelated);
    expect(result.score).toBe(0);
  });
});

describe('scoreCandidates', () => {
  it('returns candidates sorted by score descending', () => {
    const good: DomCandidate = { ...baseCandidate };
    const bad: DomCandidate = {
      ...baseCandidate,
      ariaLabel: null,
      role: null,
      text: null,
      classes: [],
      domDepth: 20,
    };
    const results = scoreCandidates(baseProfile, [bad, good]);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('returns empty array for empty candidates', () => {
    expect(scoreCandidates(baseProfile, [])).toEqual([]);
  });
});

describe('toLocatorAlternative', () => {
  it('maps scored candidate to LocatorAlternative shape', () => {
    const scored = scoreCandidate(baseProfile, { ...baseCandidate, testId: 'save-btn' });
    const alt = toLocatorAlternative(scored);
    expect(alt).toHaveProperty('selector');
    expect(alt).toHaveProperty('selectorType');
    expect(alt).toHaveProperty('confidence');
    expect(alt.confidence).toBe(scored.score);
  });

  it('picks testId as best selector when present', () => {
    const candidate = { ...baseCandidate, testId: 'save-btn' };
    const profile = { ...baseProfile, testId: 'save-btn' };
    const scored = scoreCandidate(profile, candidate);
    const alt = toLocatorAlternative(scored);
    expect(alt.selector).toBe('save-btn');
    expect(alt.selectorType).toBe('testid');
  });
});
