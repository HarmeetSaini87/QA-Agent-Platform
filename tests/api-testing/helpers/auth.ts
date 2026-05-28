/**
 * auth.ts — shared auth helpers for API testing specs
 */
import { APIRequestContext, request as pwRequest } from '@playwright/test';

export const BASE = 'http://localhost:3003';
export const ADMIN_USER = 'admin';
export const ADMIN_PASS = 'Admin@123';

/** Login and return an APIRequestContext with session cookie set */
export async function loginAsAdmin(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const res = await ctx.post('/api/auth/login', {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  if (!res.ok()) throw new Error(`Login failed: ${res.status()} ${await res.text()}`);
  return ctx;
}

/** GET default projectId from first project */
export async function getDefaultProjectId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get('/api/projects');
  const data = await res.json() as Array<{ id: string; name: string }>;
  if (!data.length) throw new Error('No projects found — seed data missing');
  return data[0].id;
}

/** Wait for a run to complete (polls /api/api-runs/:runId) */
export async function waitForRun(
  ctx: APIRequestContext,
  runId: string,
  maxMs = 30_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = await ctx.get(`/api/api-runs/${runId}`);
    if (!res.ok()) throw new Error(`Run fetch failed: ${res.status()}`);
    const run = await res.json() as Record<string, unknown>;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'error') return run;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Run ${runId} did not complete within ${maxMs}ms`);
}

/** UUID pattern */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
