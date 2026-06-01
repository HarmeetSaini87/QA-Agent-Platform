/**
 * import-engine/postman-dependency-analyzer.ts
 * Phase D Step 2 — Lightweight dependency hint generation for Postman collections.
 *
 * INVARIANTS:
 *   - Produces DependencyDetectionResult only — no DAG synthesis, no runtime orchestration.
 *   - Folder order → sequential hints only; no parallel fan-out inference.
 *   - Variable producer/consumer detection is heuristic; confidence is always 'low' or 'medium'.
 *   - Never modifies step order or dependsOn fields — hints are metadata for future use.
 *   - pm.environment.set/pm.collectionVariables.set → producer hint only (no runtime effect here).
 *
 * WHAT IS PRODUCED:
 *   A. folder-order sequential hints  — requests in same folder are likely ordered
 *   B. entity hints                   — requests sharing a URL entity (e.g. /pets) likely related
 *   C. variable producer/consumer     — step N sets {{var}}, step M uses {{var}} in URL/body
 *   D. id-producer/consumer           — step response likely contains ID used by later steps
 */

import type { DependencyDetectionResult, DependencyHint } from './contracts';
import type { FlatRequest, RawScript } from './postman-parser';

// ── Main entry ────────────────────────────────────────────────────────────────

export function analyzePostmanDependencies(
  requests: FlatRequest[],
): DependencyDetectionResult {
  const hints: DependencyHint[] = [];
  const operationEntityMap: Record<string, string[]> = {};
  const detectedEntities = new Set<string>();

  // Build entity map from URL paths
  for (const req of requests) {
    const entities = extractEntitiesFromUrl(req.url);
    operationEntityMap[req.id] = entities;
    for (const e of entities) detectedEntities.add(e);
  }

  // A. Folder-order sequential hints
  addFolderOrderHints(requests, hints);

  // B. Shared-entity hints
  addEntityHints(requests, operationEntityMap, hints);

  // C. Variable producer/consumer hints (pm.env.set / collection vars)
  addVariableChainHints(requests, hints);

  // D. ID producer/consumer (POST → extract ID → GET/PUT/DELETE /:id)
  addIdChainHints(requests, operationEntityMap, hints);

  return {
    hints,
    detectedEntities: Array.from(detectedEntities),
    operationEntityMap,
  };
}

// ── A. Folder-order sequential hints ─────────────────────────────────────────

function addFolderOrderHints(requests: FlatRequest[], hints: DependencyHint[]): void {
  // Group by folder path
  const byFolder = new Map<string, FlatRequest[]>();
  for (const req of requests) {
    const key = req.folderPath.join(' / ') || '__root__';
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key)!.push(req);
  }

  for (const folderRequests of byFolder.values()) {
    // Sort by order within folder
    const sorted = [...folderRequests].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length - 1; i++) {
      const producer = sorted[i];
      const consumer = sorted[i + 1];
      hints.push({
        kind: 'sequential-tag',
        producerOperationId: producer.id,
        consumerOperationId: consumer.id,
        confidence: 'low',
      });
    }
  }
}

// ── B. Shared-entity hints ────────────────────────────────────────────────────

function addEntityHints(
  requests: FlatRequest[],
  entityMap: Record<string, string[]>,
  hints: DependencyHint[],
): void {
  for (let i = 0; i < requests.length; i++) {
    for (let j = i + 1; j < requests.length; j++) {
      const a = requests[i];
      const b = requests[j];
      const aEntities = entityMap[a.id] ?? [];
      const bEntities = entityMap[b.id] ?? [];
      const shared = aEntities.filter(e => bEntities.includes(e));
      if (shared.length === 0) continue;

      // Only hint if they are different methods (CRUD relationship)
      if (a.method === b.method) continue;

      hints.push({
        kind: 'shared-entity',
        producerOperationId: a.id,
        consumerOperationId: b.id,
        linkField: shared[0],
        confidence: 'low',
      });
    }
  }
}

// ── C. Variable producer/consumer hints ──────────────────────────────────────

function addVariableChainHints(requests: FlatRequest[], hints: DependencyHint[]): void {
  // Detect which steps produce variables via pm.environment.set("key", ...)
  const producers = new Map<string, string>(); // varName → requestId

  for (const req of requests) {
    const producedVars = extractProducedVars(req.scripts);
    for (const varName of producedVars) {
      // First producer wins (execution order)
      if (!producers.has(varName)) {
        producers.set(varName, req.id);
      }
    }
  }

  // Detect which steps consume variables in URL / headers / body
  for (const req of requests) {
    const consumedVars = extractConsumedVars(req);
    for (const varName of consumedVars) {
      const producerId = producers.get(varName);
      if (producerId && producerId !== req.id) {
        hints.push({
          kind: 'id-consumer',
          producerOperationId: producerId,
          consumerOperationId: req.id,
          linkField: varName,
          confidence: 'medium',
        });
      }
    }
  }
}

function extractProducedVars(scripts: RawScript[]): string[] {
  const vars: string[] = [];
  const setPattern = /pm\.(environment|collectionVariables|globals|variables)\.set\s*\(\s*["']([^"']+)["']/g;
  for (const script of scripts) {
    let m: RegExpExecArray | null;
    setPattern.lastIndex = 0;
    while ((m = setPattern.exec(script.source)) !== null) {
      vars.push(m[2]);
    }
  }
  return vars;
}

function extractConsumedVars(req: FlatRequest): string[] {
  const consumed = new Set<string>();
  const varPattern = /\{\{([^}]+)\}\}/g;

  const scan = (s: string) => {
    let m: RegExpExecArray | null;
    varPattern.lastIndex = 0;
    while ((m = varPattern.exec(s)) !== null) {
      consumed.add(m[1]);
    }
  };

  scan(req.url);
  for (const h of req.headers) scan(h.value);
  if (req.body.raw) scan(req.body.raw);
  for (const q of req.queryParams) scan(q.value);

  return Array.from(consumed);
}

// ── D. ID chain hints (POST creates → GET/PUT/DELETE uses) ────────────────────

function addIdChainHints(
  requests: FlatRequest[],
  entityMap: Record<string, string[]>,
  hints: DependencyHint[],
): void {
  const posts = requests.filter(r => r.method === 'POST');
  const consumers = requests.filter(r => ['GET', 'PUT', 'PATCH', 'DELETE'].includes(r.method));

  for (const post of posts) {
    const postEntities = entityMap[post.id] ?? [];
    for (const consumer of consumers) {
      if (consumer.id === post.id) continue;
      const consumerEntities = entityMap[consumer.id] ?? [];
      const sharedEntities = postEntities.filter(e => consumerEntities.includes(e));
      if (sharedEntities.length === 0) continue;

      // Consumer URL contains a path variable ({{id}} / {{entityId}} pattern) on shared entity
      const hasPathVar = /\{\{[a-zA-Z]*[Ii]d[a-zA-Z]*\}\}/.test(consumer.url);
      if (!hasPathVar) continue;

      hints.push({
        kind: 'id-producer',
        producerOperationId: post.id,
        consumerOperationId: consumer.id,
        linkField: sharedEntities[0] + 'Id',
        confidence: 'medium',
      });
    }
  }
}

// ── Entity extraction from URL path ──────────────────────────────────────────

const PATH_VAR_RE = /\{\{[^}]+\}\}/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;

function extractEntitiesFromUrl(url: string): string[] {
  const entities: string[] = [];
  try {
    // Remove protocol+host, strip query string
    let path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    // Replace {{var}} placeholders
    path = path.replace(PATH_VAR_RE, '__var__');
    const segments = path.split('/').filter(s => s && s !== '__var__');

    for (const seg of segments) {
      // Skip numeric IDs, UUIDs, version segments (v1, v2, api)
      if (NUMERIC_RE.test(seg)) continue;
      if (UUID_RE.test(seg)) continue;
      if (/^v\d+$/i.test(seg)) continue;
      if (seg.toLowerCase() === 'api') continue;

      // Singularize naively: remove trailing 's' if > 3 chars
      const entity = seg.length > 3 && seg.endsWith('s') ? seg.slice(0, -1) : seg;
      entities.push(entity.toLowerCase());
    }
  } catch {
    // Non-parseable URL — skip entity extraction
  }
  return [...new Set(entities)]; // deduplicate
}
