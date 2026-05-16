import { describe, it, expect } from 'vitest';
import { computeAutoLayout } from '../projection/auto-layout';

describe('computeAutoLayout', () => {
  it('layer 0 index 0 returns {x:0, y:0}', () => {
    expect(computeAutoLayout(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('increasing layer increases x', () => {
    const a = computeAutoLayout(0, 0);
    const b = computeAutoLayout(1, 0);
    const c = computeAutoLayout(2, 0);
    expect(b.x).toBeGreaterThan(a.x);
    expect(c.x).toBeGreaterThan(b.x);
  });

  it('increasing index within same layer increases y', () => {
    const a = computeAutoLayout(0, 0);
    const b = computeAutoLayout(0, 1);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('is deterministic — same inputs produce same output', () => {
    const first = computeAutoLayout(3, 2);
    const second = computeAutoLayout(3, 2);
    expect(first).toEqual(second);
  });

  it('uses LAYER_SPACING=250 and NODE_SPACING=100', () => {
    expect(computeAutoLayout(1, 0)).toEqual({ x: 250, y: 0 });
    expect(computeAutoLayout(0, 1)).toEqual({ x: 0, y: 100 });
    expect(computeAutoLayout(2, 3)).toEqual({ x: 500, y: 300 });
  });
});
