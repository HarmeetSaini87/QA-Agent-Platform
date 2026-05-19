export { enrichDefectPayload } from './api-defect-enricher';
export { proposeUrlFixes } from './api-heal-advisor';
export {
  loadApiDefectsRegistry,
  saveApiDefectsRegistry,
  findOpenApiDefect,
  appendApiDefectRecord,
} from './api-defect-store';
export type {
  ApiDefectEnrichmentContext,
  ApiHealingSuggestion,
  ApiDefectPayload,
  ApiDefectRecord,
  ApiDefectsRegistry,
} from './contracts/api-defect.contracts';
