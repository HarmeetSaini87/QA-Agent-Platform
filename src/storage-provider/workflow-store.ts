/**
 * workflow-store.ts
 * Lightweight wrapper for WorkflowEnvelope persistence.
 *
 * Storage: data/workflows/<id>.json  (one file per envelope)
 * Rationale: workflows can grow large (many nodes + metadata); keeping them
 * out of the flat api-collections.json array avoids full-array rewrites per save.
 *
 * Phase A: file-per-document pattern — lightweight, no DB needed.
 * Phase B+: swap directory reads/writes for a DB query without changing callers.
 *
 * DEPENDENCY BOUNDARY:
 *   - Callers use WorkflowEnvelope from shared-core/contracts
 *   - Internally reads/writes plain JSON — no Playwright, no Express
 *   - legacy-adapter.ts converts ApiCollection ↔ WorkflowEnvelope at call sites
 *
 * NOTE: Existing ApiCollection storage (api-collections.json) is UNCHANGED.
 * WorkflowEnvelopes are additional artefacts written alongside collections
 * during Phase B+ migration. Phase A code does not call this store.
 */

import * as fs   from 'fs';
import * as path from 'path';
import type { WorkflowEnvelope } from '../shared-core/contracts/workflow.contract';

// ── Directory ─────────────────────────────────────────────────────────────────

function workflowsDir(): string {
  const dir = path.join(path.resolve(process.env.DATA_DIR || 'data'), 'workflows');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function workflowPath(id: string): string {
  return path.join(workflowsDir(), `${id}.json`);
}

// ── Atomic write (same pattern as nlStore.ts) ─────────────────────────────────

function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function saveWorkflow(envelope: WorkflowEnvelope): void {
  atomicWrite(workflowPath(envelope.workflow.id), JSON.stringify(envelope, null, 2));
}

export function loadWorkflow(id: string): WorkflowEnvelope | undefined {
  const file = workflowPath(id);
  if (!fs.existsSync(file)) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as WorkflowEnvelope; }
  catch { return undefined; }
}

export function listWorkflowIds(projectId?: string): string[] {
  const dir = workflowsDir();
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
    : [];

  if (!projectId) return files.map(f => f.replace('.json', ''));

  return files
    .map(f => {
      try {
        const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as WorkflowEnvelope;
        return e.metadata.projectId === projectId ? e.workflow.id : null;
      } catch { return null; }
    })
    .filter((id): id is string => id !== null);
}

export function listWorkflows(projectId?: string): WorkflowEnvelope[] {
  const dir = workflowsDir();
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
    : [];

  return files
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as WorkflowEnvelope; }
      catch { return null; }
    })
    .filter((e): e is WorkflowEnvelope => e !== null)
    .filter(e => !projectId || e.metadata.projectId === projectId);
}

export function deleteWorkflow(id: string): boolean {
  const file = workflowPath(id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function workflowExists(id: string): boolean {
  return fs.existsSync(workflowPath(id));
}
