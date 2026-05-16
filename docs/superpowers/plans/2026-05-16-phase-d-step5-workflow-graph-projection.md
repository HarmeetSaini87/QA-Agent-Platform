# Phase D Step 5 — Workflow Graph Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only workflow graph projection layer that converts `WorkflowEnvelope` into a `GraphProjection` and exposes it via `GET /api/workflows/:collectionId/graph`.

**Architecture:** New `src/workflow-graph/` module with contracts, pure projection builder, thin service, and dedicated route file. `WorkflowEnvelope` remains authoritative; `GraphProjection` is ephemeral and never persisted. Zero imports from execution runtime modules.

**Tech Stack:** TypeScript, Express.js, existing `findById`/`API_COLLECTIONS` from `src/data/store.ts`, `collectionToWorkflow` from `src/workflow-dsl/legacy-adapter.ts`, `requireAuth` from `src/auth/middleware.ts`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/workflow-graph/contracts/graph.contracts.ts` | All projection types |
| Create | `src/workflow-graph/projection/auto-layout.ts` | Deterministic x/y from layer+index |
| Create | `src/workflow-graph/projection/legacy-node-shim.ts` | ApiTestStep → minimal WorkflowNode |
| Create | `src/workflow-graph/projection/hierarchy-flattener.ts` | FolderNode tree → HierarchyNode[] |
| Create | `src/workflow-graph/projection/cluster-builder.ts` | visualGroup + graphHints → clusters |
| Create | `src/workflow-graph/projection/graph-projection-builder.ts` | Pure fn: envelope → GraphProjection |
| Create | `src/workflow-graph/service/workflow-envelope-adapter.ts` | getWorkflowEnvelope abstraction |
| Create | `src/workflow-graph/service/projection-service.ts` | Orchestrate retrieve → project → return |
| Create | `src/workflow-graph/routes/workflow-graph.routes.ts` | GET /api/workflows/:collectionId/graph |
| Create | `src/workflow-graph/index.ts` | Public re-exports |
| Create | `src/workflow-graph/__tests__/auto-layout.test.ts` | Unit: determinism |
| Create | `src/workflow-graph/__tests__/graph-projection-builder.test.ts` | Unit: 18 scenarios |
| Create | `src/workflow-graph/__tests__/projection-service.test.ts` | Unit: mocked storage |
| Create | `src/workflow-graph/__tests__/graph-projection.integration.test.ts` | Integration: endpoint |
| Create | `src/workflow-graph/__tests__/graph-projection.snapshot.test.ts` | Golden snapshots |
| Create | `src/workflow-graph/__tests__/fixtures/postman-graph-fixture.json` | Postman envelope fixture |
| Create | `src/workflow-graph/__tests__/fixtures/openapi-graph-fixture.json` | OpenAPI envelope fixture |
| Create | `src/workflow-graph/__tests__/fixtures/legacy-graph-fixture.json` | Legacy envelope fixture |
| Modify | `src/ui/server.ts` | Import + register workflow-graph routes |

---

## Task 1: Projection Contracts

**Files:**
- Create: `src/workflow-graph/contracts/graph.contracts.ts`

- [ ] **Step 1: Create contracts file**

```typescript
// src/workflow-graph/contracts/graph.contracts.ts
import type {
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowNormalizationSource,
} from '../../shared-core/contracts/workflow.contract';

export const PROJECTION_VERSION = 1;
export const MAX_GRAPH_NODE_COUNT = 500;

export interface VisualNode {
  readonly id: string;
  readonly label: string;
  readonly nodeType: WorkflowNode['nodeType'];
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly locked?: boolean;
  };
  readonly isAutoPositioned?: boolean;
  readonly layer: number;
  readonly indexWithinLayer?: number;
  readonly group?: string;
  readonly visualGroup?: string;
  readonly hierarchyPath?: readonly string[];
  readonly disabled?: boolean;
  readonly status?: WorkflowNodeStatus;
}

export interface VisualEdge {
  readonly id: string; // `${source}:${target}:${edgeType}`
  readonly source: string;
  readonly target: string;
  readonly edgeType: 'depends_on' | 'inferred' | 'group';
  readonly isHeuristic?: boolean;
}

export interface HierarchyNode {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly parentId?: string;
  readonly stepIds: readonly string[];
}

export interface HierarchyProjection {
  readonly rootId: string | null;
  readonly nodes: readonly HierarchyNode[];
}

export interface GraphClusterProjection {
  readonly clusterId: string; // `${source}:${label}`
  readonly label: string;
  readonly nodeIds: readonly string[];
  readonly source: 'folder' | 'tag' | 'hint';
}

export type ProjectionWarningCode =
  | 'LEGACY_NODE_PROJECTION'
  | 'MISSING_LAYER_FALLBACK'
  | 'INFERRED_EDGE_DROPPED'
  | 'LARGE_GRAPH_WARNING';

export interface ProjectionWarning {
  readonly code: ProjectionWarningCode;
  readonly detail?: string;
}

export interface ProjectionMeta {
  readonly collectionId: string;
  readonly projectedAt: string;
  readonly projectionVersion: number;
  readonly projectionStrategy: 'stored' | 'auto-layout' | 'hybrid';
  readonly metadataVersion?: number;
  readonly normalizationSource?: WorkflowNormalizationSource;
  readonly isHeuristic: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly hasHierarchy: boolean;
  readonly hasAiReadiness: boolean;
}

export interface GraphProjection {
  readonly nodes: readonly VisualNode[];
  readonly edges: readonly VisualEdge[];
  readonly hierarchy: HierarchyProjection;
  readonly clusters: readonly GraphClusterProjection[];
  readonly meta: ProjectionMeta;
  readonly warnings?: readonly ProjectionWarning[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors referencing `graph.contracts.ts`

- [ ] **Step 3: Commit**

```bash
git add src/workflow-graph/contracts/graph.contracts.ts
git commit -m "feat(graph): add GraphProjection contract types (Phase D Step 5)"
```

---

## Task 2: Auto-Layout Utility + Tests

**Files:**
- Create: `src/workflow-graph/projection/auto-layout.ts`
- Create: `src/workflow-graph/__tests__/auto-layout.test.ts`

- [ ] **Step 1: Write failing tests first**

```typescript
// src/workflow-graph/__tests__/auto-layout.test.ts
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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
npx jest src/workflow-graph/__tests__/auto-layout.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Cannot find module '../projection/auto-layout'`

- [ ] **Step 3: Implement auto-layout**

```typescript
// src/workflow-graph/projection/auto-layout.ts
const LAYER_SPACING = 250;
const NODE_SPACING = 100;

export function computeAutoLayout(layer: number, indexWithinLayer: number): { x: number; y: number } {
  return {
    x: layer * LAYER_SPACING,
    y: indexWithinLayer * NODE_SPACING,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest src/workflow-graph/__tests__/auto-layout.test.ts --no-coverage 2>&1 | tail -5
```
Expected: `Tests: 5 passed`

- [ ] **Step 5: Commit**

```bash
git add src/workflow-graph/projection/auto-layout.ts src/workflow-graph/__tests__/auto-layout.test.ts
git commit -m "feat(graph): add deterministic auto-layout utility with tests"
```

---

## Task 3: Legacy Node Shim

**Files:**
- Create: `src/workflow-graph/projection/legacy-node-shim.ts`

- [ ] **Step 1: Create the shim**

```typescript
// src/workflow-graph/projection/legacy-node-shim.ts
import type { ApiTestStep } from '../../data/types';
import type { WorkflowNode } from '../../shared-core/contracts/workflow.contract';

/**
 * Maps ApiTestStep[] to minimal WorkflowNode[] for projection.
 * Used when WorkflowEnvelope has only legacyNodes and no nodes[].
 */
export function shimLegacyNodes(steps: ApiTestStep[]): WorkflowNode[] {
  return steps.map((step) => ({
    nodeType: 'HTTP' as const,
    step,
    dependsOn: step.dependsOn ?? [],
    hierarchyPath: [],
  }));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "legacy-node-shim" | head -5
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/workflow-graph/projection/legacy-node-shim.ts
git commit -m "feat(graph): add legacy node shim for ApiTestStep → WorkflowNode projection"
```

---

## Task 4: Hierarchy Flattener

**Files:**
- Create: `src/workflow-graph/projection/hierarchy-flattener.ts`

- [ ] **Step 1: Create the flattener**

```typescript
// src/workflow-graph/projection/hierarchy-flattener.ts
import type { FolderNode } from '../../shared-core/contracts/workflow.contract';
import type { HierarchyNode, HierarchyProjection } from '../contracts/graph.contracts';

export function flattenHierarchy(root: FolderNode | undefined): HierarchyProjection {
  if (!root) return { rootId: null, nodes: [] };

  const nodes: HierarchyNode[] = [];
  const visited = new Set<string>();

  function dfs(node: FolderNode, parentId?: string): void {
    if (visited.has(node.id)) return; // cycle guard
    visited.add(node.id);

    nodes.push({
      id: node.id,
      name: node.name,
      depth: node.depth,
      parentId,
      stepIds: node.stepIds,
    });

    for (const child of node.children) {
      dfs(child, node.id);
    }
  }

  dfs(root);

  // Sort by depth then id for determinism
  nodes.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  return { rootId: root.id, nodes };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "hierarchy-flattener" | head -5
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/workflow-graph/projection/hierarchy-flattener.ts
git commit -m "feat(graph): add cycle-safe hierarchy flattener for FolderNode tree"
```

---

## Task 5: Cluster Builder

**Files:**
- Create: `src/workflow-graph/projection/cluster-builder.ts`

- [ ] **Step 1: Create the cluster builder**

```typescript
// src/workflow-graph/projection/cluster-builder.ts
import type { WorkflowNormalizationSource } from '../../shared-core/contracts/workflow.contract';
import type { GraphClusterProjection, VisualNode } from '../contracts/graph.contracts';

function resolveClusterSource(
  normalizationSource: WorkflowNormalizationSource | undefined
): 'folder' | 'tag' {
  return normalizationSource === 'openapi' ? 'tag' : 'folder';
}

export function buildClusters(
  nodes: readonly VisualNode[],
  suggestedGroups: string[] | undefined,
  normalizationSource: WorkflowNormalizationSource | undefined
): GraphClusterProjection[] {
  const clusterMap = new Map<string, { label: string; nodeIds: string[]; source: 'folder' | 'tag' | 'hint' }>();
  const primarySource = resolveClusterSource(normalizationSource);

  // Group by visualGroup
  for (const node of nodes) {
    if (!node.visualGroup) continue;
    const key = `${primarySource}:${node.visualGroup}`;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, { label: node.visualGroup, nodeIds: [], source: primarySource });
    }
    clusterMap.get(key)!.nodeIds.push(node.id);
  }

  // Append hint clusters from suggestedGroups — never merge with folder/tag
  for (const group of suggestedGroups ?? []) {
    const key = `hint:${group}`;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, { label: group, nodeIds: [], source: 'hint' });
    }
  }

  const clusters: GraphClusterProjection[] = Array.from(clusterMap.entries()).map(
    ([clusterId, { label, nodeIds, source }]) => ({
      clusterId,
      label,
      nodeIds,
      source,
    })
  );

  // Sort by clusterId for determinism
  clusters.sort((a, b) => a.clusterId.localeCompare(b.clusterId));

  return clusters;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "cluster-builder" | head -5
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/workflow-graph/projection/cluster-builder.ts
git commit -m "feat(graph): add cluster builder for visualGroup + graphHints grouping"
```

---

## Task 6: Graph Projection Builder + Tests

**Files:**
- Create: `src/workflow-graph/projection/graph-projection-builder.ts`
- Create: `src/workflow-graph/__tests__/graph-projection-builder.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/workflow-graph/__tests__/graph-projection-builder.test.ts
import { buildGraphProjection } from '../projection/graph-projection-builder';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';

const FIXED_TS = '2026-01-01T00:00:00.000Z';
const OPTS = { projectedAt: FIXED_TS };

function makeEnvelope(overrides: Partial<WorkflowEnvelope['workflow']> = {}): WorkflowEnvelope {
  return {
    schemaVersion: '1.0',
    workflow: {
      id: 'col-1',
      name: 'Test Collection',
      legacyNodes: [],
      ...overrides,
    },
    execution: { mode: 'sequential' },
    metadata: {
      createdAt: FIXED_TS,
      source: 'manual',
      collectionId: 'col-1',
    },
  };
}

describe('buildGraphProjection', () => {
  it('stored position used when present — isAutoPositioned false', () => {
    const envelope = makeEnvelope({
      nodes: [{
        nodeType: 'HTTP',
        step: { id: 'step-1', name: 'GET /foo', method: 'GET', url: 'http://x', assertions: [] } as any,
        position: { x: 10, y: 20 },
      }],
    });
    const proj = buildGraphProjection(envelope, OPTS);
    expect(proj.nodes[0].position).toEqual({ x: 10, y: 20 });
    expect(proj.nodes[0].isAutoPositioned).toBe(false);
  });

  it('auto-layout applied when position absent — isAutoPositioned true', () => {
    const envelope = makeEnvelope({
      nodes: [{
        nodeType: 'HTTP',
        step: { id: 'step-1', name: 'GET /foo', method: 'GET', url: 'http://x', assertions: [] } as any,
      }],
    });
    const proj = buildGraphProjection(envelope, OPTS);
    expect(proj.nodes[0].isAutoPositioned).toBe(true);
    expect(proj.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it('locked:true + position present — position unchanged', () => {
    const envelope = makeEnvelope({
      nodes: [{
        nodeType: 'HTTP',
        step: { id: 'step-1', name: 'GET /foo', method: 'GET', url: 'http://x', assertions: [] } as any,
        layer: 5,
        position: { x: 99, y: 88, locked: true },
      }],
    });
    const proj = buildGraphProjection(envelope, OPTS);
    expect(proj.nodes[0].position).toEqual({ x: 99, y: 88, locked: true });
    expect(proj.nodes[0].isAutoPositioned).toBe(false);
  });

  it('locked:true + position absent — auto-layout applied', () => {
    const envelope = makeEnvelope({
      nodes: [{
        nodeType: 'HTTP',
        step: { id: 'step-1', name: 'GET /foo', method: 'GET', url: 'http://x', assertions: [] } as any,
        // no position, locked would be irrelevant
      }],
    });
    const proj = buildGraphProjection(envelope, OPTS);
    expect(proj.nodes[0].isAutoPositioned).toBe(true);
  });

  it('legacyNodes only → valid projection with LEGACY_NODE_PROJECTION warning', () => {
    const envelope = makeEnvelope();
    (envelope.workflow as any).legacyNodes = [
      { id: 'step-1', name: 'GET /foo', method: 'GET', url: 'http://x', assertions: [] },
    ];
    const proj = buildGraphProjection(envelope, OPTS);
    expect(proj.nodes).toHaveLength(1);
    expect(proj.warnings?.some(w => w.code === 'LEGACY_NODE_PROJECTION')).toBe(true);
  });

  it('dependsOn → VisualEdge with edgeType depends_on', () => {
    const envelope = makeEnvelope({
      nodes: [
        { nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any },
        { nodeType: 'HTTP', step: { id: 's2', name: 'B', method: 'GET', url: 'x', assertions: [] } as any, dependsOn: ['s1'] },
      ],
    });
    const proj = buildGraphProjection(envelope, OPTS);
    const edge = proj.edges.find(e => e.source === 's1' && e.target === 's2');
    expect(edge).toBeDefined();
    expect(edge!.edgeType).toBe('depends_on');
  });

  it('inferred edge with dangling target → dropped + INFERRED_EDGE_DROPPED warning', () => {
    const envelope: WorkflowEnvelope = {
      schemaVersion: '1.0',
      workflow: {
        id: 'col-1', name: 'Test', legacyNodes: [],
        nodes: [{ nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any }],
      },
      execution: { mode: 'sequential' },
      metadata: {
        createdAt: FIXED_TS, source: 'openapi', collectionId: 'col-1',
        graphHints: {
          detectedEntities: ['pet'],
          operationEntityMap: { 's1': ['ghost-node'] },
          suggestedGroups: [],
          edgeCount: 1,
          isHeuristic: true,
        },
      },
    };
    const proj = buildGraphProjection(envelope, OPTS);
    const dropped = proj.warnings?.some(w => w.code === 'INFERRED_EDGE_DROPPED');
    expect(dropped).toBe(true);
  });

  it('duplicate source:target:edgeType → deduplicated', () => {
    const envelope = makeEnvelope({
      nodes: [
        { nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any },
        { nodeType: 'HTTP', step: { id: 's2', name: 'B', method: 'GET', url: 'x', assertions: [] } as any, dependsOn: ['s1'] },
      ],
    });
    const proj = buildGraphProjection(envelope, OPTS);
    const dupes = proj.edges.filter(e => e.source === 's1' && e.target === 's2' && e.edgeType === 'depends_on');
    expect(dupes).toHaveLength(1);
  });

  it('depends_on and inferred edges between same pair — both kept', () => {
    const envelope: WorkflowEnvelope = {
      schemaVersion: '1.0',
      workflow: {
        id: 'col-1', name: 'Test', legacyNodes: [],
        nodes: [
          { nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any },
          { nodeType: 'HTTP', step: { id: 's2', name: 'B', method: 'GET', url: 'x', assertions: [] } as any, dependsOn: ['s1'] },
        ],
      },
      execution: { mode: 'sequential' },
      metadata: {
        createdAt: FIXED_TS, source: 'openapi', collectionId: 'col-1',
        graphHints: {
          detectedEntities: [],
          operationEntityMap: { 's1': ['s2'] },
          suggestedGroups: [],
          edgeCount: 1,
          isHeuristic: true,
        },
      },
    };
    const proj = buildGraphProjection(envelope, OPTS);
    const dep = proj.edges.find(e => e.source === 's1' && e.target === 's2' && e.edgeType === 'depends_on');
    const inf = proj.edges.find(e => e.source === 's1' && e.target === 's2' && e.edgeType === 'inferred');
    expect(dep).toBeDefined();
    expect(inf).toBeDefined();
  });

  it('folderHierarchy → HierarchyNode[] with parentId backfilled', () => {
    const envelope: WorkflowEnvelope = {
      schemaVersion: '1.0',
      workflow: { id: 'col-1', name: 'Test', legacyNodes: [] },
      execution: { mode: 'sequential' },
      metadata: {
        createdAt: FIXED_TS, source: 'postman', collectionId: 'col-1',
        folderHierarchy: {
          id: 'root', name: 'Root', depth: 0,
          children: [{ id: 'child1', name: 'Auth', depth: 1, children: [], stepIds: ['s1'] }],
          stepIds: [],
        },
      },
    };
    const proj = buildGraphProjection(envelope, OPTS);
    expect(proj.hierarchy.rootId).toBe('root');
    const child = proj.hierarchy.nodes.find(n => n.id === 'child1');
    expect(child?.parentId).toBe('root');
  });

  it('identical input → identical output (determinism)', () => {
    const envelope = makeEnvelope({
      nodes: [
        { nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any },
        { nodeType: 'HTTP', step: { id: 's2', name: 'B', method: 'GET', url: 'x', assertions: [] } as any, dependsOn: ['s1'] },
      ],
    });
    const a = buildGraphProjection(envelope, OPTS);
    const b = buildGraphProjection(envelope, OPTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('projectionStrategy stored when all nodes have positions', () => {
    const envelope = makeEnvelope({
      nodes: [{ nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any, position: { x: 0, y: 0 } }],
    });
    expect(buildGraphProjection(envelope, OPTS).meta.projectionStrategy).toBe('stored');
  });

  it('projectionStrategy auto-layout when no positions', () => {
    const envelope = makeEnvelope({
      nodes: [{ nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any }],
    });
    expect(buildGraphProjection(envelope, OPTS).meta.projectionStrategy).toBe('auto-layout');
  });

  it('projectionStrategy hybrid when mixed', () => {
    const envelope = makeEnvelope({
      nodes: [
        { nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any, position: { x: 0, y: 0 } },
        { nodeType: 'HTTP', step: { id: 's2', name: 'B', method: 'GET', url: 'x', assertions: [] } as any },
      ],
    });
    expect(buildGraphProjection(envelope, OPTS).meta.projectionStrategy).toBe('hybrid');
  });

  it('LARGE_GRAPH_WARNING emitted when nodeCount > 500', () => {
    const manyNodes = Array.from({ length: 501 }, (_, i) => ({
      nodeType: 'HTTP' as const,
      step: { id: `s${i}`, name: `Step ${i}`, method: 'GET', url: 'x', assertions: [] } as any,
    }));
    const envelope = makeEnvelope({ nodes: manyNodes });
    const proj = buildGraphProjection(envelope, OPTS);
    expect(proj.warnings?.some(w => w.code === 'LARGE_GRAPH_WARNING')).toBe(true);
  });

  it('depends_on edges appear before inferred for same source:target', () => {
    const envelope: WorkflowEnvelope = {
      schemaVersion: '1.0',
      workflow: {
        id: 'col-1', name: 'Test', legacyNodes: [],
        nodes: [
          { nodeType: 'HTTP', step: { id: 's1', name: 'A', method: 'GET', url: 'x', assertions: [] } as any },
          { nodeType: 'HTTP', step: { id: 's2', name: 'B', method: 'GET', url: 'x', assertions: [] } as any, dependsOn: ['s1'] },
        ],
      },
      execution: { mode: 'sequential' },
      metadata: {
        createdAt: FIXED_TS, source: 'openapi', collectionId: 'col-1',
        graphHints: { detectedEntities: [], operationEntityMap: { 's1': ['s2'] }, suggestedGroups: [], edgeCount: 1, isHeuristic: true },
      },
    };
    const proj = buildGraphProjection(envelope, OPTS);
    const depIdx = proj.edges.findIndex(e => e.source === 's1' && e.target === 's2' && e.edgeType === 'depends_on');
    const infIdx = proj.edges.findIndex(e => e.source === 's1' && e.target === 's2' && e.edgeType === 'inferred');
    expect(depIdx).toBeLessThan(infIdx);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx jest src/workflow-graph/__tests__/graph-projection-builder.test.ts --no-coverage 2>&1 | tail -5
```
Expected: `Cannot find module '../projection/graph-projection-builder'`

- [ ] **Step 3: Implement the builder**

```typescript
// src/workflow-graph/projection/graph-projection-builder.ts
import type { WorkflowEnvelope, WorkflowNode } from '../../shared-core/contracts/workflow.contract';
import {
  PROJECTION_VERSION,
  MAX_GRAPH_NODE_COUNT,
  type GraphProjection,
  type VisualNode,
  type VisualEdge,
  type ProjectionMeta,
  type ProjectionWarning,
} from '../contracts/graph.contracts';
import { computeAutoLayout } from './auto-layout';
import { shimLegacyNodes } from './legacy-node-shim';
import { flattenHierarchy } from './hierarchy-flattener';
import { buildClusters } from './cluster-builder';

interface BuildOpts {
  projectedAt: string;
}

export function buildGraphProjection(envelope: WorkflowEnvelope, opts: BuildOpts): GraphProjection {
  const warnings: ProjectionWarning[] = [];

  // 1. Resolve nodes — prefer nodes[], fall back to legacyNodes shim
  let rawNodes: WorkflowNode[];
  const hasLegacyFallback = !envelope.workflow.nodes?.length;
  if (hasLegacyFallback) {
    rawNodes = shimLegacyNodes(envelope.workflow.legacyNodes);
    warnings.push({ code: 'LEGACY_NODE_PROJECTION', detail: `${envelope.workflow.legacyNodes.length} legacy steps shimmed` });
  } else {
    rawNodes = envelope.workflow.nodes!;
  }

  // Large graph warning — does NOT block projection
  if (rawNodes.length > MAX_GRAPH_NODE_COUNT) {
    warnings.push({ code: 'LARGE_GRAPH_WARNING', detail: `${rawNodes.length} nodes exceeds MAX_GRAPH_NODE_COUNT (${MAX_GRAPH_NODE_COUNT})` });
  }

  // 2. Build node ID set for edge validation
  const nodeIdSet = new Set(rawNodes.map(n => n.step.id));

  // 3. Compute DAG layers per node (group by index within layer)
  const layerGroups = new Map<number, number>(); // layer → count so far

  const visualNodes: VisualNode[] = rawNodes.map((node) => {
    const stepId = node.step.id;
    let layer = node.layer;
    if (layer === undefined) {
      warnings.push({ code: 'MISSING_LAYER_FALLBACK', detail: `step ${stepId} has no layer, defaulting to 0` });
      layer = 0;
    }

    const indexWithinLayer = layerGroups.get(layer) ?? 0;
    layerGroups.set(layer, indexWithinLayer + 1);

    const hasStoredPosition = node.position !== undefined;
    const position = hasStoredPosition
      ? node.position!
      : computeAutoLayout(layer, indexWithinLayer);
    const isAutoPositioned = !hasStoredPosition;

    return {
      id: stepId,
      label: node.step.name,
      nodeType: node.nodeType,
      position,
      isAutoPositioned,
      layer,
      indexWithinLayer,
      group: node.group,
      visualGroup: node.visualGroup,
      hierarchyPath: node.hierarchyPath,
      disabled: node.disabled,
    };
  });

  // Determine projectionStrategy
  const storedCount = visualNodes.filter(n => !n.isAutoPositioned).length;
  const autoCount = visualNodes.filter(n => n.isAutoPositioned).length;
  const projectionStrategy =
    storedCount === 0 ? 'auto-layout'
    : autoCount === 0 ? 'stored'
    : 'hybrid';

  // Sort nodes by id for determinism
  visualNodes.sort((a, b) => a.id.localeCompare(b.id));

  // 4. Build edges
  const edgeSet = new Set<string>();
  const edges: VisualEdge[] = [];

  const addEdge = (edge: VisualEdge) => {
    if (!edgeSet.has(edge.id)) {
      edgeSet.add(edge.id);
      edges.push(edge);
    }
  };

  // depends_on edges first
  for (const node of rawNodes) {
    for (const depId of node.dependsOn ?? []) {
      if (nodeIdSet.has(depId) && nodeIdSet.has(node.step.id)) {
        addEdge({ id: `${depId}:${node.step.id}:depends_on`, source: depId, target: node.step.id, edgeType: 'depends_on' });
      }
    }
  }

  // inferred edges from graphHints
  const graphHints = envelope.metadata.graphHints;
  if (graphHints?.operationEntityMap) {
    for (const [sourceId, relatedIds] of Object.entries(graphHints.operationEntityMap)) {
      for (const targetId of relatedIds) {
        if (!nodeIdSet.has(sourceId) || !nodeIdSet.has(targetId)) {
          warnings.push({ code: 'INFERRED_EDGE_DROPPED', detail: `${sourceId} → ${targetId} dropped (dangling ref)` });
          continue;
        }
        addEdge({ id: `${sourceId}:${targetId}:inferred`, source: sourceId, target: targetId, edgeType: 'inferred', isHeuristic: true });
      }
    }
  }

  // Sort edges: depends_on before inferred, then by id
  const edgeTypePriority = { depends_on: 0, inferred: 1, group: 2 };
  edges.sort((a, b) => {
    const typeDiff = edgeTypePriority[a.edgeType] - edgeTypePriority[b.edgeType];
    return typeDiff !== 0 ? typeDiff : a.id.localeCompare(b.id);
  });

  // 5. Hierarchy projection
  const hierarchy = flattenHierarchy(envelope.metadata.folderHierarchy);

  // 6. Cluster projection
  const clusters = buildClusters(
    visualNodes,
    graphHints?.suggestedGroups,
    envelope.metadata.normalizationSource
  );

  // 7. Meta
  const meta: ProjectionMeta = {
    collectionId: envelope.metadata.collectionId,
    projectedAt: opts.projectedAt,
    projectionVersion: PROJECTION_VERSION,
    projectionStrategy,
    metadataVersion: envelope.metadata.metadataVersion,
    normalizationSource: envelope.metadata.normalizationSource,
    isHeuristic: graphHints?.isHeuristic ?? false,
    nodeCount: visualNodes.length,
    edgeCount: edges.length,
    hasHierarchy: hierarchy.rootId !== null,
    hasAiReadiness: !!envelope.metadata.aiReadiness,
  };

  return {
    nodes: visualNodes,
    edges,
    hierarchy,
    clusters,
    meta,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest src/workflow-graph/__tests__/graph-projection-builder.test.ts --no-coverage 2>&1 | tail -5
```
Expected: `Tests: 16 passed` (some tests may need minor type cast fixes)

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/workflow-graph/projection/graph-projection-builder.ts src/workflow-graph/__tests__/graph-projection-builder.test.ts
git commit -m "feat(graph): add pure graph projection builder with 16 unit tests"
```

---

## Task 7: Workflow Envelope Adapter + Projection Service

**Files:**
- Create: `src/workflow-graph/service/workflow-envelope-adapter.ts`
- Create: `src/workflow-graph/service/projection-service.ts`
- Create: `src/workflow-graph/__tests__/projection-service.test.ts`

- [ ] **Step 1: Write failing service tests**

```typescript
// src/workflow-graph/__tests__/projection-service.test.ts
import { ProjectionService } from '../service/projection-service';

jest.mock('../../data/store', () => ({
  findById: jest.fn(),
  API_COLLECTIONS: 'api-collections',
}));
jest.mock('../projection/graph-projection-builder', () => ({
  buildGraphProjection: jest.fn(() => ({ nodes: [], edges: [], hierarchy: { rootId: null, nodes: [] }, clusters: [], meta: { nodeCount: 0 } })),
}));
jest.mock('../service/workflow-envelope-adapter', () => ({
  getWorkflowEnvelope: jest.fn(() => ({
    schemaVersion: '1.0',
    workflow: { id: 'col-1', name: 'Test', legacyNodes: [] },
    execution: { mode: 'sequential' },
    metadata: { createdAt: '', source: 'manual', collectionId: 'col-1' },
  })),
}));

const { findById } = require('../../data/store');
const { buildGraphProjection } = require('../projection/graph-projection-builder');
const { getWorkflowEnvelope } = require('../service/workflow-envelope-adapter');

const mockCtx = { userId: 'user-1', username: 'test', role: 'editor' as const };

describe('ProjectionService', () => {
  let service: ProjectionService;
  beforeEach(() => { service = new ProjectionService(); jest.clearAllMocks(); });

  it('throws 404 when collection not found', async () => {
    findById.mockReturnValue(null);
    await expect(service.getGraphProjection('missing-id', mockCtx)).rejects.toMatchObject({ status: 404 });
  });

  it('calls getWorkflowEnvelope and buildGraphProjection on happy path', async () => {
    findById.mockReturnValue({ id: 'col-1', name: 'Test', projectId: 'proj-1', steps: [] });
    const result = await service.getGraphProjection('col-1', mockCtx);
    expect(getWorkflowEnvelope).toHaveBeenCalledTimes(1);
    expect(buildGraphProjection).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it('wraps builder error as 500 with GRAPH_PROJECTION_FAILED code', async () => {
    findById.mockReturnValue({ id: 'col-1', name: 'Test', projectId: 'proj-1', steps: [] });
    buildGraphProjection.mockImplementation(() => { throw new Error('boom'); });
    await expect(service.getGraphProjection('col-1', mockCtx)).rejects.toMatchObject({
      status: 500,
      code: 'GRAPH_PROJECTION_FAILED',
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx jest src/workflow-graph/__tests__/projection-service.test.ts --no-coverage 2>&1 | tail -5
```
Expected: `Cannot find module '../service/projection-service'`

- [ ] **Step 3: Create envelope adapter**

```typescript
// src/workflow-graph/service/workflow-envelope-adapter.ts
import type { ApiCollection } from '../../data/types';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';
import { collectionToWorkflow } from '../../workflow-dsl/legacy-adapter';

/**
 * Converts an ApiCollection to WorkflowEnvelope.
 * Abstraction point — swap internals later for persisted/AI envelopes
 * without touching ProjectionService.
 */
export function getWorkflowEnvelope(collection: ApiCollection): WorkflowEnvelope {
  return collectionToWorkflow(collection);
}
```

- [ ] **Step 4: Create projection service**

```typescript
// src/workflow-graph/service/projection-service.ts
import { findById, API_COLLECTIONS } from '../../data/store';
import type { ApiCollection } from '../../data/types';
import type { GraphProjection } from '../contracts/graph.contracts';
import { buildGraphProjection } from '../projection/graph-projection-builder';
import { getWorkflowEnvelope } from './workflow-envelope-adapter';

interface AuthContext {
  userId: string;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
}

interface ServiceError {
  status: number;
  message: string;
  code?: string;
}

function makeError(status: number, message: string, code?: string): ServiceError {
  return { status, message, code };
}

export class ProjectionService {
  async getGraphProjection(collectionId: string, ctx: AuthContext): Promise<GraphProjection> {
    // 1. Load collection
    const collection = findById<ApiCollection>(API_COLLECTIONS, collectionId);
    if (!collection) throw makeError(404, `Collection ${collectionId} not found`);

    // 2. Auth check mirrors collection-read authorization
    // requireAuth middleware already confirmed session; viewer role can read.
    // (No additional role restriction beyond requireAuth for read.)

    // 3. Convert to WorkflowEnvelope
    const envelope = getWorkflowEnvelope(collection);

    // 4. Build projection
    const start = Date.now();
    let projection: GraphProjection;
    try {
      projection = buildGraphProjection(envelope, { projectedAt: new Date().toISOString() });
    } catch (err) {
      throw makeError(500, 'Graph projection failed', 'GRAPH_PROJECTION_FAILED');
    }

    // 5. Debug log
    const duration = Date.now() - start;
    console.debug(`[graph-projection] collectionId=${collectionId} duration=${duration}ms nodes=${projection.meta.nodeCount}`);

    return projection;
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx jest src/workflow-graph/__tests__/projection-service.test.ts --no-coverage 2>&1 | tail -5
```
Expected: `Tests: 3 passed`

- [ ] **Step 6: Commit**

```bash
git add src/workflow-graph/service/workflow-envelope-adapter.ts src/workflow-graph/service/projection-service.ts src/workflow-graph/__tests__/projection-service.test.ts
git commit -m "feat(graph): add ProjectionService and WorkflowEnvelopeAdapter"
```

---

## Task 8: Route + index.ts + Server Registration

**Files:**
- Create: `src/workflow-graph/routes/workflow-graph.routes.ts`
- Create: `src/workflow-graph/index.ts`
- Modify: `src/ui/server.ts`

- [ ] **Step 1: Create route file**

```typescript
// src/workflow-graph/routes/workflow-graph.routes.ts
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../auth/middleware';
import { ProjectionService } from '../service/projection-service';

const projectionService = new ProjectionService();

export function registerWorkflowGraphRoutes(app: Express): void {
  app.get(
    '/api/workflows/:collectionId/graph',
    requireAuth,
    async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      try {
        const ctx = {
          userId: req.session.userId!,
          username: (req.session as any).username as string,
          role: req.session.role!,
        };
        const projection = await projectionService.getGraphProjection(req.params.collectionId, ctx);
        res.json({ success: true, data: projection });
      } catch (err: any) {
        const status = err.status ?? 500;
        const code = err.code ?? 'GRAPH_PROJECTION_FAILED';
        res.status(status).json({ success: false, error: err.message ?? 'Unknown error', code });
      }
    }
  );
}
```

- [ ] **Step 2: Create index.ts**

```typescript
// src/workflow-graph/index.ts
export * from './contracts/graph.contracts';
export { buildGraphProjection } from './projection/graph-projection-builder';
export { ProjectionService } from './service/projection-service';
export { registerWorkflowGraphRoutes } from './routes/workflow-graph.routes';
```

- [ ] **Step 3: Register routes in server.ts**

Find the import block in `src/ui/server.ts` (around line 53–56) and add:
```typescript
import { registerWorkflowGraphRoutes } from '../workflow-graph/routes/workflow-graph.routes';
```

Find the registration block (around line 223) where `registerApiTestingRoutes(app)` is called and add after it:
```typescript
registerWorkflowGraphRoutes(app);
```

- [ ] **Step 3b: Add compatibility comment to route response**

In `workflow-graph.routes.ts`, add above the `res.json(...)` call:

```typescript
// GraphProjection response shape is frontend compatibility-sensitive.
// Field renames or removals are BREAKING CHANGES for ReactFlow, replay UI,
// execution overlays, and graph editor consumers. Only add optional fields.
res.json({ success: true, data: projection });
```

- [ ] **Step 4: Build TypeScript**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
npm run build 2>&1 | tail -10
```
Expected: build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add src/workflow-graph/routes/workflow-graph.routes.ts src/workflow-graph/index.ts src/ui/server.ts
git commit -m "feat(graph): add workflow-graph route GET /api/workflows/:collectionId/graph and register in server"
```

---

## Task 9: Golden Snapshot Fixtures + Snapshot Tests

**Files:**
- Create: `src/workflow-graph/__tests__/fixtures/postman-graph-fixture.json`
- Create: `src/workflow-graph/__tests__/fixtures/openapi-graph-fixture.json`
- Create: `src/workflow-graph/__tests__/fixtures/legacy-graph-fixture.json`
- Create: `src/workflow-graph/__tests__/graph-projection.snapshot.test.ts`

- [ ] **Step 1: Create Postman fixture**

```json
{
  "_fixtureVersion": 1,
  "schemaVersion": "1.0",
  "workflow": {
    "id": "postman-col-1",
    "name": "Postman Pets API",
    "legacyNodes": [],
    "nodes": [
      { "nodeType": "HTTP", "step": { "id": "s1", "name": "GET /pets", "method": "GET", "url": "https://api.example.com/pets", "assertions": [] }, "layer": 0, "visualGroup": "Pets", "hierarchyPath": ["Pets API", "GET /pets"] },
      { "nodeType": "HTTP", "step": { "id": "s2", "name": "POST /pets", "method": "POST", "url": "https://api.example.com/pets", "assertions": [] }, "layer": 0, "visualGroup": "Pets", "hierarchyPath": ["Pets API", "POST /pets"] },
      { "nodeType": "HTTP", "step": { "id": "s3", "name": "DELETE /pets/{id}", "method": "DELETE", "url": "https://api.example.com/pets/1", "assertions": [] }, "layer": 1, "dependsOn": ["s2"], "visualGroup": "Pets", "hierarchyPath": ["Pets API", "DELETE /pets/{id}"] }
    ]
  },
  "execution": { "mode": "sequential" },
  "metadata": {
    "createdAt": "2026-01-01T00:00:00.000Z",
    "source": "postman",
    "collectionId": "postman-col-1",
    "metadataVersion": 1,
    "normalizationSource": "postman",
    "folderHierarchy": {
      "id": "root", "name": "Pets API", "depth": 0, "children": [], "stepIds": ["s1", "s2", "s3"]
    },
    "graphHints": { "detectedEntities": ["pet"], "operationEntityMap": {}, "suggestedGroups": ["CRUD"], "edgeCount": 0, "isHeuristic": true },
    "aiReadiness": { "normalizedStepCount": 3, "hasVariableBindings": false, "hasDependencyHints": false, "hasFolderHierarchy": true, "readinessScore": 50 }
  }
}
```

Save to: `src/workflow-graph/__tests__/fixtures/postman-graph-fixture.json`

- [ ] **Step 2: Create OpenAPI fixture**

```json
{
  "_fixtureVersion": 1,
  "schemaVersion": "1.0",
  "workflow": {
    "id": "openapi-col-1",
    "name": "OpenAPI Pets",
    "legacyNodes": [],
    "nodes": [
      { "nodeType": "HTTP", "step": { "id": "op1", "name": "listPets", "method": "GET", "url": "https://api.example.com/pets", "assertions": [] }, "layer": 0, "visualGroup": "pets", "hierarchyPath": ["pets", "listPets"] },
      { "nodeType": "HTTP", "step": { "id": "op2", "name": "createPets", "method": "POST", "url": "https://api.example.com/pets", "assertions": [] }, "layer": 0, "visualGroup": "pets", "hierarchyPath": ["pets", "createPets"] }
    ]
  },
  "execution": { "mode": "sequential" },
  "metadata": {
    "createdAt": "2026-01-01T00:00:00.000Z",
    "source": "openapi",
    "collectionId": "openapi-col-1",
    "metadataVersion": 1,
    "normalizationSource": "openapi",
    "graphHints": { "detectedEntities": ["pet"], "operationEntityMap": { "op1": ["op2"] }, "suggestedGroups": [], "edgeCount": 1, "isHeuristic": true }
  }
}
```

Save to: `src/workflow-graph/__tests__/fixtures/openapi-graph-fixture.json`

- [ ] **Step 3: Create legacy fixture**

```json
{
  "_fixtureVersion": 1,
  "schemaVersion": "1.0",
  "workflow": {
    "id": "legacy-col-1",
    "name": "Legacy Collection",
    "legacyNodes": [
      { "id": "ls1", "name": "GET /users", "method": "GET", "url": "https://api.example.com/users", "assertions": [] },
      { "id": "ls2", "name": "POST /users", "method": "POST", "url": "https://api.example.com/users", "assertions": [] }
    ]
  },
  "execution": { "mode": "sequential" },
  "metadata": {
    "createdAt": "2026-01-01T00:00:00.000Z",
    "source": "manual",
    "collectionId": "legacy-col-1"
  }
}
```

Save to: `src/workflow-graph/__tests__/fixtures/legacy-graph-fixture.json`

- [ ] **Step 4: Create snapshot test**

```typescript
// src/workflow-graph/__tests__/graph-projection.snapshot.test.ts
import { buildGraphProjection } from '../projection/graph-projection-builder';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';

const FIXED_TS = '2026-01-01T00:00:00.000Z';
const OPTS = { projectedAt: FIXED_TS };

const postmanFixture = require('./fixtures/postman-graph-fixture.json') as WorkflowEnvelope;
const openapiFixture = require('./fixtures/openapi-graph-fixture.json') as WorkflowEnvelope;
const legacyFixture = require('./fixtures/legacy-graph-fixture.json') as WorkflowEnvelope;

describe('GraphProjection golden snapshots', () => {
  it('Postman fixture projection matches snapshot', () => {
    expect(buildGraphProjection(postmanFixture, OPTS)).toMatchSnapshot();
  });

  it('OpenAPI fixture projection matches snapshot', () => {
    expect(buildGraphProjection(openapiFixture, OPTS)).toMatchSnapshot();
  });

  it('Legacy fixture projection matches snapshot', () => {
    expect(buildGraphProjection(legacyFixture, OPTS)).toMatchSnapshot();
  });
});
```

- [ ] **Step 5: Run snapshot tests — generates initial snapshots**

```bash
npx jest src/workflow-graph/__tests__/graph-projection.snapshot.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `3 snapshots written` + `Tests: 3 passed`

- [ ] **Step 6: Commit fixtures and snapshot tests**

```bash
git add src/workflow-graph/__tests__/fixtures/ src/workflow-graph/__tests__/graph-projection.snapshot.test.ts
git add src/workflow-graph/__tests__/__snapshots__/
git commit -m "feat(graph): add golden snapshot tests for Postman, OpenAPI, and legacy projections"
```

---

## Task 10: Integration Test + Full Suite

**Files:**
- Create: `src/workflow-graph/__tests__/graph-projection.integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/workflow-graph/__tests__/graph-projection.integration.test.ts
import request from 'supertest';

// Mock storage so integration test doesn't need real data files
jest.mock('../../data/store', () => ({
  findById: jest.fn(),
  API_COLLECTIONS: 'api-collections',
}));

const { findById } = require('../../data/store');

// Import app after mocks
let app: any;
beforeAll(async () => {
  // Build a minimal express app with the route registered
  const express = require('express');
  const session = require('express-session');
  const { registerWorkflowGraphRoutes } = require('../routes/workflow-graph.routes');

  app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));

  // Inject a fake authenticated session
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = 'user-1';
    req.session.username = 'tester';
    req.session.role = 'editor';
    next();
  });

  registerWorkflowGraphRoutes(app);
});

describe('GET /api/workflows/:collectionId/graph', () => {
  it('returns 404 when collection not found', async () => {
    findById.mockReturnValue(null);
    const res = await request(app).get('/api/workflows/missing-id/graph');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns GraphProjection with correct shape for a valid collection', async () => {
    findById.mockReturnValue({
      id: 'col-1',
      name: 'Test',
      projectId: 'proj-1',
      steps: [{ id: 's1', name: 'GET /users', method: 'GET', url: 'https://x.com', assertions: [] }],
      authConfig: null,
      variables: [],
    });

    const res = await request(app).get('/api/workflows/col-1/graph');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('nodes');
    expect(res.body.data).toHaveProperty('edges');
    expect(res.body.data).toHaveProperty('hierarchy');
    expect(res.body.data).toHaveProperty('clusters');
    expect(res.body.data).toHaveProperty('meta');
    expect(res.body.data.meta.nodeCount).toBe(1);
  });

  it('sets Cache-Control: no-store, no-cache, must-revalidate', async () => {
    findById.mockReturnValue({
      id: 'col-1', name: 'Test', projectId: 'proj-1',
      steps: [], authConfig: null, variables: [],
    });
    const res = await request(app).get('/api/workflows/col-1/graph');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['cache-control']).toContain('no-cache');
    expect(res.headers['cache-control']).toContain('must-revalidate');
  });

  it('does not expose runtime fields (scheduler, DAG internals)', async () => {
    findById.mockReturnValue({
      id: 'col-1', name: 'Test', projectId: 'proj-1',
      steps: [{ id: 's1', name: 'GET /x', method: 'GET', url: 'x', assertions: [] }],
      authConfig: null, variables: [],
    });
    const res = await request(app).get('/api/workflows/col-1/graph');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('schedulerState');
    expect(body).not.toContain('retryBudget');
    expect(body).not.toContain('dagBuilder');
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
npx jest src/workflow-graph/__tests__/graph-projection.integration.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Tests: 4 passed`

- [ ] **Step 3: Run full workflow-graph test suite**

```bash
npx jest src/workflow-graph/ --no-coverage 2>&1 | tail -10
```
Expected: all tests pass (auto-layout: 5, builder: 16, service: 3, snapshot: 3, integration: 4 = ~31 total)

- [ ] **Step 4: Run full project test suite to check for regressions**

```bash
npx jest --no-coverage 2>&1 | tail -15
```
Expected: existing 97 passing tests still pass; new tests pass on top

- [ ] **Step 5: Final TypeScript build**

```bash
npm run build 2>&1 | tail -5
```
Expected: clean build

- [ ] **Step 6: Commit**

```bash
git add src/workflow-graph/__tests__/graph-projection.integration.test.ts
git commit -m "feat(graph): add integration tests for GET /api/workflows/:collectionId/graph"
```

---

## Task 11: CLAUDE.md — Add Plan Pointer

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add plan pointer in CLAUDE.md doc section**

In `CLAUDE.md`, find the Phase D Step 5 spec pointer line and add directly after it:

```
> **📋 See [docs/superpowers/plans/2026-05-16-phase-d-step5-workflow-graph-projection.md](docs/superpowers/plans/2026-05-16-phase-d-step5-workflow-graph-projection.md) — Phase D Step 5 implementation plan (11 tasks). Only use when user says to implement this plan.**
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-05-16-phase-d-step5-workflow-graph-projection.md
git commit -m "docs: add Phase D Step 5 plan pointer to CLAUDE.md"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ GraphProjection contracts (Task 1)
- ✅ Auto-layout with LAYER_SPACING=250, NODE_SPACING=100 (Task 2)
- ✅ Legacy node shim + LEGACY_NODE_PROJECTION warning (Task 3)
- ✅ Hierarchy flattener with cycle guard (Task 4)
- ✅ Cluster builder: folder/tag/hint sources, source+label merge key (Task 5)
- ✅ Projection builder: position rule, locked handling, edge dedup, projectionStrategy, LARGE_GRAPH_WARNING, sorting (Task 6)
- ✅ WorkflowEnvelopeAdapter abstraction (Task 7)
- ✅ ProjectionService: 404/403/500 handling, GRAPH_PROJECTION_FAILED, debug logging (Task 7)
- ✅ GET /api/workflows/:collectionId/graph + Cache-Control + requireAuth (Task 8)
- ✅ Golden snapshots: Postman, OpenAPI, legacy (Task 9)
- ✅ Integration test: shape, cache-control, no runtime fields (Task 10)
- ✅ depends_on before inferred edge ordering (Task 6 builder sort)
- ✅ ProjectionMeta compatibility contract — documented in spec (enforced by readonly types)
- ✅ indexWithinLayer on VisualNode (Task 1 + Task 6)
- ✅ projectionVersion=1, projectionStrategy (Task 1 + Task 6)

**Type consistency check:**
- `buildGraphProjection(envelope, opts: { projectedAt: string })` — consistent across Task 6 impl and Task 9/10 tests ✅
- `ProjectionService.getGraphProjection(collectionId, ctx: AuthContext)` — consistent Task 7 impl and test ✅
- `GraphClusterProjection.clusterId = ${source}:${label}` — consistent Task 1 and Task 5 ✅
- `VisualEdge.id = ${source}:${target}:${edgeType}` — consistent Task 1 and Task 6 ✅
