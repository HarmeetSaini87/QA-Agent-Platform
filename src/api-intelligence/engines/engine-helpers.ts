import { RecommendationProvenance, RecommendationBasis } from '../contracts/recommendation.contracts';

export function makeProvenance(
  source: string,
  evidenceRefs: string[],
  basis: RecommendationBasis = 'heuristic',
): RecommendationProvenance {
  return { source, basis, evidenceRefs, generatedAt: new Date().toISOString() };
}
