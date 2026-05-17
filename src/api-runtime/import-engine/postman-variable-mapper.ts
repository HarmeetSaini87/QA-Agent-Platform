/**
 * import-engine/postman-variable-mapper.ts
 * Phase D Step 2 — Normalize Postman variables into variable-engine-compatible ScopedVariable[].
 *
 * INVARIANTS:
 *   - Variables are NEVER pre-resolved at import time (lazy resolution rule).
 *   - {{references}} in values are preserved as-is — variable-engine resolves at runtime.
 *   - Scope hierarchy is preserved: collection → folder → request.
 *   - Sensitive keys are flagged but values are NOT encrypted here (done by apiSecrets.ts at runtime).
 *   - Empty-string values are allowed — variable-engine handles absence vs empty differently.
 *
 * LAZY RESOLUTION RULE (mandatory — matches variable-engine/engine.ts Gate 4):
 *   Variable values MUST NOT be substituted during import.
 *   Why: runtime chaining depends on {{var}} surviving until execution-engine resolves them.
 *   Example: {{authToken}} set by step 1's extraction must be available in step 2's header —
 *   only works if the template string {{authToken}} reaches the executor unmodified.
 */

import type { ScopedVariable, VariableScope } from '../../shared-core/contracts/variable.contract';
import type { ApiVariable } from '../../data/types';
import type { NormalizedPMVariable, ParsedPostmanCollection, FlatRequest } from './postman-parser';
import type { ImportWarning } from './contracts';

// ── Variable map result ───────────────────────────────────────────────────────

export interface PostmanVariableMapping {
  /**
   * Ordered ScopedVariable list for variable-engine.resolveMap().
   * Order: collection (lowest priority) → folder → request (highest).
   * Higher-specificity scopes override lower ones at resolution time.
   */
  scopedVariables: ScopedVariable[];
  /**
   * Flat ApiVariable[] — compatible with ApiCollection.variables.
   * Merged from collection + folder scopes; request-scope vars are NOT here
   * (they belong on ApiTestStep and are handled per-step).
   */
  collectionVariables: ApiVariable[];
  /**
   * Variables referenced in request templates ({{var}}) but not defined
   * in collection or folder scopes. These will be resolved from environment
   * at runtime — emitting info-level warnings only, not errors.
   */
  unresolvedReferences: UnresolvedVariableReference[];
  warnings: ImportWarning[];
}

export interface UnresolvedVariableReference {
  /** Variable name referenced in template */
  key: string;
  /** Request name where the reference appears */
  requestName: string;
  /** Field where reference appears: 'url' | 'header:<name>' | 'body' | 'query:<name>' */
  field: string;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function mapPostmanVariables(
  parsed: ParsedPostmanCollection,
): PostmanVariableMapping {
  const warnings: ImportWarning[] = [];
  const scopedVariables: ScopedVariable[] = [];

  // 1. Collection-scope variables (lowest priority)
  for (const v of parsed.collectionVariables) {
    scopedVariables.push(toScopedVariable(v, 'collection'));
  }

  // 2. Folder-scope variables (per folder; mid priority)
  //    Collected from folderTree recursively
  collectFolderScopedVars(parsed.folderTree, scopedVariables);

  // 3. Build flat ApiVariable[] for ApiCollection.variables
  //    Merge collection + folder; last-write-wins on key conflict (folder overrides collection)
  const collectionVariables = buildCollectionVariables(parsed.collectionVariables, parsed.folderTree);

  // 4. Detect unresolved references across all requests
  const definedKeys = new Set(scopedVariables.map(v => v.key));
  const unresolvedReferences = detectUnresolvedRefs(parsed.requests, definedKeys, warnings);

  return { scopedVariables, collectionVariables, unresolvedReferences, warnings };
}

// ── Folder variable collection ────────────────────────────────────────────────

function collectFolderScopedVars(
  folders: ParsedPostmanCollection['folderTree'],
  out: ScopedVariable[],
): void {
  for (const folder of folders) {
    for (const v of folder.variables) {
      // Folder vars are 'collection' scope from variable-engine perspective
      // (they are statically defined design-time, not per-request)
      out.push(toScopedVariable(v, 'collection'));
    }
    collectFolderScopedVars(folder.childFolders, out);
  }
}

// ── ApiVariable[] build ───────────────────────────────────────────────────────

function buildCollectionVariables(
  collectionVars: NormalizedPMVariable[],
  folderTree: ParsedPostmanCollection['folderTree'],
): ApiVariable[] {
  // Use a Map for last-write-wins merge
  const merged = new Map<string, ApiVariable>();

  for (const v of collectionVars) {
    merged.set(v.key, toApiVariable(v));
  }

  // Folder vars override collection vars on key conflict
  collectFolderApiVars(folderTree, merged);

  return Array.from(merged.values());
}

function collectFolderApiVars(
  folders: ParsedPostmanCollection['folderTree'],
  merged: Map<string, ApiVariable>,
): void {
  for (const folder of folders) {
    for (const v of folder.variables) {
      merged.set(v.key, toApiVariable(v));
    }
    collectFolderApiVars(folder.childFolders, merged);
  }
}

// ── Unresolved reference detection ───────────────────────────────────────────

/**
 * Detect {{var}} references in request templates that have no static definition.
 * These are NOT errors — they may be defined in the runtime ApiEnvironment.
 * Emits info warnings so enterprise UX can surface them for review.
 */
function detectUnresolvedRefs(
  requests: FlatRequest[],
  definedKeys: Set<string>,
  warnings: ImportWarning[],
): UnresolvedVariableReference[] {
  const refs: UnresolvedVariableReference[] = [];
  const emitted = new Set<string>(); // deduplicate per key

  for (const req of requests) {
    // URL
    for (const ref of extractVarRefs(req.url)) {
      if (!definedKeys.has(ref)) {
        if (!emitted.has(ref)) {
          emitted.add(ref);
          warnings.push({
            code: 'PM_VARIABLE_UNRESOLVABLE',
            severity: 'info',
            message: `Variable '{{${ref}}}' is not defined in collection or folder scope; will be resolved from environment at runtime`,
            context: req.name,
          });
        }
        refs.push({ key: ref, requestName: req.name, field: 'url' });
      }
    }

    // Headers
    for (const h of req.headers) {
      for (const ref of extractVarRefs(h.value)) {
        if (!definedKeys.has(ref)) {
          if (!emitted.has(ref)) {
            emitted.add(ref);
            warnings.push({
              code: 'PM_VARIABLE_UNRESOLVABLE',
              severity: 'info',
              message: `Variable '{{${ref}}}' is not defined in collection or folder scope; will be resolved from environment at runtime`,
              context: req.name,
            });
          }
          refs.push({ key: ref, requestName: req.name, field: `header:${h.key}` });
        }
      }
    }

    // Body raw content
    if (req.body.raw) {
      for (const ref of extractVarRefs(req.body.raw)) {
        if (!definedKeys.has(ref)) {
          if (!emitted.has(ref)) {
            emitted.add(ref);
            warnings.push({
              code: 'PM_VARIABLE_UNRESOLVABLE',
              severity: 'info',
              message: `Variable '{{${ref}}}' is not defined in collection or folder scope; will be resolved from environment at runtime`,
              context: req.name,
            });
          }
          refs.push({ key: ref, requestName: req.name, field: 'body' });
        }
      }
    }
  }

  return refs;
}

// ── Variable reference extraction ─────────────────────────────────────────────

// Matches both {{var}} and ${var} — same as variable-engine substitution patterns
const VAR_REF_RE = /\{\{([^}]+)\}\}|\$\{([^}]+)\}/g;

function extractVarRefs(template: string): string[] {
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  VAR_REF_RE.lastIndex = 0;
  while ((m = VAR_REF_RE.exec(template)) !== null) {
    const key = m[1] ?? m[2];
    if (key && !key.startsWith('$dynamic:')) {
      refs.push(key);
    }
  }
  return refs;
}

// ── Type converters ───────────────────────────────────────────────────────────

function toScopedVariable(v: NormalizedPMVariable, scope: VariableScope): ScopedVariable {
  return {
    key: v.key,
    value: v.value, // raw value — NOT pre-resolved
    scope,
    sensitive: v.sensitive,
  };
}

function toApiVariable(v: NormalizedPMVariable): ApiVariable {
  return {
    key: v.key,
    value: v.value, // raw value — NOT pre-resolved
    sensitive: v.sensitive,
  };
}
