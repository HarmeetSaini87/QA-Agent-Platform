/**
 * import-engine/postman-workflow-mapper.ts
 * Phase D Step 2 — Orchestrates Postman → ImportResult pipeline.
 *
 * Pipeline stages (all pure, no side-effects):
 *   Raw JSON
 *     ↓  postman-parser          → ParsedPostmanCollection
 *     ↓  postman-variable-mapper → ScopedVariable[] + ApiVariable[]
 *     ↓  postman-auth-mapper     → ApiAuthConfig per step
 *     ↓  postman-assertion-mapper→ ApiAssertion[] per step
 *     ↓  workflow normalization  → ApiCollection + WorkflowEnvelope
 *     ↓  dependency-analyzer     → DependencyDetectionResult
 *     ↓  compatibility-validator → CompatibilityReport
 *     ↓  ImportResult
 *
 * INVARIANTS:
 *   - All produced ApiTestStep[] execute through existing workflow/execution/variable/assertion engines.
 *   - No Postman-specific runtime paths created.
 *   - Disabled items included as steps with execution.condition='false' (scheduler skips at runtime).
 *   - Folder hierarchy preserved in step.group field.
 *   - Auth inheritance chain resolved per step before ApiTestStep construction.
 *   - Variable references in request templates are NOT pre-resolved (lazy resolution rule).
 */

import { v4 as uuidv4 } from 'uuid';
import { parsePostmanCollection } from './postman-parser';
import { mapPostmanVariables } from './postman-variable-mapper';
import { mapPostmanAuth, mapCollectionAuth } from './postman-auth-mapper';
import { mapPostmanScriptsToAssertions } from './postman-assertion-mapper';
import { analyzePostmanDependencies } from './postman-dependency-analyzer';
import { validateCompatibility } from './compatibility-validator';
import { collectionToWorkflow } from '../../workflow-dsl/legacy-adapter';
import type {
  ImportResult,
  PostmanImportOptions,
  NormalizationTrace,
  NormalizationStage,
  ImportWarning,
} from './contracts';
import type { ApiCollection, ApiTestStep, ApiRequest } from '../../data/types';
import type {
  FolderNode,
  WorkflowGraphHints,
  WorkflowAiReadiness,
  WorkflowNormalizationSource,
} from '../../shared-core/contracts/workflow.contract';
import { DEFAULT_MAX_FOLDER_DEPTH } from '../../shared-core/contracts/workflow.contract';

// ── Folder tree builder ───────────────────────────────────────────────────────

type MutableFolderNode = {
  id: string;
  name: string;
  sourceId?: string;
  children: MutableFolderNode[];
  stepIds: string[];
  depth: number;
};

function buildFolderTree(
  requests: Array<{ id: string; name: string; folderPath: string[]; order: number }>,
  collectionName: string,
  maxDepth: number,
): FolderNode {
  const root: MutableFolderNode = {
    id: 'root',
    name: collectionName,
    children: [],
    stepIds: [],
    depth: 0,
  };

  const folderMap = new Map<string, MutableFolderNode>();
  const visitedKeys = new Set<string>(); // cycle guard
  folderMap.set('', root);

  for (const req of requests) {
    const path = req.folderPath ?? [];
    let current = root;

    for (let i = 0; i < Math.min(path.length, maxDepth); i++) {
      const segment = path[i];
      const key = path.slice(0, i + 1).join('/');
      if (visitedKeys.has(key) && folderMap.has(key)) {
        current = folderMap.get(key)!;
        continue;
      }
      if (!folderMap.has(key)) {
        const node: MutableFolderNode = {
          id: key,
          name: segment,
          children: [],
          stepIds: [],
          depth: i + 1,
        };
        folderMap.set(key, node);
        visitedKeys.add(key);
        current.children.push(node);
      }
      current = folderMap.get(key)!;
    }

    current.stepIds.push(req.id);
  }

  return root as unknown as FolderNode;
}

function computeAiReadiness(
  stepCount: number,
  hasVars: boolean,
  hasDeps: boolean,
  hasHierarchy: boolean,
): WorkflowAiReadiness {
  let score = 0;
  if (stepCount > 0) score += 30;
  if (hasVars) score += 20;
  if (hasDeps) score += 25;
  if (hasHierarchy) score += 25;
  return {
    normalizedStepCount: stepCount,
    hasVariableBindings: hasVars,
    hasDependencyHints: hasDeps,
    hasFolderHierarchy: hasHierarchy,
    readinessScore: score,
  };
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function importFromPostman(
  collectionJson: string,
  options: PostmanImportOptions,
): ImportResult {
  const allWarnings: ImportWarning[] = [];
  const stageWarnings: Partial<Record<NormalizationStage, ImportWarning[]>> = {};
  const completedStages: NormalizationStage[] = ['Raw'];

  // ── Stage 1: Parse ──────────────────────────────────────────────────────────
  const parsed = parsePostmanCollection(collectionJson);
  allWarnings.push(...parsed.warnings);
  stageWarnings['Parsed'] = parsed.warnings;
  completedStages.push('Parsed');

  // ── Stage 2: Variable mapping ───────────────────────────────────────────────
  const varMapping = mapPostmanVariables(parsed);
  allWarnings.push(...varMapping.warnings);
  stageWarnings['Normalized'] = varMapping.warnings;

  // ── Stage 3: Build ApiTestStep[] ───────────────────────────────────────────
  const includeDisabled = options.includeDisabled ?? true;
  const collectionAuthConfig = mapCollectionAuth(parsed.collectionAuth, allWarnings);
  const steps: ApiTestStep[] = [];
  let skippedCount = 0;

  for (const req of parsed.requests) {
    if (!includeDisabled && req.disabled) {
      skippedCount++;
      continue;
    }

    // Auth: map per-step resolved auth
    const authResult = mapPostmanAuth(req.auth, req.id, req.name);
    allWarnings.push(...authResult.warnings);

    // Assertions: map from test scripts
    const assertionResult = mapPostmanScriptsToAssertions(req.scripts, req.name);
    allWarnings.push(...assertionResult.unsupportedWarnings);

    // Build ApiRequest
    const apiRequest: ApiRequest = {
      method: req.method as ApiRequest['method'],
      url: req.url, // {{vars}} preserved — lazy resolution rule
      headers: buildHeaders(req.headers, authResult.authConfig),
      queryParams: buildQueryParams(req.queryParams),
      body: buildBody(req),
      bodyType: mapBodyType(req.body.mode),
    };

    // Build ApiTestStep
    const step: ApiTestStep = {
      id: req.id,
      name: req.name,
      request: apiRequest,
      assertions: assertionResult.assertions,
      extractVariables: [], // PM variable extractions (pm.env.set) handled by dependency hints; not mapped to extractVariables yet
      execution: {
        // Disabled items get condition='false' — scheduler skips, preserves intent
        ...(req.disabled ? { condition: 'false' } : {}),
        onFailure: 'continue',
      },
      dependsOn: [], // populated by dependency-analyzer hints if caller opts in
      // Preserve folder path as group for UI display / future workflow grouping
      group: req.folderPath.length > 0 ? req.folderPath.join(' / ') : undefined,
      order: req.order,
    };

    steps.push(step);
  }

  completedStages.push('Normalized');

  // ── Stage 4: Assemble ApiCollection ────────────────────────────────────────
  const collectionId = uuidv4();
  const collection: ApiCollection = {
    id: collectionId,
    projectId: options.projectId,
    name: options.collectionName ?? parsed.name,
    environmentId: options.environmentId,
    steps,
    variables: varMapping.collectionVariables,
    onFailure: 'continue',
    executionMode: options.executionMode ?? 'sequential',
    tags: [],
    // Collection-level auth config — mapped from PM collection auth
    ...(collectionAuthConfig.type !== 'none' ? { } : {}),
    // Note: ApiCollection has no authConfig field in current types.ts — auth is per-step only
  };

  // ── Stage 6 (moved): Dependency analysis — must precede envelope so hasDeps is available ──
  const dependencyHints = analyzePostmanDependencies(parsed.requests);

  // ── Stage 5: WorkflowEnvelope wrapping ─────────────────────────────────────
  const envelope = collectionToWorkflow(collection);
  // Attach source metadata
  envelope.metadata.source = 'postman';
  envelope.metadata.description = parsed.description;
  envelope.metadata.tags = [];

  const maxDepth = options.maxFolderDepth ?? DEFAULT_MAX_FOLDER_DEPTH;
  const hasHierarchy = parsed.requests.some(r => (r.folderPath ?? []).length > 0);
  const hasVars = varMapping.collectionVariables.length > 0;
  const hasDeps = dependencyHints.hints.length > 0;

  envelope.metadata.metadataVersion = 1;
  envelope.metadata.metadataGeneratedAt = new Date().toISOString();
  envelope.metadata.normalizationSource = 'postman' as WorkflowNormalizationSource;
  envelope.metadata.folderHierarchy = hasHierarchy
    ? buildFolderTree(parsed.requests, parsed.name, maxDepth)
    : undefined;
  envelope.metadata.aiReadiness = computeAiReadiness(steps.length, hasVars, hasDeps, hasHierarchy);

  // Build WorkflowNode[] with per-node hierarchy metadata
  const nodeHierarchyMap = new Map<string, { hierarchyPath: string[]; visualGroup?: string }>();
  for (const req of parsed.requests) {
    const path = req.folderPath ?? [];
    nodeHierarchyMap.set(req.id, {
      hierarchyPath: [...path, req.name],
      visualGroup: path.length > 0 ? path[path.length - 1] : undefined,
    });
  }

  envelope.workflow.nodes = steps.map(step => {
    const meta = nodeHierarchyMap.get(step.id);
    return {
      nodeType: 'HTTP' as const,
      step,
      hierarchyPath: meta?.hierarchyPath ?? [step.name],
      visualGroup: meta?.visualGroup,
    };
  });

  // Warn if any request exceeded maxFolderDepth
  const depthExceeded = parsed.requests.some(r => (r.folderPath ?? []).length > maxDepth);
  if (depthExceeded) {
    allWarnings.push({
      code: 'FOLDER_DEPTH_EXCEEDED',
      severity: 'info',
      message: `One or more folders exceed maxFolderDepth (${maxDepth}). Deep nesting was flattened.`,
    });
  }

  completedStages.push('WorkflowEnvelope');
  stageWarnings['WorkflowEnvelope'] = [];

  // ── Stage 7: Compatibility validation ──────────────────────────────────────
  const partialResult: ImportResult = {
    collection,
    envelope,
    authMetadata: parsed.authMetadata,
    dependencyHints,
    warnings: allWarnings,
    format: 'postman' as const,
    endpointCount: steps.length,
    skippedCount: skippedCount + parsed.depthSkippedCount,
    sourceMetadata: parsed.sourceMetadata,
  };

  const compatReport = validateCompatibility(partialResult);
  allWarnings.push(...compatReport.issues.map(i => ({
    code: 'UNKNOWN_PM_FEATURE' as const,
    severity: (i.severity === 'error' ? 'critical' : i.severity === 'warning' ? 'warning' : 'info') as ImportWarning['severity'],
    message: i.message,
    context: i.stepId,
  })));

  completedStages.push('CompatibilityValidated');
  stageWarnings['CompatibilityValidated'] = [];

  const normalizationTrace: NormalizationTrace = {
    stages: completedStages,
    completedAt: new Date().toISOString(),
    stageWarnings,
  };

  return {
    ...partialResult,
    warnings: allWarnings,
    normalizationTrace,
  };
}

// ── Request field builders ────────────────────────────────────────────────────

import type { NormalizedPMHeader, NormalizedPMQueryParam, FlatRequest } from './postman-parser';
import type { ApiAuthConfig } from '../../data/types';

function buildHeaders(
  headers: NormalizedPMHeader[],
  auth: ApiAuthConfig,
): Record<string, string> | undefined {
  const result: Record<string, string> = {};

  for (const h of headers) {
    if (h.enabled) result[h.key] = h.value;
  }

  // Inject auth header hint as placeholder — execution-engine resolves at runtime
  // Only inject if no existing Authorization header is present
  if (!result['Authorization'] && !result['authorization']) {
    if (auth.type === 'bearer') {
      // Value may be {{var}} template — preserved as-is
      result['Authorization'] = `Bearer ${auth.bearer?.token ?? ''}`;
    } else if (auth.type === 'apiKey' && auth.apiKey) {
      result[auth.apiKey.header] = auth.apiKey.value;
    } else if (auth.type === 'basic' && auth.basic) {
      // Placeholder — execution-engine resolves base64 at runtime
      result['Authorization'] = `Basic {{__basic_${auth.basic.username}}}`;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function buildQueryParams(
  params: NormalizedPMQueryParam[],
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const p of params) {
    if (p.enabled) result[p.key] = p.value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildBody(req: FlatRequest): unknown {
  const b = req.body;
  switch (b.mode) {
    case 'raw_json':
      // Prefer parsed JSON; fall back to raw string (preserves {{var}} templates)
      return b.jsonBody ?? b.raw;
    case 'raw_text':
      return b.raw;
    case 'urlencoded': {
      const form: Record<string, string> = {};
      for (const f of b.urlEncoded ?? []) {
        if (f.enabled) form[f.key] = f.value;
      }
      return form;
    }
    case 'formdata': {
      const form: Record<string, string> = {};
      for (const f of b.formData ?? []) {
        if (f.enabled) form[f.key] = f.value;
      }
      return form;
    }
    case 'graphql':
      return b.graphql;
    default:
      return undefined;
  }
}

function mapBodyType(mode: FlatRequest['body']['mode']): ApiRequest['bodyType'] {
  switch (mode) {
    case 'raw_json': return 'json';
    case 'urlencoded': return 'form';
    case 'raw_text': return 'raw';
    default: return 'none';
  }
}
