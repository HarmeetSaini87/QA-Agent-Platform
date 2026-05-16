# Phase D Step 5 — Workflow Graph Projection
**Date:** 2026-05-16
**Status:** Approved
**Scope:** Read-only graph projection contracts, builder, service, and lightweight API endpoint.

---

## Goal

Introduce enterprise-grade workflow graph projection infrastructure that converts `WorkflowEnvelope` into a read-only `GraphProjection` for future ReactFlow visualization, dependency exploration, and hierarchy rendering — WITHOUT changing any runtime execution semantics.

**WorkflowEnvelope remains the ONLY authoritative execution model.**

---

## Non-Goals (explicitly out of scope)

- Graph editing (PATCH endpoints, node drag persistence)
- Graph-driven execution
- Scheduler redesign
- DAG builder changes
- Retry/variable/assertion engine changes
- ReactFlow import into any execution module

---

## Module Structure

```
src/workflow-graph/
  contracts/
    graph.contracts.ts             ← all projection types
  projection/
    graph-projection-builder.ts   ← pure fn: WorkflowEnvelope → GraphProjection
    auto-layout.ts                ← deterministic layer-based grid
    hierarchy-flattener.ts        ← FolderNode tree → HierarchyNode[] (cycle-safe)
    cluster-builder.ts            ← visualGroup + graphHints → GraphClusterProjection[]
    legacy-node-shim.ts           ← ApiTestStep → minimal WorkflowNode shim
  service/
    projection-service.ts         ← orchestrate: retrieve → project → return
    workflow-envelope-adapter.ts  ← getWorkflowEnvelope(collection) abstraction
  routes/
    workflow-graph.routes.ts      ← GET /api/workflows/:collectionId/graph
  __tests__/
    graph-projection-builder.test.ts
    auto-layout.test.ts
    projection-service.test.ts
    graph-projection.integration.test.ts
  index.ts
```

---

## Section 1: Contracts

**File:** `src/workflow-graph/contracts/graph.contracts.ts`

**Isolation rule:** imports ONLY from `src/shared-core/contracts/workflow.contract.ts`. Zero imports from `api-runtime`, `workflow-engine`, `execution-engine`, `scheduler-state`, or any runtime module.

### GraphProjection

```ts
export interface GraphProjection {
  readonly nodes: readonly VisualNode[];
  readonly edges: readonly VisualEdge[];
  readonly hierarchy: HierarchyProjection;
  readonly clusters: readonly GraphClusterProjection[];
  readonly meta: ProjectionMeta;
  readonly warnings?: readonly ProjectionWarning[];
}
```

### VisualNode

```ts
export interface VisualNode {
  readonly id: string;
  readonly label: string;
  readonly nodeType: WorkflowNode['nodeType'];
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly locked?: boolean;
  };
  /** true = position was computed by auto-layout; false/absent = stored position used */
  readonly isAutoPositioned?: boolean;
  readonly layer: number;
  readonly group?: string;
  readonly visualGroup?: string;
  readonly hierarchyPath?: readonly string[];
  readonly disabled?: boolean;
  readonly status?: WorkflowNodeStatus;
  /** Index of this node within its DAG layer — enables stable relayout, replay, AI grouping */
  readonly indexWithinLayer?: number;
}
```

**Position rule:**
- `WorkflowNode.position` present AND `locked !== true` → use stored position, `isAutoPositioned: false`
- `WorkflowNode.position` present AND `locked === true` → use stored position, `isAutoPositioned: false`, auto-layout must not override
- `WorkflowNode.position` absent (regardless of `locked`) → compute auto-layout, `isAutoPositioned: true`

### VisualEdge

```ts
export interface VisualEdge {
  readonly id: string;          // `${source}:${target}:${edgeType}`
  readonly source: string;
  readonly target: string;
  readonly edgeType: 'depends_on' | 'inferred' | 'group';
  /** true = edge is heuristic, not authoritative */
  readonly isHeuristic?: boolean;
}
```

Duplicate suppression key: `source:target:edgeType` — preserves both `depends_on` and `inferred` edges between same node pair.

**Edge ordering rule:** when sorting by `id`, `depends_on` edges must appear before `inferred` edges for the same source:target pair. Sort key: `edgeType` secondary sort (`depends_on` < `inferred` < `group`).

**Inferred edge guard:** only emit when both `source` and `target` node IDs exist in the projected `VisualNode[]`.

### HierarchyProjection

```ts
export interface HierarchyProjection {
  readonly rootId: string | null;
  readonly nodes: readonly HierarchyNode[];
}

export interface HierarchyNode {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly parentId?: string;
  readonly stepIds: readonly string[];
}
```

Flattening: recursive DFS with `visited: Set<string>` cycle guard. Absent `folderHierarchy` → `{ rootId: null, nodes: [] }`.

### GraphClusterProjection

```ts
export interface GraphClusterProjection {
  readonly clusterId: string;   // `${source}:${label}`
  readonly label: string;
  readonly nodeIds: readonly string[];
  readonly source: 'folder' | 'tag' | 'hint';
}
```

Merge key: `source + label` — never merge `folder` and `hint` clusters with same label. Semantics preserved.

### ProjectionMeta

```ts
export interface ProjectionMeta {
  readonly collectionId: string;
  readonly projectedAt: string;           // ISO timestamp — ONLY here, not in nodes/edges
  readonly projectionVersion: number;     // projection contract version, independent of metadataVersion
  readonly projectionStrategy: 'stored' | 'auto-layout' | 'hybrid';
  readonly metadataVersion?: number;
  readonly normalizationSource?: WorkflowNormalizationSource;
  readonly isHeuristic: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly hasHierarchy: boolean;
  readonly hasAiReadiness: boolean;
}
```

`projectionVersion` = `1` for Phase D Step 5. Bumped independently of `WorkflowEnvelope.metadata.version`.

> **⚠️ Compatibility contract:** `ProjectionMeta` is frontend-compatibility-sensitive. Future graph UI, replay UI, and execution overlays will depend on its shape. Field renames or removals are breaking changes. Additions must be optional.

`projectionStrategy`:
- `'stored'` = all nodes had stored positions
- `'auto-layout'` = no stored positions, all computed
- `'hybrid'` = mix of stored and computed

### ProjectionWarning

```ts
export type ProjectionWarningCode =
  | 'LEGACY_NODE_PROJECTION'    // legacyNodes mapped via shim
  | 'MISSING_LAYER_FALLBACK'    // node.layer absent, DAG layer computed or defaulted to 0
  | 'INFERRED_EDGE_DROPPED'     // inferred edge skipped (dangling node ref)
  | 'LARGE_GRAPH_WARNING';      // nodeCount > MAX_GRAPH_NODE_COUNT (500) — projection completes

export interface ProjectionWarning {
  readonly code: ProjectionWarningCode;
  readonly detail?: string;
}
```

---

## Section 2: Projection Builder

**File:** `src/workflow-graph/projection/graph-projection-builder.ts`

**Contract:** `buildGraphProjection(envelope: WorkflowEnvelope, opts: { projectedAt: string }): GraphProjection`

**Size safeguard:** if `nodes.length > MAX_GRAPH_NODE_COUNT` (default `500`), emit `ProjectionWarning` with code `LARGE_GRAPH_WARNING` — projection still completes, no hard fail.

**Purity invariants (must never be violated):**
- No I/O, no async, no storage reads
- No `Date.now()` or `Math.random()` inside builder — `projectedAt` passed in by service
- No random IDs — all IDs derived deterministically from step IDs
- Identical input → identical output (snapshot-safe, replay-safe)

### Node pipeline

1. If `envelope.workflow.nodes` present and non-empty → use directly
2. Else → run `legacyNodeShim(envelope.workflow.legacyNodes)` → emit `LEGACY_NODE_PROJECTION` warning
3. For each node, compute DAG layer: `node.layer ?? computeDagLayer(node, allNodes) ?? 0` — emit `MISSING_LAYER_FALLBACK` if neither present
4. Apply position rule (see VisualNode section)
5. Determine `projectionStrategy` after all nodes processed

**`legacy-node-shim.ts`:** maps `ApiTestStep` → minimal `WorkflowNode` with `nodeType: 'HTTP'`, no position, no visualGroup, empty hierarchyPath.

**`auto-layout.ts`:** `computeAutoLayout(layer: number, indexWithinLayer: number): {x, y}`
- `x = layer * 250`
- `y = indexWithinLayer * 100`
- Pure, no state.

### Edge pipeline

1. `depends_on` edges from `node.dependsOn[]`
2. `inferred` edges from `graphHints.operationEntityMap` — guarded: both source and target must exist in node ID set
3. Dedup via `Set<"source:target:edgeType">`
4. Sort by `id` ascending (determinism)

### Hierarchy pipeline

`hierarchy-flattener.ts`: DFS over `FolderNode` tree, `visited: Set<string>`, backfill `parentId`. Returns `HierarchyNode[]` sorted by `depth` then `id`.

### Cluster pipeline

`cluster-builder.ts`:
1. Group nodes by `visualGroup` → clusters with `source: 'folder'` when `normalizationSource === 'postman'`, `source: 'tag'` when `normalizationSource === 'openapi'`, `source: 'folder'` otherwise
2. Append `graphHints.suggestedGroups` → `source: 'hint'`
3. Merge key: `${source}:${label}` — never cross-merge by label alone
4. Sort by `clusterId` ascending (determinism)

### Output sort (determinism)

- `nodes` sorted by `id`
- `edges` sorted by `id`
- `clusters` sorted by `clusterId`
- `hierarchy.nodes` sorted by `depth` then `id`

---

## Section 3: Service & Endpoint

### workflow-envelope-adapter.ts

```ts
export function getWorkflowEnvelope(collection: ApiCollection): WorkflowEnvelope
```

Wraps `collectionToWorkflow(collection)` today. Future: swap internals for persisted/AI-generated envelopes without touching `ProjectionService`.

### projection-service.ts

```ts
class ProjectionService {
  async getGraphProjection(collectionId: string, ctx: AuthContext): Promise<GraphProjection>
}
```

Steps:
1. Load `ApiCollection` from storage
2. Auth check: mirrors collection-read authorization exactly (no drift allowed)
3. `getWorkflowEnvelope(collection)`
4. `buildGraphProjection(envelope, { projectedAt: new Date().toISOString() })`
5. Debug-log: `[graph-projection] collectionId=${collectionId} duration=${ms}ms nodes=${meta.nodeCount}`
6. Return `GraphProjection`

**Service purity:** orchestrate only. No collection mutation, no position persistence, no AI enrichment, no runtime metadata recalculation.

**Error handling:**

| Condition | HTTP | Code |
|-----------|------|------|
| Collection not found | 404 | — |
| Auth failed | 403 | — |
| Builder throws | 500 | `GRAPH_PROJECTION_FAILED` |

### workflow-graph.routes.ts

```
GET /api/workflows/:collectionId/graph
```

- Middleware: `requireAuth` (same as collection-read — enforced at code level, not convention)
- Response: `{ success: true, data: GraphProjection }`
- Headers: `Cache-Control: no-store, no-cache, must-revalidate`
- No request body, no mutation

Registered into existing Express router. Does not go into collection CRUD route file.

---

## Section 4: Tests

### graph-projection-builder.test.ts (unit)

| # | Scenario |
|---|----------|
| 1 | Nodes with stored positions → `isAutoPositioned: false`, positions preserved |
| 2 | Nodes without positions → auto-layout applied, `isAutoPositioned: true` |
| 3 | `locked: true` + position present → position unchanged |
| 4 | `locked: true` + position absent → auto-layout applied |
| 5 | `legacyNodes` only → valid projection, `LEGACY_NODE_PROJECTION` warning |
| 6 | `dependsOn` → correct `VisualEdge[]` with `edgeType: 'depends_on'` |
| 7 | `graphHints` → inferred edges emitted with `isHeuristic: true` |
| 8 | Inferred edge with dangling node ref → dropped, `INFERRED_EDGE_DROPPED` warning |
| 9 | Duplicate edge (same source:target:edgeType) → deduplicated |
| 10 | Same edge type + different edgeType (depends_on vs inferred) → both kept |
| 11 | `folderHierarchy` → `HierarchyNode[]` with `parentId` backfilled |
| 12 | Circular `FolderNode` ref (defensive) → cycle broken, no infinite loop |
| 13 | `visualGroup` → clusters with correct `source`, correct `nodeIds` |
| 14 | `suggestedGroups` → `source: 'hint'` clusters, not merged with folder clusters |
| 15 | Two calls with identical input → identical output (determinism) |
| 16 | `projectionStrategy: 'stored'` when all positions present |
| 17 | `projectionStrategy: 'auto-layout'` when no positions present |
| 18 | `projectionStrategy: 'hybrid'` when mixed |

### auto-layout.test.ts (unit)

- Layer 0 index 0 → `{x:0, y:0}`
- Increasing layer → increasing x
- Same inputs → identical output (determinism)

### projection-service.test.ts (unit, mocked storage)

- Collection not found → throws 404
- Auth failure → throws 403
- Builder throws → returns 500 with `GRAPH_PROJECTION_FAILED`
- Happy path → `getWorkflowEnvelope` called, `buildGraphProjection` called, result returned unmodified

### graph-projection.integration.test.ts

- Real Postman-imported `WorkflowEnvelope` fixture → `GET /api/workflows/:collectionId/graph`
- Assert: `success: true`, `data.meta.nodeCount` matches fixture node count
- Assert: `Cache-Control: no-store, no-cache, must-revalidate` header present
- Assert: no runtime fields (scheduler, DAG, retry) present in response

### graph-projection.snapshot.test.ts (golden snapshots)

Three golden fixtures persisted under `src/workflow-graph/__tests__/fixtures/`:

| Fixture | Source | Purpose |
|---------|--------|---------|
| `postman-graph-snapshot.json` | Postman-imported envelope | Projection drift, cluster stability, hierarchy |
| `openapi-graph-snapshot.json` | OpenAPI-imported envelope | Tag-based clusters, inferred edges |
| `legacy-graph-snapshot.json` | `legacyNodes`-only envelope | Shim path, LEGACY_NODE_PROJECTION warning |

Each test: `buildGraphProjection(fixture, { projectedAt: FIXED_ISO })` → `toMatchSnapshot()`.

**Snapshot update policy:** snapshots are updated intentionally only (never silently). Any projection shape change requires explicit snapshot regeneration and review.

---

## Backward Compatibility

| Collection type | Behavior |
|-----------------|----------|
| `legacyNodes` only | shim maps to minimal `VisualNode[]`, warns `LEGACY_NODE_PROJECTION` |
| No `folderHierarchy` | `HierarchyProjection { rootId: null, nodes: [] }` |
| No `graphHints` | empty inferred edges, `isHeuristic: false` in meta |
| No `nodes[]`, no positions | full auto-layout, `projectionStrategy: 'auto-layout'` |

---

## Isolation Guarantee

```
WorkflowEnvelope (authoritative)
       ↓
workflow-envelope-adapter.ts
       ↓
buildGraphProjection() — pure, deterministic, no runtime imports
       ↓
GraphProjection (ephemeral, view-only)
       ↓
GET /api/workflows/:collectionId/graph
       ↓
Frontend (ReactFlow-ready, treats projection as read-only view state)
```

Runtime modules (`workflow-engine`, `execution-engine`, `scheduler-state`, `dag-builder`, `retry-engine`) are never imported by any file in `src/workflow-graph/`.
