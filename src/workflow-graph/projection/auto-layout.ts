const LAYER_SPACING = 250;
const NODE_SPACING = 100;

export function computeAutoLayout(layer: number, indexWithinLayer: number): { x: number; y: number } {
  return {
    x: layer * LAYER_SPACING,
    y: indexWithinLayer * NODE_SPACING,
  };
}
