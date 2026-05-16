/**
 * import-engine-adapter.ts
 * Facade that unifies postman + openapi importers into a single AdaptedImportResult shape.
 *
 * OLD: routes called importFromPostman from src/utils/postmanImport.ts (no warnings, no compatibility report)
 * NEW: routes call adaptPostmanImport — same ApiCollection shape, adds warnings + compatibility
 */

import { importFromPostman } from './postman-workflow-mapper';
import { validateCompatibility } from './compatibility-validator';
import type { ImportResult, PostmanImportOptions, ImportWarning, CompatibilityReport } from './contracts';
import type { ApiCollection } from '../../data/types';

// OLD: routes called importFromOpenApi directly, returned plain ApiCollection
// NEW: routes call adaptOpenApiImport — same collection, adds warnings + compat stub
import { importFromOpenApi as legacyImportFromOpenApi } from '../../utils/openapiImport';
import { importFromPostman as legacyImportFromPostman } from '../../utils/postmanImport';

export interface AdaptedImportResult {
  collection: ApiCollection;
  warnings: ImportWarning[];
  compatibility: CompatibilityReport;
  /** Preserved for response envelope — step count for audit log */
  endpointCount: number;
  skippedCount: number;
  /** 0–100. Lower = more skipped/critical-warning steps. 100 = fully clean import. */
  importHealthScore: number;
}

function computeHealthScore(endpointCount: number, skippedCount: number, warnings: ImportWarning[]): number {
  const criticalCount = warnings.filter(w => w.severity === 'critical').length;
  const total = endpointCount + skippedCount + criticalCount;
  if (total === 0) return 100;
  return Math.round(Math.min(100, Math.max(0, (endpointCount / total) * 100)));
}

export function adaptPostmanImport(
  collectionJson: string,
  environmentId: string,
  opts?: { projectId?: string; collectionName?: string; executionMode?: 'sequential' | 'parallel' | 'dag' }
): AdaptedImportResult {
  // Rollback flag: USE_LEGACY_POSTMAN_IMPORTER=true bypasses new import-engine
  if (process.env.USE_LEGACY_POSTMAN_IMPORTER === 'true') {
    const collection = legacyImportFromPostman(collectionJson, environmentId);
    if (opts?.projectId) collection.projectId = opts.projectId;
    return {
      collection,
      warnings: [],
      compatibility: {
        compatible: true,
        issues: [],
        variableEngineCompatible: true,
        assertionEngineCompatible: true,
        workflowEngineCompatible: true,
        contractEngineCompatible: true,
        unsupportedScriptWarnings: [],
        unmappedScriptCount: 0,
        mappedAssertionCount: 0,
      },
      endpointCount: collection.steps.length,
      skippedCount: 0,
      importHealthScore: 100,
    };
  }

  const options: PostmanImportOptions = {
    environmentId,
    projectId: opts?.projectId,
    collectionName: opts?.collectionName,
    executionMode: opts?.executionMode ?? 'sequential',
  };

  const result: ImportResult = importFromPostman(collectionJson, options);
  const compatibility = validateCompatibility(result);

  return {
    collection: result.collection,
    warnings: result.warnings,
    compatibility,
    endpointCount: result.endpointCount,
    skippedCount: result.skippedCount,
    importHealthScore: computeHealthScore(result.endpointCount, result.skippedCount, result.warnings),
  };
}

// ── OpenAPI adapter ───────────────────────────────────────────────────────────
// Wraps openapiImport utility to produce the same AdaptedImportResult shape.
// Uses existing importFromOpenApi from src/utils/openapiImport.ts which already
// produces an ApiCollection — we just add an empty compat/warnings stub for now
// so route handlers have a uniform shape before the openapi-parser.ts full wire-up
// in a future session.

export function adaptOpenApiImport(
  specContent: string,
  environmentId: string,
  opts?: { tag?: string; includeExamples?: boolean; projectId?: string }
): AdaptedImportResult {
  const collection = legacyImportFromOpenApi(specContent, environmentId, {
    tag: opts?.tag,
    includeExamples: opts?.includeExamples,
  });

  if (opts?.projectId) {
    collection.projectId = opts.projectId;
  }

  return {
    collection,
    warnings: [],
    compatibility: {
      compatible: true,
      issues: [],
      variableEngineCompatible: true,
      assertionEngineCompatible: true,
      workflowEngineCompatible: true,
      contractEngineCompatible: true,
      unsupportedScriptWarnings: [],
      unmappedScriptCount: 0,
      mappedAssertionCount: 0,
    },
    endpointCount: collection.steps.length,
    skippedCount: 0,
    importHealthScore: 100,
  };
}
