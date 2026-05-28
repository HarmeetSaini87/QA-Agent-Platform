# Hybrid Workflow Metadata & Graph Readiness — Design Spec
**Date:** 2026-05-16  
**Phase:** D Step 4  
**Status:** Approved  

---

## Overview

Evolve the internal workflow model so TestForge supports both traditional flat-collection execution and future enterprise graph workflows — without breaking existing runtime semantics.

This is **metadata and workflow-structure evolution only**. Not a graph-engine rewrite. Not a graph-only migration. Execution semantics are unchanged.

---

## Constraints (Non-Negotiable)

- Flat sequential collections MUST remain fully supported.
- Existing execution ordering MUST remain stable.
- Existing dependency semantics MUST remain stable.
- Existing imports MUST remain stable.
- Metadata fields MUST NOT influence execution ordering (see architecture guards, Section 4).
- DO NOT redesign: scheduler, execution-engine, retries, variables, assertions, routes, import compatibility.

---

## Approach

**Option A — Thin in-place extensions** (selected).

Extend existing interfaces in `workflow.contract.ts` with optional fields only. No new contract files. No new execution paths. All new fields optional — absent fields produce valid, executable envelopes.

---

## Section 1: WorkflowMetadata Extensions

File: `src/shared-core/contracts/workflow.contract.ts`

### Constants

```ts
/** Maximum folder nesting depth before flattening with FOLDER_DEPTH_EXCEEDED warning. */
export const DEFAULT_MAX_FOLDER_DEPTH = 5;
```

Used by Postman importer and deep hierarchy stress test. Deterministic safeguard against malformed collections, cyclic transform bugs, and unbounded AI-generated hierarchies.

### New named type

```ts
export type WorkflowNormalizationSource =
  | 'legacy'
  | 'postman'
  | 'openapi'
  | 'manual'
  | 'ai';
```

### New supporting interfaces

```ts
/**
 * Recursive folder/tag tree. Root node represents collection root.
 * Postman: built from item[] hierarchy.
 * OpenAPI: built from operation tags (shallow, depth = 1).
 */
export interface FolderNode {
  id: string;
  name: string;
  /** Original Postman folder _postman_id if available — for re-import sync. */
  sourceId?: string;
  readonly children: readonly FolderNode[];
  readonly stepIds: readonly string[];
  depth: number;
}

/**
 * Dependency visualization metadata.
 * Populated from DependencyDetectionResult produced by import pipeline.
 * isHeuristic: true = hints are inferred, NOT guaranteed — critical for AI orchestration.
 */
export interface WorkflowGraphHints {
  detectedEntities: string[];
  operationEntityMap: Record<string, string[]>;
  /** Suggested cluster labels for visual grouping in future graph editor. */
  suggestedGroups: string[];
  /** Estimated dependency edge count. */
  edgeCount: number;
  /** Always true for OpenAPI/Postman — hints are inferred, not guaranteed. */
  isHeuristic?: boolean;
}

/**
 * AI workflow readiness flags — computed at import time.
 * Readiness score 0–100: composite of step count, variable bindings,
 * dependency hints, and hierarchy presence.
 */
export interface WorkflowAiReadiness {
  normalizedStepCount: number;
  hasVariableBindings: boolean;
  hasDependencyHints: boolean;
  hasFolderHierarchy: boolean;
  readinessScore: number;
}
```

### WorkflowMetadata additions

```ts
export interface WorkflowMetadata {
  // existing fields unchanged
  createdAt: string;
  source: WorkflowSource;
  collectionId: string;
  projectId?: string;
  tags?: string[];
  version?: string;
  description?: string;

  // Phase D Step 4 additions
  /**
   * Bumped when metadata schema evolves.
   * Absent = pre-Phase-D envelope, treat as metadataVersion: 0.
   * Never blocks execution — provenance only.
   */
  metadataVersion?: number;

  /**
   * ISO timestamp when metadata was generated.
   * Used for replay, re-import, AI enrichment, migration debugging.
   * Set by all importers and legacy-adapter at envelope creation time.
   */
  metadataGeneratedAt?: string;

  /**
   * How this envelope was normalized.
   * Used for debugging, analytics, AI enrichment, import RCA.
   */
  normalizationSource?: WorkflowNormalizationSource;

  /**
   * Root of folder/tag hierarchy.
   * Postman: recursive FolderNode tree from item[] structure.
   * OpenAPI: shallow tree from operation tags.
   * Manual/Legacy: absent.
   */
  folderHierarchy?: FolderNode;

  /**
   * Dependency visualization metadata for future graph rendering.
   * Populated from DependencyDetectionResult at import time.
   */
  graphHints?: WorkflowGraphHints;

  /**
   * AI workflow readiness flags — for future AI orchestration.
   * Computed at import time, never at execution time.
   */
  aiReadiness?: WorkflowAiReadiness;
}
```

---

## Section 2: WorkflowNode Extensions

File: `src/shared-core/contracts/workflow.contract.ts`

```ts
export interface WorkflowNode {
  // existing fields unchanged
  nodeType: 'HTTP' | 'ASSERTION' | 'EXTRACT' | 'CONDITION' | 'TRANSFORM' | 'PARALLEL' | 'CONTRACT' | 'AI' | 'LOOP';
  step: ApiTestStep;
  dependsOn?: string[];
  layer?: number;
  group?: string;
  disabled?: boolean;

  // Phase D Step 4 additions

  /**
   * Framework-neutral layout coordinate for future graph editor.
   * ReactFlow, D3, or any renderer reads x/y.
   * locked: true = auto-layout must not reposition this node.
   * Execution engine MUST NOT read this field.
   */
  position?: {
    x: number;
    y: number;
    locked?: boolean;
  };

  /**
   * Display-only cluster label for graph rendering.
   * Derived from Postman folder name or OpenAPI tag.
   * Separate from group (which drives parallel fan-out scheduling).
   * Execution engine MUST NOT read this field.
   */
  visualGroup?: string;

  /**
   * Ancestor path root → leaf (inclusive of node name).
   * Index 0 = root folder/tag, last index = this node's display name.
   * Empty array = no hierarchy (manual collection).
   *
   * Examples:
   *   Postman: ['Pets API', 'Auth', 'POST /auth/token']
   *   OpenAPI: ['pets', 'GET /pets/{petId}']
   *   Manual:  []
   *
   * Intentionally denormalized (also present in folderHierarchy tree)
   * to enable per-node traversal, breadcrumbs, filtering, and AI clustering
   * without tree-walking.
   *
   * Execution engine MUST NOT read this field.
   */
  hierarchyPath?: string[];
}
```

---

## Section 3: Import Pipeline Population

### Postman importer (`postman-workflow-mapper.ts`)

- Walk `item[]` recursively to build `FolderNode` tree
- Set `FolderNode.sourceId` from `item._postman_id` if present
- Per node: `hierarchyPath` = ancestor folder names root→leaf + request name as last element
- Per node: `visualGroup` = immediate parent folder name (collection name if top-level)
- Set `metadataVersion: 1` on `WorkflowMetadata`
- Set `normalizationSource: 'postman'`
- Compute `WorkflowAiReadiness` from step count, variable bindings, dependency hints, folder presence
- `position` left `undefined` — populated by future graph editor only

### OpenAPI importer (`openapi-parser.ts`)

- Build shallow `FolderNode` tree from operation tags (depth = 1)
- Per node: `hierarchyPath` = `[tag, operationId]`
- Per node: `visualGroup` = first tag on operation (or `'untagged'` if none)
- Populate `WorkflowGraphHints` from existing `DependencyDetectionResult`
- Set `graphHints.isHeuristic: true` always (tag-based inference)
- Set `metadataVersion: 1`, `normalizationSource: 'openapi'`

### Legacy adapter (`workflow-dsl/legacy-adapter.ts`)

- `hierarchyPath: []` per node
- `visualGroup`: undefined
- `folderHierarchy`: undefined
- `metadataVersion: 1`, `normalizationSource: 'legacy'`
- All other new fields: undefined

### Manual collections

- `normalizationSource: 'manual'`
- All hierarchy/graph/AI fields: undefined
- `metadataVersion: 1`

---

## Section 4: Backward Compatibility & Execution Safety

### Execution engine isolation

**Architecture guards** — one-line invariant comments added to:
- `src/api-runtime/workflow-engine/engine.ts` — at node iteration entry point
- `src/api-runtime/workflow-engine/dag-builder.ts` — at edge-building loop
- `src/api-runtime/workflow-engine/scheduler-state.ts` — at step scheduling entry

Comment format:
```ts
// INVARIANT: metadata fields (position, visualGroup, hierarchyPath) must never influence execution ordering.
```

### metadataSanitizer utility

New file: `src/workflow-dsl/metadata-sanitizer.ts`

```ts
/**
 * Strips all execution-agnostic metadata from a WorkflowEnvelope.
 * Safe to call before execution, replay, export, or worker transfer.
 * Returns a new envelope — original is never mutated.
 * Preserves metadataVersion and normalizationSource (provenance, not display).
 *
 * CONTRACT (frozen):
 *   - MUST be deterministic: same input always produces same output.
 *   - MUST be side-effect free: no I/O, no mutation, no external calls.
 *   - MUST NOT throw: invalid/partial envelopes pass through safely.
 *
 * Replay systems, worker transfers, and distributed orchestration
 * rely on this contract. Do not weaken it.
 */
export function stripExecutionMetadata(envelope: WorkflowEnvelope): WorkflowEnvelope
```

Strips from envelope:
- `metadata.folderHierarchy`
- `metadata.graphHints`
- `metadata.aiReadiness`
- Per node: `position`, `visualGroup`, `hierarchyPath`

Preserves:
- `metadata.metadataVersion`
- `metadata.normalizationSource`
- All execution fields (steps, dependsOn, group, layer, execution config)

### metadataVersion rollback rule

- Present + value = evolved envelope
- Absent = pre-Phase-D envelope, treat as `metadataVersion: 0` implicitly
- Never blocks execution

### Existing test suite

- 471 existing tests unaffected — all new fields optional
- Import routes return same shape + new optional fields — no consumer breakage
- Parity validator continues to diff legacy vs new output correctly
- `USE_LEGACY_POSTMAN_IMPORTER=true` env flag still available as full import rollback

---

## Section 5: Testing Strategy

### New file: `src/workflow-dsl/__tests__/metadata-sanitizer.test.ts`

Unit tests:
1. `stripExecutionMetadata` removes `position`, `visualGroup`, `hierarchyPath` from all nodes
2. `stripExecutionMetadata` preserves `metadataVersion` + `normalizationSource`
3. `stripExecutionMetadata` is immutable — original envelope unchanged
4. Empty envelope (no nodes) handled safely
5. Envelope with `undefined` metadata fields passes through without error

### Extended: `src/api-runtime/import-engine/__tests__/postman-parser.test.ts`

New unit tests (Postman):
6. `folderHierarchy` builds correct `FolderNode` tree
7. `hierarchyPath` root→leaf order correct per node
8. `visualGroup` = immediate parent folder name
9. `FolderNode.sourceId` populated from `item._postman_id` when present
10. `normalizationSource: 'postman'` set on metadata
11. `metadataVersion: 1` set on metadata
12. `WorkflowAiReadiness` fields computed correctly

New unit tests (OpenAPI):
13. `graphHints` populated from dependency detection result
14. `graphHints.isHeuristic: true` always set
15. `hierarchyPath` = `[tag, operationId]` per node
16. `normalizationSource: 'openapi'` set

### New file: `src/api-runtime/import-engine/__tests__/workflow-metadata.integration.test.ts`

Integration tests:
17. Full Postman JSON → import pipeline → `WorkflowEnvelope` correct hierarchy + metadata
18. Full OpenAPI spec → import pipeline → `WorkflowEnvelope` correct graphHints + metadata
19. Legacy adapter → `normalizationSource: 'legacy'`, all new fields undefined, execution unaffected

20. **Snapshot serialization** — `JSON.stringify` → `JSON.parse` → assert `folderHierarchy`, `graphHints`, `aiReadiness`, `metadataVersion`, `normalizationSource` survive round-trip intact

21. **Execution ignorance** — run `validateCompatibility` on envelope with full metadata vs `stripExecutionMetadata` result. Assert identical `CompatibilityReport`. Formally proves execution is metadata-blind.

22. **Partial metadata tolerance** — envelope with `graphHints` populated, `folderHierarchy: undefined`, `aiReadiness` partially filled. Assert `validateCompatibility` passes, import succeeds, no throw.

23. **Deep hierarchy stress** — Postman collection with 6-level folder nesting. Assert `FolderNode` tree depth correct, `hierarchyPath.length` = 7, no recursion error, `FOLDER_DEPTH_EXCEEDED` warning emitted when depth > `DEFAULT_MAX_FOLDER_DEPTH`.

24. **Compatibility snapshot fixtures** — store three golden fixture files:
    - `fixtures/postman-metadata-snapshot.json` — normalized Postman envelope
    - `fixtures/openapi-metadata-snapshot.json` — normalized OpenAPI envelope
    - `fixtures/legacy-metadata-snapshot.json` — legacy adapter envelope
    
    Integration test asserts import output matches fixture exactly (snapshot test). Prevents silent normalization drift and metadata regressions.

25. **Unknown metadata tolerance** — envelope with extra unknown fields in `metadata` (e.g. `metadata.futureField = 'x'`) passes `validateCompatibility` without error. Runtime validators MUST ignore unknown `metadata.*` fields — no strict-fail on forward-unknown keys. Ensures forward compatibility for future AI metadata evolution without migration pain.

---

## Files Touched

| File | Change |
|------|--------|
| `src/shared-core/contracts/workflow.contract.ts` | Add `WorkflowNormalizationSource`, `FolderNode`, `WorkflowGraphHints`, `WorkflowAiReadiness`; extend `WorkflowMetadata` + `WorkflowNode` |
| `src/api-runtime/import-engine/postman-workflow-mapper.ts` | Populate hierarchy, hierarchyPath, visualGroup, aiReadiness, metadataVersion, normalizationSource |
| `src/api-runtime/import-engine/openapi-parser.ts` | Populate graphHints, hierarchyPath, visualGroup, metadataVersion, normalizationSource |
| `src/workflow-dsl/legacy-adapter.ts` | Set normalizationSource: 'legacy', metadataVersion: 1 |
| `src/workflow-dsl/metadata-sanitizer.ts` | New — stripExecutionMetadata utility |
| `src/api-runtime/workflow-engine/engine.ts` | Add architecture guard comment |
| `src/api-runtime/workflow-engine/dag-builder.ts` | Add architecture guard comment |
| `src/api-runtime/workflow-engine/scheduler-state.ts` | Add architecture guard comment |
| `src/workflow-dsl/__tests__/metadata-sanitizer.test.ts` | New — 5 unit tests |
| `src/api-runtime/import-engine/__tests__/postman-parser.test.ts` | Extend — 11 new unit tests |
| `src/api-runtime/import-engine/__tests__/workflow-metadata.integration.test.ts` | New — 9 integration tests (incl. snapshot + unknown-tolerance) |
| `src/api-runtime/import-engine/__tests__/fixtures/postman-metadata-snapshot.json` | New — golden Postman normalization fixture |
| `src/api-runtime/import-engine/__tests__/fixtures/openapi-metadata-snapshot.json` | New — golden OpenAPI normalization fixture |
| `src/api-runtime/import-engine/__tests__/fixtures/legacy-metadata-snapshot.json` | New — golden legacy adapter fixture |

---

## Serialization Contract

**`WorkflowEnvelope` serialization shape is now a compatibility contract.**

Once Phase D Step 4 ships:
- Field names in `WorkflowMetadata`, `WorkflowNode`, `FolderNode`, `WorkflowGraphHints`, `WorkflowAiReadiness` are **stable identifiers** — rename = breaking change
- `schemaVersion: '1.0'` discriminates the envelope shape for future migrations
- `metadataVersion: number` discriminates the metadata schema for forward/backward compat
- `stripExecutionMetadata` output ordering is deterministic — suitable for snapshot diffing, replay persistence, and worker transfer

Future workers, replay systems, graph UI, and AI enrichment pipelines will depend on this stability. Treat field renames as breaking changes requiring a `metadataVersion` bump.

---

## Non-Goals (Explicitly Out of Scope)

- Graph UI / ReactFlow editor
- Execution engine redesign
- Scheduler redesign
- AI workflow generation
- Distributed execution
- Analytics redesign
- Contract drift engine changes
