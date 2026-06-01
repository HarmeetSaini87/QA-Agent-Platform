import * as fs from 'fs';
import * as path from 'path';
import type { ApiCollectionRunResult, ApiResponseSnapshot } from '../../data/types';
import type {
  IArtifactEngine, ArtifactRef, ArtifactType,
  HarArtifact, ExecutionTimeline,
} from '../../shared-core/contracts/artifact.contract';
import type { ExecutionSnapshot } from '../../shared-core/contracts/dependency-graph.contract';
import { saveRunResult, savePartialRunResult, loadRunResult, RUNS_DIR } from './run-store';
import { saveHar, loadHar } from './har-builder';
import { saveTimeline, loadTimeline } from './timeline-builder';
import { saveExecutionSnapshot, loadExecutionSnapshot, SNAPSHOTS_DIR } from './execution-store';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const BASELINES_DIR = path.join(DATA_DIR, 'api-baselines');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

class ArtifactEngine implements IArtifactEngine {
  async saveRunResult(result: ApiCollectionRunResult): Promise<ArtifactRef> {
    return saveRunResult(result);
  }

  async loadRunResult(runId: string): Promise<ApiCollectionRunResult | undefined> {
    return loadRunResult(runId);
  }

  async saveBaseline(collectionId: string, stepId: string, snapshot: ApiResponseSnapshot): Promise<ArtifactRef> {
    ensureDir(BASELINES_DIR);
    const filePath = path.join(BASELINES_DIR, `${collectionId}_${stepId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
    const stat = fs.statSync(filePath);
    return {
      type: 'baseline',
      runId: '',
      collectionId,
      stepId,
      filePath,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    };
  }

  async loadBaseline(collectionId: string, stepId: string): Promise<ApiResponseSnapshot | undefined> {
    const filePath = path.join(BASELINES_DIR, `${collectionId}_${stepId}.json`);
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ApiResponseSnapshot;
  }

  async saveExecutionSnapshot(snapshot: ExecutionSnapshot): Promise<ArtifactRef> {
    return saveExecutionSnapshot(snapshot);
  }

  async loadExecutionSnapshot(runId: string): Promise<ExecutionSnapshot | undefined> {
    return loadExecutionSnapshot(runId);
  }

  async saveHar(har: HarArtifact): Promise<ArtifactRef> {
    return saveHar(har);
  }

  async loadHar(runId: string): Promise<HarArtifact | undefined> {
    return loadHar(runId);
  }

  async saveTimeline(timeline: ExecutionTimeline): Promise<ArtifactRef> {
    return saveTimeline(timeline);
  }

  async loadTimeline(runId: string): Promise<ExecutionTimeline | undefined> {
    return loadTimeline(runId);
  }

  async listArtifacts(collectionId: string, type?: ArtifactType): Promise<ArtifactRef[]> {
    const dirs: Array<{ dir: string; type: ArtifactType; ext: string }> = [
      { dir: RUNS_DIR, type: 'run-result', ext: '.json' },
      { dir: BASELINES_DIR, type: 'baseline', ext: '.json' },
      { dir: SNAPSHOTS_DIR, type: 'execution-snapshot', ext: '.snapshot.json' },
      { dir: path.join(DATA_DIR, 'api-har'), type: 'har', ext: '.har.json' },
      { dir: path.join(DATA_DIR, 'api-timelines'), type: 'timeline', ext: '.timeline.json' },
    ];

    const refs: ArtifactRef[] = [];
    for (const { dir, type: t, ext } of dirs) {
      if (type && type !== t) continue;
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith(ext));
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        refs.push({
          type: t,
          runId: file.replace(ext, '').replace('.har', '').replace('.timeline', ''),
          collectionId,
          filePath,
          sizeBytes: stat.size,
          createdAt: stat.birthtime.toISOString(),
        });
      }
    }
    return refs;
  }

  async deleteArtifact(ref: ArtifactRef): Promise<void> {
    if (fs.existsSync(ref.filePath)) fs.unlinkSync(ref.filePath);
  }

  async purgeOldArtifacts(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const dirs = [
      RUNS_DIR,
      BASELINES_DIR,
      SNAPSHOTS_DIR,
      path.join(DATA_DIR, 'api-har'),
      path.join(DATA_DIR, 'api-timelines'),
    ];
    let deleted = 0;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
    }
    return deleted;
  }
}

let _instance: ArtifactEngine | undefined;

export function getArtifactEngine(): ArtifactEngine {
  if (!_instance) _instance = new ArtifactEngine();
  return _instance;
}

export { ArtifactEngine };
export { savePartialRunResult };
