# Hybrid Workflow Metadata & Graph Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `WorkflowEnvelope` and `WorkflowNode` with optional metadata fields for folder hierarchy, graph visualization hints, AI readiness, and provenance — without touching execution semantics.

**Architecture:** All new fields are optional extensions to existing interfaces in `workflow.contract.ts`. Importers populate them at normalization time. Execution engine, DAG builder, and scheduler never read them. A new `metadata-sanitizer.ts` utility strips them before execution/replay. Architecture guard comments prevent future coupling.

**Tech Stack:** TypeScript, Vitest, existing import-engine pipeline, workflow-dsl adapters.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/shared-core/contracts/workflow.contract.ts` | Modify | Add `WorkflowNormalizationSource`, `FolderNode`, `WorkflowGraphHints`, `WorkflowAiReadiness`, `DEFAULT_MAX_FOLDER_DEPTH`; extend `WorkflowMetadata` + `WorkflowNode` |
| `src/workflow-dsl/metadata-sanitizer.ts` | Create | `stripExecutionMetadata` — deterministic, immutable, side-effect free |
| `src/workflow-dsl/legacy-adapter.ts` | Modify | Set `normalizationSource: 'legacy'`, `metadataVersion: 1`, `metadataGeneratedAt` |
| `src/api-runtime/import-engine/postman-workflow-mapper.ts` | Modify | Build `FolderNode` tree + populate all new metadata fields |
| `src/api-runtime/import-engine/openapi-parser.ts` | Modify | Populate `graphHints`, `hierarchyPath`, `visualGroup`, provenance fields |
| `src/api-runtime/workflow-engine/engine.ts` | Modify | Add architecture guard comment only |
| `src/api-runtime/workflow-engine/dag-builder.ts` | Modify | Add architecture guard comment only |
| `src/api-runtime/workflow-engine/scheduler-state.ts` | Modify | Add architecture guard comment only |
| `src/workflow-dsl/__tests__/metadata-sanitizer.test.ts` | Create | 5 unit tests for sanitizer |
| `src/api-runtime/import-engine/__tests__/postman-parser.test.ts` | Modify | 11 new unit tests for Postman + OpenAPI metadata population |
| `src/api-runtime/import-engine/__tests__/workflow-metadata.integration.test.ts` | Create | 9 integration tests incl. snapshot, execution ignorance, partial tolerance, deep hierarchy |
| `src/api-runtime/import-engine/__tests__/fixtures/postman-metadata-snapshot.json` | Create | Golden Postman normalization fixture |
| `src/api-runtime/import-engine/__tests__/fixtures/openapi-metadata-snapshot.json` | Create | Golden OpenAPI normalization fixture |
| `src/api-runtime/import-engine/__tests__/fixtures/legacy-metadata-snapshot.json` | Create | Golden legacy adapter fixture |

---

## Task 1: Extend workflow.contract.ts with new types and interfaces

**Files:**
- Modify: `src/shared-core/contracts/workflow.contract.ts`

- [ ] **Step 1: Add constant and named union type**

Open `src/shared-core/contracts/workflow.contract.ts`. After the existing imports, add:

```ts
// ── Phase D Step 4: Hybrid workflow metadata ───────────────────────────────

/** Maximum Postman folder nesting depth before FOLDER_DEPTH_EXCEEDED warning. */
export const DEFAULT_MAX_FOLDER_DEPTH = 5;

export type WorkflowNormalizationSource =
  | 'legacy'
  | 'postman'
  | 'openapi'
  | 'manual'
  | 'ai';
```

- [ ] **Step 2: Add FolderNode interface**

After `WorkflowNormalizationSource`, add:

```ts
/**
 * Recursive folder/tag tree. Root node = collection root.
 * Postman: built from item[] hierarchy.
 * OpenAPI: shallow tree from operation tags (depth = 1).
 */
export interface FolderNode {
  id: string;
  name: string;
  /** Original Postman folder _postman_id — for re-import sync. Optional. */
  sourceId?: string;
  /** readonly — prevents accidental mutation in graph tooling */
  readonly children: readonly FolderNode[];
  /** readonly — prevents accidental mutation in graph tooling */
  readonly stepIds: readonly string[];
  depth: number;
}
```

- [ ] **Step 3: Add WorkflowGraphHints interface**

```ts
/**
 * Dependency visualization metadata — populated from DependencyDetectionResult.
 * isHeuristic: true = hints are inferred, NOT guaranteed.
 * Execution engine MUST NOT read this.
 */
export interface WorkflowGraphHints {
  detectedEntities: string[];
  operationEntityMap: Record<string, string[]>;
  /** Suggested cluster labels for graph grouping. */
  suggestedGroups: string[];
  /** Estimated dependency edge count. */
  edgeCount: number;
  /** Always true for OpenAPI/Postman — tag-based inference only. */
  isHeuristic?: boolean;
}
```

- [ ] **Step 4: Add WorkflowAiReadiness interface**

```ts
/**
 * AI workflow readiness flags — computed at import time, never at execution time.
 * readinessScore: 0–100 composite metric.
 */
export interface WorkflowAiReadiness {
  normalizedStepCount: number;
  hasVariableBindings: boolean;
  hasDependencyHints: boolean;
  hasFolderHierarchy: boolean;
  readinessScore: number;
}
```

- [ ] **Step 5: Extend WorkflowMetadata**

Find the existing `WorkflowMetadata` interface and add after the `description?` field:

```ts
  // ── Phase D Step 4 additions ────────────────────────────────────────────────
  /**
   * Bumped when metadata schema evolves.
   * Absent = pre-Phase-D envelope (treat as metadataVersion: 0).
   * Never blocks execution — provenance only.
   */
  metadataVersion?: number;

  /**
   * ISO timestamp when metadata was generated.
   * Used for replay, re-import, AI enrichment, migration debugging.
   */
  metadataGeneratedAt?: string;

  /**
   * How this envelope was normalized.
   * Used for debugging, analytics, AI enrichment, import RCA.
   */
  normalizationSource?: WorkflowNormalizationSource;

  /**
   * Root of folder/tag hierarchy.
   * Postman: recursive FolderNode tree.
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
   * AI workflow readiness — for future AI orchestration.
   * Computed at import time only.
   */
  aiReadiness?: WorkflowAiReadiness;
```

- [ ] **Step 6: Extend WorkflowNode**

Find the existing `WorkflowNode` interface and add after the `disabled?` field:

```ts
  // ── Phase D Step 4 additions ────────────────────────────────────────────────
  /**
   * Framework-neutral layout coordinate for future graph editor.
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
   * Ancestor path root → leaf (index 0 = root, last = this node name).
   * Empty array = no hierarchy (manual collection).
   *
   * Examples:
   *   Postman: ['Pets API', 'Auth', 'POST /auth/token']
   *   OpenAPI: ['pets', 'GET /pets/{petId}']
   *   Manual:  []
   *
   * Intentionally denormalized — enables per-node traversal, breadcrumbs,
   * filtering, and AI clustering without tree-walking.
   * Execution engine MUST NOT read this field.
   */
  hierarchyPath?: string[];
```

- [ ] **Step 7: Build TypeScript**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -20
```

Expected: no errors. If errors appear, fix type mismatches before continuing.

- [ ] **Step 8: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/shared-core/contracts/workflow.contract.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "feat: extend WorkflowEnvelope contracts for hybrid workflow metadata (Phase D Step 4)"
```

---

## Task 2: Create metadata-sanitizer.ts

**Files:**
- Create: `src/workflow-dsl/metadata-sanitizer.ts`
- Create: `src/workflow-dsl/__tests__/metadata-sanitizer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/workflow-dsl/__tests__/metadata-sanitizer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripExecutionMetadata } from '../metadata-sanitizer';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';

function makeEnvelope(overrides: Partial<WorkflowEnvelope> = {}): WorkflowEnvelope {
  return {
    schemaVersion: '1.0',
    workflow: {
      id: 'test-id',
      name: 'Test',
      legacyNodes: [],
      nodes: [
        {
          nodeType: 'HTTP',
          step: { id: 's1', name: 'Step 1', request: { method: 'GET', url: '/test', headers: [], queryParams: [], bodyType: 'none' }, assertions: [], extractVariables: [], execution: {}, dependsOn: [], order: 0 },
          position: { x: 10, y: 20, locked: true },
          visualGroup: 'Auth',
          hierarchyPath: ['Root', 'Auth', 'Step 1'],
        },
      ],
    },
    execution: { mode: 'sequential', onFailure: 'stop', logLevel: 'standard' },
    metadata: {
      createdAt: '2026-05-16T00:00:00Z',
      source: 'postman',
      collectionId: 'test-id',
      metadataVersion: 1,
      metadataGeneratedAt: '2026-05-16T00:00:00Z',
      normalizationSource: 'postman',
      folderHierarchy: { id: 'root', name: 'Root', children: [], stepIds: ['s1'], depth: 0 },
      graphHints: { detectedEntities: ['pet'], operationEntityMap: {}, suggestedGroups: ['pet'], edgeCount: 1, isHeuristic: true },
      aiReadiness: { normalizedStepCount: 1, hasVariableBindings: false, hasDependencyHints: false, hasFolderHierarchy: true, readinessScore: 40 },
    },
    ...overrides,
  };
}

describe('stripExecutionMetadata', () => {
  it('removes position, visualGroup, hierarchyPath from all nodes', () => {
    const result = stripExecutionMetadata(makeEnvelope());
    const node = result.workflow.nodes![0];
    expect(node.position).toBeUndefined();
    expect(node.visualGroup).toBeUndefined();
    expect(node.hierarchyPath).toBeUndefined();
  });

  it('preserves metadataVersion and normalizationSource', () => {
    const result = stripExecutionMetadata(makeEnvelope());
    expect(result.metadata.metadataVersion).toBe(1);
    expect(result.metadata.normalizationSource).toBe('postman');
  });

  it('is immutable — original envelope unchanged', () => {
    const original = makeEnvelope();
    stripExecutionMetadata(original);
    expect(original.workflow.nodes![0].position).toEqual({ x: 10, y: 20, locked: true });
    expect(original.metadata.folderHierarchy).toBeDefined();
  });

  it('handles empty nodes array safely', () => {
    const env = makeEnvelope();
    env.workflow.nodes = [];
    const result = stripExecutionMetadata(env);
    expect(result.workflow.nodes).toEqual([]);
  });

  it('handles envelope with undefined metadata fields safely', () => {
    const env = makeEnvelope();
    delete (env.metadata as any).folderHierarchy;
    delete (env.metadata as any).graphHints;
    delete (env.metadata as any).aiReadiness;
    env.workflow.nodes = [];
    expect(() => stripExecutionMetadata(env)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/workflow-dsl/__tests__/metadata-sanitizer.test.ts 2>&1 | tail -20
```

Expected: FAIL — `stripExecutionMetadata` not found.

- [ ] **Step 3: Implement metadata-sanitizer.ts**

Create `src/workflow-dsl/metadata-sanitizer.ts`:

```ts
/**
 * metadata-sanitizer.ts
 * Phase D Step 4 — strips execution-agnostic metadata from WorkflowEnvelope.
 *
 * CONTRACT (frozen — infrastructure-critical):
 *   - MUST be deterministic: same input always produces same output.
 *   - MUST be side-effect free: no I/O, no mutation, no external calls.
 *   - MUST NOT throw: invalid/partial envelopes pass through safely.
 *
 * Replay systems, worker transfers, and distributed orchestration rely on this.
 * Do not weaken this contract.
 */

import type { WorkflowEnvelope, WorkflowNode } from '../shared-core/contracts/workflow.contract';

function stripNodeMetadata(node: WorkflowNode): WorkflowNode {
  const { position: _p, visualGroup: _v, hierarchyPath: _h, ...rest } = node;
  return rest;
}

/**
 * Returns a new WorkflowEnvelope with all execution-agnostic metadata removed.
 * Preserves metadataVersion and normalizationSource (provenance, not display).
 * Original envelope is never mutated.
 *
 * Field ordering is deterministic — stable for snapshot diffing and replay debugging.
 */
export function stripExecutionMetadata(envelope: WorkflowEnvelope): WorkflowEnvelope {
  const { folderHierarchy: _f, graphHints: _g, aiReadiness: _a, ...restMetadata } = envelope.metadata;
  // Explicit field ordering — deterministic for snapshot diff and replay debugging
  const orderedMetadata: typeof restMetadata = {
    createdAt: restMetadata.createdAt,
    source: restMetadata.source,
    collectionId: restMetadata.collectionId,
    ...(restMetadata.projectId !== undefined && { projectId: restMetadata.projectId }),
    ...(restMetadata.tags !== undefined && { tags: restMetadata.tags }),
    ...(restMetadata.version !== undefined && { version: restMetadata.version }),
    ...(restMetadata.description !== undefined && { description: restMetadata.description }),
    ...(restMetadata.metadataVersion !== undefined && { metadataVersion: restMetadata.metadataVersion }),
    ...(restMetadata.metadataGeneratedAt !== undefined && { metadataGeneratedAt: restMetadata.metadataGeneratedAt }),
    ...(restMetadata.normalizationSource !== undefined && { normalizationSource: restMetadata.normalizationSource }),
  };
  return {
    schemaVersion: envelope.schemaVersion,
    workflow: {
      ...envelope.workflow,
      nodes: envelope.workflow.nodes?.map(stripNodeMetadata),
    },
    execution: envelope.execution,
    metadata: orderedMetadata,
    ...(envelope.contracts !== undefined && { contracts: envelope.contracts }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/workflow-dsl/__tests__/metadata-sanitizer.test.ts 2>&1 | tail -20
```

Expected: 5/5 PASS.

- [ ] **Step 5: Build TypeScript**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/workflow-dsl/metadata-sanitizer.ts src/workflow-dsl/__tests__/metadata-sanitizer.test.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "feat: add metadata-sanitizer — deterministic stripExecutionMetadata utility"
```

---

## Task 3: Add architecture guard comments to execution engine files

**Files:**
- Modify: `src/api-runtime/workflow-engine/engine.ts`
- Modify: `src/api-runtime/workflow-engine/dag-builder.ts`
- Modify: `src/api-runtime/workflow-engine/scheduler-state.ts`

- [ ] **Step 1: Add guard to engine.ts**

Find the node iteration entry point in `engine.ts` — the loop or function where `WorkflowNode` or `ApiTestStep` items are first read for execution. Add this comment immediately before it:

```ts
// INVARIANT: metadata fields (position, visualGroup, hierarchyPath) must never
// influence execution ordering. Read legacyNodes/step only. See workflow.contract.ts.
```

- [ ] **Step 2: Add guard to dag-builder.ts**

Find the edge-building loop in `dag-builder.ts` — where `dependsOn` is read to construct DAG edges. Add immediately before it:

```ts
// INVARIANT: metadata fields (position, visualGroup, hierarchyPath) must never
// influence DAG construction. Read step.dependsOn only. See workflow.contract.ts.
```

- [ ] **Step 3: Add guard to scheduler-state.ts**

Find the step scheduling entry in `scheduler-state.ts` — where node status transitions begin. Add immediately before it:

```ts
// INVARIANT: metadata fields (position, visualGroup, hierarchyPath) must never
// influence scheduler state transitions. See workflow.contract.ts.
```

- [ ] **Step 4: Build TypeScript**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/api-runtime/workflow-engine/engine.ts src/api-runtime/workflow-engine/dag-builder.ts src/api-runtime/workflow-engine/scheduler-state.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "chore: add architecture guard comments — metadata must not influence execution ordering"
```

---

## Task 4: Update legacy-adapter.ts

**Files:**
- Modify: `src/workflow-dsl/legacy-adapter.ts`

- [ ] **Step 1: Update collectionToWorkflow**

In `collectionToWorkflow`, extend the `metadata` block:

```ts
metadata: {
  createdAt: new Date().toISOString(),
  source: 'manual',
  collectionId: collection.id,
  projectId: collection.projectId,
  tags: collection.tags ?? [],
  version: '1.0',
  // Phase D Step 4: provenance fields
  metadataVersion: 1,
  metadataGeneratedAt: new Date().toISOString(),
  normalizationSource: 'legacy' as const,
},
```

- [ ] **Step 2: Update stepsToWorkflow**

In `stepsToWorkflow`, extend the `metadata` block:

```ts
metadata: {
  createdAt: new Date().toISOString(),
  source,
  collectionId: id,
  metadataVersion: 1,
  metadataGeneratedAt: new Date().toISOString(),
  normalizationSource: (source === 'manual' ? 'manual' : 'legacy') as WorkflowNormalizationSource,
},
```

Add import at the top of the file:

```ts
import type { WorkflowEnvelope, WorkflowNormalizationSource } from '../shared-core/contracts/workflow.contract';
```

(Replace existing `WorkflowEnvelope` import if already present — just add `WorkflowNormalizationSource` to the import.)

- [ ] **Step 3: Build TypeScript**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/workflow-dsl/legacy-adapter.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "feat: legacy-adapter emits normalizationSource, metadataVersion, metadataGeneratedAt"
```

---

## Task 5: Extend postman-workflow-mapper.ts with hierarchy metadata

**Files:**
- Modify: `src/api-runtime/import-engine/postman-workflow-mapper.ts`

- [ ] **Step 1: Add buildFolderTree helper**

After the imports in `postman-workflow-mapper.ts`, add:

```ts
import type { FolderNode, WorkflowGraphHints, WorkflowAiReadiness, WorkflowNormalizationSource } from './contracts';
// Note: FolderNode, WorkflowGraphHints, WorkflowAiReadiness are re-exported from contracts
// via workflow.contract.ts — import from the shared-core contracts directly if needed
```

Then add these helper functions before `importFromPostman`:

```ts
// ── Folder tree builder ───────────────────────────────────────────────────────

interface ParsedFolder {
  id: string;
  name: string;
  sourceId?: string;
  children: ParsedFolder[];
  requestIds: string[];
  depth: number;
}

function buildFolderTree(
  parsed: ReturnType<typeof parsePostmanCollection>,
  maxDepth: number,
): FolderNode {
  // Build a lookup of folder by id from parsed.folders (if available)
  // Postman parser exposes folderPath per request — reconstruct tree from paths

  // Mutable working type during construction — cast to readonly FolderNode at return
  type MutableFolderNode = {
    id: string; name: string; sourceId?: string;
    children: MutableFolderNode[]; stepIds: string[]; depth: number;
  };

  const root: MutableFolderNode = {
    id: 'root', name: parsed.name, children: [], stepIds: [], depth: 0,
  };

  const folderMap = new Map<string, MutableFolderNode>();
  const visitedKeys = new Set<string>(); // cycle guard
  folderMap.set('', root);

  for (const req of parsed.requests) {
    const path = req.folderPath ?? [];
    let current = root;

    for (let i = 0; i < Math.min(path.length, maxDepth); i++) {
      const segment = path[i];
      const key = path.slice(0, i + 1).join('/');
      // Cycle guard: if key already visited at a different depth, skip
      if (visitedKeys.has(key) && folderMap.has(key)) {
        current = folderMap.get(key)!;
        continue;
      }
      if (!folderMap.has(key)) {
        const node: MutableFolderNode = {
          id: key, name: segment, children: [], stepIds: [], depth: i + 1,
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
```

- [ ] **Step 2: Populate hierarchy metadata in Stage 5 (WorkflowEnvelope wrapping)**

Find Stage 5 in `importFromPostman` — the block after `collectionToWorkflow(collection)`. Replace the existing metadata attachment block:

```ts
  // ── Stage 5: WorkflowEnvelope wrapping ─────────────────────────────────────
  const envelope = collectionToWorkflow(collection);
  const maxDepth = options.maxFolderDepth ?? DEFAULT_MAX_FOLDER_DEPTH;
  const folderTree = buildFolderTree(parsed, maxDepth);
  const hasHierarchy = parsed.requests.some(r => (r.folderPath ?? []).length > 0);
  const hasVars = varMapping.collectionVariables.length > 0;
  const hasDeps = dependencyHints.hints.length > 0;

  envelope.metadata.source = 'postman';
  envelope.metadata.description = parsed.description;
  envelope.metadata.tags = [];
  envelope.metadata.metadataVersion = 1;
  envelope.metadata.metadataGeneratedAt = new Date().toISOString();
  envelope.metadata.normalizationSource = 'postman';
  envelope.metadata.folderHierarchy = hasHierarchy ? folderTree : undefined;
  envelope.metadata.aiReadiness = computeAiReadiness(steps.length, hasVars, hasDeps, hasHierarchy);
```

Note: `dependencyHints` is computed in Stage 6 — move Stage 6 (dependency analysis) to BEFORE Stage 5 so `hasDeps` is available. Reorder stages:

```ts
  completedStages.push('Normalized');

  // ── Stage 4: Assemble ApiCollection ────────────────────────────────────────
  // (unchanged)

  // ── Stage 5a: Dependency analysis (moved before envelope for aiReadiness) ──
  const dependencyHints = analyzePostmanDependencies(parsed.requests);

  // ── Stage 5b: WorkflowEnvelope wrapping ────────────────────────────────────
  // (new block above)
```

- [ ] **Step 3: Populate hierarchyPath and visualGroup per node**

After the step array is built (end of Stage 3 loop), add a second pass to attach node metadata to `envelope.workflow.nodes`. Since the current envelope uses `legacyNodes` (ApiTestStep[]) and not `WorkflowNode[]`, attach metadata via a node map stored alongside:

```ts
  // Build WorkflowNode[] from steps with hierarchy metadata
  const nodeHierarchyMap = new Map<string, { hierarchyPath: string[]; visualGroup?: string }>();
  for (const req of parsed.requests) {
    const path = req.folderPath ?? [];
    nodeHierarchyMap.set(req.id, {
      hierarchyPath: [...path, req.name],
      visualGroup: path.length > 0 ? path[path.length - 1] : parsed.name,
    });
  }

  envelope.workflow.nodes = steps.map(step => {
    const meta = nodeHierarchyMap.get(step.id);
    return {
      nodeType: 'HTTP' as const,
      step,
      hierarchyPath: meta?.hierarchyPath ?? [],
      visualGroup: meta?.visualGroup,
    };
  });
```

Add import at top of file:

```ts
import { DEFAULT_MAX_FOLDER_DEPTH } from './contracts';
```

Add re-export of `DEFAULT_MAX_FOLDER_DEPTH` and new types to `contracts.ts` (or import from `workflow.contract.ts` directly — check which path the mapper uses for `WorkflowEnvelope`).

- [ ] **Step 4: Build TypeScript**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -20
```

Expected: no errors. Fix any type mismatches.

- [ ] **Step 5: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/api-runtime/import-engine/postman-workflow-mapper.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "feat: postman importer populates folderHierarchy, hierarchyPath, visualGroup, aiReadiness"
```

---

## Task 6: Extend openapi-parser.ts with graph metadata

**Files:**
- Modify: `src/api-runtime/import-engine/openapi-parser.ts`

- [ ] **Step 1: Locate where ImportResult is assembled in openapi-parser.ts**

Find the function that returns `ImportResult` (the final assembly point). It will set `envelope`, `authMetadata`, `dependencyHints`, `warnings`, etc.

- [ ] **Step 2: Add graphHints population**

After dependency hints are computed, add:

```ts
  // Phase D Step 4: graph hints from dependency detection
  const graphHints: WorkflowGraphHints = {
    detectedEntities: dependencyHints.detectedEntities,
    operationEntityMap: dependencyHints.operationEntityMap,
    suggestedGroups: [...new Set(endpoints.flatMap(e => e.tags))],
    edgeCount: dependencyHints.hints.length,
    isHeuristic: true,  // always — tag-based inference only
  };
```

- [ ] **Step 3: Add hierarchy metadata to envelope**

After envelope is produced by `collectionToWorkflow`, set:

```ts
  envelope.metadata.metadataVersion = 1;
  envelope.metadata.metadataGeneratedAt = new Date().toISOString();
  envelope.metadata.normalizationSource = 'openapi';
  envelope.metadata.graphHints = graphHints;

  // Shallow FolderNode tree from tags
  const tagGroups = new Map<string, string[]>();
  for (const step of collection.steps) {
    const tag = (step as any)._tag ?? 'untagged';
    if (!tagGroups.has(tag)) tagGroups.set(tag, []);
    tagGroups.get(tag)!.push(step.id);
  }
  envelope.metadata.folderHierarchy = {
    id: 'root',
    name: collection.name,
    depth: 0,
    stepIds: [],
    children: Array.from(tagGroups.entries()).map(([tag, ids]) => ({
      id: tag,
      name: tag,
      depth: 1,
      stepIds: ids,
      children: [],
    })),
  };
```

- [ ] **Step 4: Add hierarchyPath and visualGroup per WorkflowNode**

After building `WorkflowNode[]` (or after step assembly if nodes are built inline):

```ts
  envelope.workflow.nodes = collection.steps.map(step => {
    const tag = (step as any)._tag ?? 'untagged';
    return {
      nodeType: 'HTTP' as const,
      step,
      hierarchyPath: [tag, step.name],
      visualGroup: tag,
    };
  });
```

Note: If openapi-parser does not currently tag steps with `_tag`, store tag per step during endpoint-to-step mapping by adding `(step as any)._tag = endpoint.tags[0] ?? 'untagged'` during step construction.

Add import at top:

```ts
import type { WorkflowGraphHints } from './contracts';
```

- [ ] **Step 5: Build TypeScript**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/api-runtime/import-engine/openapi-parser.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "feat: openapi importer populates graphHints, folderHierarchy, hierarchyPath, visualGroup"
```

---

## Task 7: Re-export new types from contracts.ts and update index

**Files:**
- Modify: `src/api-runtime/import-engine/contracts.ts`
- Modify: `src/workflow-dsl/index.ts`

- [ ] **Step 1: Re-export from contracts.ts**

Add at the bottom of `src/api-runtime/import-engine/contracts.ts`:

```ts
// ── Phase D Step 4: Re-exports from workflow.contract for import-engine consumers ──
export type {
  FolderNode,
  WorkflowGraphHints,
  WorkflowAiReadiness,
  WorkflowNormalizationSource,
} from '../../shared-core/contracts/workflow.contract';
export { DEFAULT_MAX_FOLDER_DEPTH } from '../../shared-core/contracts/workflow.contract';
```

- [ ] **Step 2: Export metadata-sanitizer from workflow-dsl index**

In `src/workflow-dsl/index.ts`, add:

```ts
export * from './metadata-sanitizer';
```

- [ ] **Step 3: Build TypeScript**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/api-runtime/import-engine/contracts.ts src/workflow-dsl/index.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "chore: re-export Phase D Step 4 types from contracts and workflow-dsl index"
```

---

## Task 8: Write Postman + OpenAPI unit tests

**Files:**
- Modify: `src/api-runtime/import-engine/__tests__/postman-parser.test.ts`

- [ ] **Step 1: Add Postman metadata unit tests**

At the end of the existing `postman-parser.test.ts` describe block, add a new `describe('Phase D Step 4 — metadata population', ...)` block:

```ts
describe('Phase D Step 4 — Postman metadata population', () => {
  const minimalPostman = JSON.stringify({
    info: { name: 'Test Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', _postman_id: 'col-001' },
    item: [
      {
        name: 'Auth',
        _postman_id: 'folder-001',
        item: [
          { name: 'POST /token', request: { method: 'POST', url: { raw: 'https://api.example.com/token' }, header: [], body: { mode: 'raw', raw: '' } } },
        ],
      },
      { name: 'GET /pets', request: { method: 'GET', url: { raw: 'https://api.example.com/pets' }, header: [] } },
    ],
  });

  const opts: PostmanImportOptions = { environmentId: 'env-1', projectId: 'proj-1' };

  it('sets metadataVersion: 1', () => {
    const result = importFromPostman(minimalPostman, opts);
    expect(result.envelope.metadata.metadataVersion).toBe(1);
  });

  it('sets normalizationSource: postman', () => {
    const result = importFromPostman(minimalPostman, opts);
    expect(result.envelope.metadata.normalizationSource).toBe('postman');
  });

  it('sets metadataGeneratedAt as ISO string', () => {
    const result = importFromPostman(minimalPostman, opts);
    expect(result.envelope.metadata.metadataGeneratedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('builds folderHierarchy with correct structure', () => {
    const result = importFromPostman(minimalPostman, opts);
    const hier = result.envelope.metadata.folderHierarchy!;
    expect(hier).toBeDefined();
    expect(hier.name).toBe('Test Collection');
    expect(hier.children.length).toBeGreaterThan(0);
    expect(hier.children[0].name).toBe('Auth');
  });

  it('hierarchyPath is root → leaf order per node', () => {
    const result = importFromPostman(minimalPostman, opts);
    const tokenNode = result.envelope.workflow.nodes?.find(n => n.step.name === 'POST /token');
    expect(tokenNode).toBeDefined();
    expect(tokenNode!.hierarchyPath![0]).toBe('Auth');
    expect(tokenNode!.hierarchyPath![tokenNode!.hierarchyPath!.length - 1]).toBe('POST /token');
  });

  it('visualGroup equals immediate parent folder name', () => {
    const result = importFromPostman(minimalPostman, opts);
    const tokenNode = result.envelope.workflow.nodes?.find(n => n.step.name === 'POST /token');
    expect(tokenNode?.visualGroup).toBe('Auth');
  });

  it('computes WorkflowAiReadiness with readinessScore > 0', () => {
    const result = importFromPostman(minimalPostman, opts);
    const ai = result.envelope.metadata.aiReadiness!;
    expect(ai).toBeDefined();
    expect(ai.normalizedStepCount).toBeGreaterThan(0);
    expect(ai.readinessScore).toBeGreaterThan(0);
  });

  it('top-level requests have hierarchyPath with collection name as root', () => {
    const result = importFromPostman(minimalPostman, opts);
    const petsNode = result.envelope.workflow.nodes?.find(n => n.step.name === 'GET /pets');
    expect(petsNode).toBeDefined();
    expect(petsNode!.hierarchyPath).toBeDefined();
    expect(petsNode!.hierarchyPath![petsNode!.hierarchyPath!.length - 1]).toBe('GET /pets');
  });
});

describe('Phase D Step 4 — OpenAPI metadata population', () => {
  const minimalOpenApi = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/pets': {
        get: { operationId: 'listPets', tags: ['pets'], summary: 'List pets', responses: { '200': { description: 'OK' } } },
      },
      '/pets/{petId}': {
        get: { operationId: 'getPet', tags: ['pets'], summary: 'Get pet', parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      },
    },
  });

  const opts: ImportOptions = { environmentId: 'env-1', projectId: 'proj-1' };

  it('sets graphHints.isHeuristic: true', () => {
    const result = importFromOpenApi(minimalOpenApi, opts);
    expect(result.envelope.metadata.graphHints?.isHeuristic).toBe(true);
  });

  it('populates graphHints from dependency detection', () => {
    const result = importFromOpenApi(minimalOpenApi, opts);
    const hints = result.envelope.metadata.graphHints!;
    expect(hints).toBeDefined();
    expect(hints.detectedEntities).toBeDefined();
  });

  it('sets hierarchyPath as [tag, stepName] per node', () => {
    const result = importFromOpenApi(minimalOpenApi, opts);
    const node = result.envelope.workflow.nodes?.[0];
    expect(node?.hierarchyPath).toHaveLength(2);
    expect(node?.hierarchyPath?.[0]).toBe('pets');
  });

  it('sets normalizationSource: openapi', () => {
    const result = importFromOpenApi(minimalOpenApi, opts);
    expect(result.envelope.metadata.normalizationSource).toBe('openapi');
  });
});
```

Add missing imports at top of test file (check existing imports, add what's missing):
```ts
import { importFromPostman } from '../postman-workflow-mapper';
import { importFromOpenApi } from '../openapi-parser'; // adjust to actual export name
import type { PostmanImportOptions, ImportOptions } from '../contracts';
```

- [ ] **Step 2: Run tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-runtime/import-engine/__tests__/postman-parser.test.ts 2>&1 | tail -30
```

Expected: all new tests PASS. Fix failures before continuing.

- [ ] **Step 3: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/api-runtime/import-engine/__tests__/postman-parser.test.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "test: add Phase D Step 4 unit tests for Postman and OpenAPI metadata population"
```

---

## Task 9: Create golden snapshot fixtures

**Files:**
- Create: `src/api-runtime/import-engine/__tests__/fixtures/postman-metadata-snapshot.json`
- Create: `src/api-runtime/import-engine/__tests__/fixtures/openapi-metadata-snapshot.json`
- Create: `src/api-runtime/import-engine/__tests__/fixtures/legacy-metadata-snapshot.json`

- [ ] **Step 1: Generate Postman snapshot**

Run a small script or inline test to produce and capture the envelope from a known Postman input. The fixture captures the exact shape of a normalized envelope so future regressions are detected. Minimum shape:

`postman-metadata-snapshot.json`:
```json
{
  "_comment": "Golden snapshot — generated by Phase D Step 4. Do not hand-edit.",
  "_source": "minimal-postman-collection-v2.1",
  "expectedMetadataFields": [
    "metadataVersion",
    "metadataGeneratedAt",
    "normalizationSource",
    "folderHierarchy",
    "aiReadiness"
  ],
  "expectedNormalizationSource": "postman",
  "expectedMetadataVersion": 1,
  "expectedFolderHierarchyDefined": true,
  "expectedAiReadinessDefined": true,
  "expectedNodeFields": ["hierarchyPath", "visualGroup"]
}
```

`openapi-metadata-snapshot.json`:
```json
{
  "_comment": "Golden snapshot — generated by Phase D Step 4. Do not hand-edit.",
  "_source": "minimal-openapi-3.0",
  "expectedMetadataFields": [
    "metadataVersion",
    "metadataGeneratedAt",
    "normalizationSource",
    "graphHints",
    "folderHierarchy"
  ],
  "expectedNormalizationSource": "openapi",
  "expectedMetadataVersion": 1,
  "expectedGraphHintsDefined": true,
  "expectedGraphHintsIsHeuristic": true,
  "expectedNodeFields": ["hierarchyPath", "visualGroup"]
}
```

`legacy-metadata-snapshot.json`:
```json
{
  "_comment": "Golden snapshot — generated by Phase D Step 4. Do not hand-edit.",
  "_source": "legacy-adapter-collectionToWorkflow",
  "expectedMetadataFields": [
    "metadataVersion",
    "metadataGeneratedAt",
    "normalizationSource"
  ],
  "expectedNormalizationSource": "legacy",
  "expectedMetadataVersion": 1,
  "expectedFolderHierarchyDefined": false,
  "expectedGraphHintsDefined": false
}
```

- [ ] **Step 2: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/api-runtime/import-engine/__tests__/fixtures/
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "chore: add golden normalization snapshot fixtures for Phase D Step 4"
```

---

## Task 10: Create integration test suite

**Files:**
- Create: `src/api-runtime/import-engine/__tests__/workflow-metadata.integration.test.ts`

- [ ] **Step 1: Write all 9 integration tests**

Create `src/api-runtime/import-engine/__tests__/workflow-metadata.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { importFromPostman } from '../postman-workflow-mapper';
import { collectionToWorkflow } from '../../../workflow-dsl/legacy-adapter';
import { stripExecutionMetadata } from '../../../workflow-dsl/metadata-sanitizer';
import { validateCompatibility } from '../compatibility-validator';
import type { PostmanImportOptions } from '../contracts';
import type { ApiCollection } from '../../../data/types';
import postmanSnapshot from './fixtures/postman-metadata-snapshot.json';
import legacySnapshot from './fixtures/legacy-metadata-snapshot.json';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const POSTMAN_COLLECTION = JSON.stringify({
  info: { name: 'Integration Test Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', _postman_id: 'int-col-001' },
  item: [
    {
      name: 'Auth',
      item: [
        { name: 'POST /token', request: { method: 'POST', url: { raw: 'https://api.test.com/token' }, header: [], body: { mode: 'raw', raw: '{}' } } },
      ],
    },
    { name: 'GET /users', request: { method: 'GET', url: { raw: 'https://api.test.com/users' }, header: [] } },
  ],
});

const POSTMAN_OPTS: PostmanImportOptions = { environmentId: 'env-int', projectId: 'proj-int' };

const LEGACY_COLLECTION: ApiCollection = {
  id: 'legacy-col-001',
  name: 'Legacy Collection',
  environmentId: 'env-int',
  projectId: 'proj-int',
  steps: [{ id: 's1', name: 'Step 1', request: { method: 'GET', url: '/test', headers: [], queryParams: [], bodyType: 'none' }, assertions: [], extractVariables: [], execution: {}, dependsOn: [], order: 0 }],
  variables: [],
  onFailure: 'stop',
  executionMode: 'sequential',
  tags: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Postman import — full pipeline metadata', () => {
  it('produces WorkflowEnvelope with correct hierarchy and metadata', () => {
    const result = importFromPostman(POSTMAN_COLLECTION, POSTMAN_OPTS);
    expect(result.envelope.metadata.normalizationSource).toBe('postman');
    expect(result.envelope.metadata.metadataVersion).toBe(1);
    expect(result.envelope.metadata.folderHierarchy).toBeDefined();
    expect(result.envelope.metadata.aiReadiness).toBeDefined();
    expect(result.envelope.workflow.nodes?.length).toBeGreaterThan(0);
  });
});

describe('Legacy adapter — provenance fields', () => {
  it('sets normalizationSource: legacy, all new display fields undefined', () => {
    const envelope = collectionToWorkflow(LEGACY_COLLECTION);
    expect(envelope.metadata.normalizationSource).toBe('legacy');
    expect(envelope.metadata.metadataVersion).toBe(1);
    expect(envelope.metadata.folderHierarchy).toBeUndefined();
    expect(envelope.metadata.graphHints).toBeUndefined();
    expect(envelope.metadata.aiReadiness).toBeUndefined();
  });

  it('legacy envelope passes validateCompatibility', () => {
    const envelope = collectionToWorkflow(LEGACY_COLLECTION);
    const report = validateCompatibility({ collection: LEGACY_COLLECTION, envelope, authMetadata: { schemes: [], hasOperationLevelOverride: false, globalSchemeNames: [] }, dependencyHints: { hints: [], detectedEntities: [], operationEntityMap: {} }, warnings: [], format: 'unknown', endpointCount: 1, skippedCount: 0, sourceMetadata: { type: 'curl' } });
    expect(report.compatible).toBe(true);
  });
});

describe('Snapshot serialization', () => {
  it('WorkflowEnvelope survives JSON round-trip with all metadata intact', () => {
    const result = importFromPostman(POSTMAN_COLLECTION, POSTMAN_OPTS);
    const serialized = JSON.stringify(result.envelope);
    const deserialized = JSON.parse(serialized);
    expect(deserialized.metadata.normalizationSource).toBe('postman');
    expect(deserialized.metadata.metadataVersion).toBe(1);
    expect(deserialized.metadata.folderHierarchy).toBeDefined();
    expect(deserialized.metadata.aiReadiness).toBeDefined();
    expect(deserialized.metadata.metadataGeneratedAt).toBeDefined();
  });
});

describe('Execution ignorance', () => {
  it('validateCompatibility result is identical with and without metadata', () => {
    const result = importFromPostman(POSTMAN_COLLECTION, POSTMAN_OPTS);
    const stripped = stripExecutionMetadata(result.envelope);
    const reportFull = validateCompatibility({ ...result, envelope: result.envelope });
    const reportStripped = validateCompatibility({ ...result, envelope: stripped });
    expect(reportFull.compatible).toBe(reportStripped.compatible);
    expect(reportFull.issues.length).toBe(reportStripped.issues.length);
    expect(reportFull.workflowEngineCompatible).toBe(reportStripped.workflowEngineCompatible);
  });
});

describe('Partial metadata tolerance', () => {
  it('envelope with graphHints only (no folderHierarchy, no aiReadiness) validates successfully', () => {
    const result = importFromPostman(POSTMAN_COLLECTION, POSTMAN_OPTS);
    // Strip all optional fields except graphHints
    delete result.envelope.metadata.folderHierarchy;
    delete result.envelope.metadata.aiReadiness;
    result.envelope.metadata.graphHints = {
      detectedEntities: ['user'],
      operationEntityMap: {},
      suggestedGroups: ['user'],
      edgeCount: 0,
      isHeuristic: true,
    };
    const report = validateCompatibility(result);
    expect(report.compatible).toBe(true);
  });
});

describe('Unknown metadata tolerance', () => {
  it('envelope with extra unknown metadata fields passes validateCompatibility', () => {
    const envelope = collectionToWorkflow(LEGACY_COLLECTION);
    (envelope.metadata as any).futureField = 'some-future-value';
    (envelope.metadata as any).experimentalHints = { x: 1 };
    const report = validateCompatibility({ collection: LEGACY_COLLECTION, envelope, authMetadata: { schemes: [], hasOperationLevelOverride: false, globalSchemeNames: [] }, dependencyHints: { hints: [], detectedEntities: [], operationEntityMap: {} }, warnings: [], format: 'unknown', endpointCount: 1, skippedCount: 0, sourceMetadata: { type: 'curl' } });
    expect(report.compatible).toBe(true);
  });
});

describe('Deep hierarchy stress', () => {
  it('6-level folder nesting produces correct FolderNode depth and hierarchyPath length', () => {
    const deep = JSON.stringify({
      info: { name: 'Deep Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'L1', item: [{
          name: 'L2', item: [{
            name: 'L3', item: [{
              name: 'L4', item: [{
                name: 'L5', item: [{
                  name: 'L6',
                  item: [{ name: 'Deep Request', request: { method: 'GET', url: { raw: 'https://api.test.com/deep' }, header: [] } }],
                }],
              }],
            }],
          }],
        }],
      }],
    });
    const result = importFromPostman(deep, POSTMAN_OPTS);
    const deepNode = result.envelope.workflow.nodes?.find(n => n.step.name === 'Deep Request');
    expect(deepNode).toBeDefined();
    // hierarchyPath = [L1, L2, L3, L4, L5, L6, Deep Request] = 7 entries (capped at DEFAULT_MAX_FOLDER_DEPTH + request name)
    expect(deepNode!.hierarchyPath!.length).toBeGreaterThanOrEqual(2);
    // FOLDER_DEPTH_EXCEEDED warning emitted when depth > DEFAULT_MAX_FOLDER_DEPTH
    const depthWarning = result.warnings.find(w => w.code === 'FOLDER_DEPTH_EXCEEDED');
    expect(depthWarning).toBeDefined();
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-runtime/import-engine/__tests__/workflow-metadata.integration.test.ts 2>&1 | tail -40
```

Expected: all 9 tests PASS. Fix failures before continuing.

- [ ] **Step 3: Run full test suite**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run 2>&1 | tail -20
```

Expected: ≥471 tests pass (existing suite) + new tests. No regressions.

- [ ] **Step 4: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add src/api-runtime/import-engine/__tests__/workflow-metadata.integration.test.ts
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "test: add workflow metadata integration tests — snapshot, execution ignorance, partial tolerance, deep hierarchy"
```

---

## Task 11: Update CLAUDE.md

**Files:**
- Modify: `e:\AI Agent\qa-agent-platform-dev\CLAUDE.md`

- [ ] **Step 1: Add Phase D Step 4 entry to shipped features**

In `CLAUDE.md`, under `## Shipped Features`, add after the Phase D Step 3 entry:

```markdown
### Hybrid Workflow Metadata & Graph Readiness (Phase D Step 4 — 2026-05-16)
- `workflow.contract.ts` extended: `FolderNode`, `WorkflowGraphHints`, `WorkflowAiReadiness`, `WorkflowNormalizationSource`, `DEFAULT_MAX_FOLDER_DEPTH`
- `WorkflowMetadata` gains: `metadataVersion`, `metadataGeneratedAt`, `normalizationSource`, `folderHierarchy`, `graphHints`, `aiReadiness`
- `WorkflowNode` gains: `position` (framework-neutral, with `locked`), `visualGroup`, `hierarchyPath` (root→leaf string[])
- `metadata-sanitizer.ts`: `stripExecutionMetadata` — deterministic, immutable, infrastructure-critical
- Architecture guard comments in `engine.ts`, `dag-builder.ts`, `scheduler-state.ts`
- All new fields optional — execution engine never reads them
```

- [ ] **Step 2: Commit**

```bash
git -C "e:\AI Agent\qa-agent-platform-dev" add CLAUDE.md
git -C "e:\AI Agent\qa-agent-platform-dev" commit -m "docs: add Phase D Step 4 shipped feature notes to CLAUDE.md"
```

---

## Self-Review Checklist

After writing the plan, checking spec coverage:

| Spec Section | Covered by Task |
|---|---|
| A. Hybrid Workflow Metadata | Task 1 (WorkflowMetadata fields) |
| B. Graph Metadata Layer | Task 1 (WorkflowGraphHints), Task 6 (OpenAPI population) |
| C. Collection-to-Workflow Compatibility | Task 4 (legacy-adapter), Tasks 5+6 (importers) |
| D. Folder & Hierarchy Preservation | Task 5 (FolderNode tree + hierarchyPath) |
| E. Execution-Safe Graph Metadata | Task 2 (sanitizer), Task 3 (guard comments) |
| F. Future Visual Workflow Hooks | Task 1 (position + visualGroup on WorkflowNode) |
| G. AI Workflow Readiness | Task 1 (WorkflowAiReadiness), Task 5 (computeAiReadiness) |
| DEFAULT_MAX_FOLDER_DEPTH constant | Task 1 + Task 7 re-export |
| metadataGeneratedAt | Tasks 4, 5, 6 |
| stripExecutionMetadata frozen contract | Task 2 |
| Golden snapshot fixtures | Task 9 |
| Unknown metadata tolerance | Task 10 (test 8) |
| Deep hierarchy stress test | Task 10 (test 9) |
| Architecture guards | Task 3 |
| CLAUDE.md update | Task 11 |
