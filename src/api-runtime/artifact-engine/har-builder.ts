import * as fs from 'fs';
import * as path from 'path';
import type { ApiStepResult } from '../../data/types';
import type { HarArtifact, HarEntry, ArtifactRef } from '../../shared-core/contracts/artifact.contract';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const HAR_DIR = path.join(DATA_DIR, 'api-har');

function ensureHarDir(): void {
  if (!fs.existsSync(HAR_DIR)) fs.mkdirSync(HAR_DIR, { recursive: true });
}

function headersToArray(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

export function buildHar(
  runId: string,
  collectionId: string,
  stepResults: ApiStepResult[]
): HarArtifact {
  const entries: HarEntry[] = stepResults
    .filter(r => r.request && r.response)
    .map(r => ({
      stepId: r.stepId,
      stepName: r.stepName,
      startedAt: new Date().toISOString(),
      durationMs: r.durationMs,
      request: {
        method: r.request.method,
        url: r.request.url,
        headers: headersToArray(r.request.headers ?? {}),
        bodySize: r.request.body ? JSON.stringify(r.request.body).length : 0,
      },
      response: {
        status: r.response!.status,
        statusText: String(r.response!.status),
        headers: headersToArray(r.response!.headers ?? {}),
        bodySize: r.response!.body ? JSON.stringify(r.response!.body).length : 0,
        bodyTruncated: r.response!.bodyTruncated ?? false,
      },
      timings: { send: 0, wait: r.durationMs, receive: 0 },
    }));

  return {
    harVersion: '1.2',
    runId,
    collectionId,
    createdAt: new Date().toISOString(),
    entries,
  };
}

export async function saveHar(har: HarArtifact): Promise<ArtifactRef> {
  ensureHarDir();
  const filePath = path.join(HAR_DIR, `${har.runId}.har.json`);
  fs.writeFileSync(filePath, JSON.stringify(har, null, 2));
  const stat = fs.statSync(filePath);
  return {
    type: 'har',
    runId: har.runId,
    collectionId: har.collectionId,
    filePath,
    sizeBytes: stat.size,
    createdAt: har.createdAt,
  };
}

export async function loadHar(runId: string): Promise<HarArtifact | undefined> {
  const filePath = path.join(HAR_DIR, `${runId}.har.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HarArtifact;
}
