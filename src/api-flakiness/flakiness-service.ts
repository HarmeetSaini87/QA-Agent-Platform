// src/api-flakiness/flakiness-service.ts
import * as fs from 'fs';
import * as path from 'path';
import type { ApiCollectionRunResult } from '../data/types';
import { aggregateRunsForStep } from './aggregator';
import { clusterFailures } from './cluster-engine';
import { saveReport, loadReport } from './flakiness-store';
import type { CollectionFlakinessReport, StepFlakinessRecord } from './contracts/flakiness.contracts';

const RUNS_DIR = path.join(path.resolve(process.env.DATA_DIR || 'data'), 'api-runs');

/** Load all persisted runs for a collection (max 100, most recent first) */
export function loadRunsForCollection(collectionId: string): ApiCollectionRunResult[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  // OLD: .filter(f => f.endsWith('.json')) — matched .snapshot.json files which lack startedAt, crashing sort()
  const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json') && !f.includes('.snapshot') && !f.endsWith('.tmp'));
  const runs: ApiCollectionRunResult[] = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')) as ApiCollectionRunResult;
      if (r.collectionId === collectionId) runs.push(r);
    } catch { /* skip corrupt */ }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100);
}

/** Pure: compute report from provided runs (testable without disk) */
export function computeReport(
  collectionId: string,
  runs: ApiCollectionRunResult[]
): CollectionFlakinessReport {
  const stepIds = new Set<string>();
  for (const run of runs) {
    for (const sr of run.stepResults) stepIds.add(sr.stepId);
  }

  const stepRecords: StepFlakinessRecord[] = [];
  for (const stepId of stepIds) {
    const rec = aggregateRunsForStep(stepId, collectionId, runs);
    if (rec) stepRecords.push(rec);
  }

  const clusters = clusterFailures(stepRecords);

  const hotspots = stepRecords
    .filter(r => r.isFlaky)
    .sort((a, b) => b.flakinessScore - a.flakinessScore)
    .map(r => r.stepId);

  const avgFailRate = stepRecords.length > 0
    ? stepRecords.reduce((sum, r) => sum + r.failRate, 0) / stepRecords.length
    : 0;

  return {
    collectionId,
    computedAt: new Date().toISOString(),
    runsAnalyzed: runs.length,
    stepRecords,
    clusters,
    hotspots,
    stabilityScore: parseFloat((1 - avgFailRate).toFixed(4)),
  };
}

/** Recompute and persist report for a collection */
export function recomputeAndSave(collectionId: string): CollectionFlakinessReport {
  const runs = loadRunsForCollection(collectionId);
  const report = computeReport(collectionId, runs);
  saveReport(report);
  return report;
}

/** Get cached report, recomputing if absent */
export function getReport(collectionId: string): CollectionFlakinessReport {
  const cached = loadReport(collectionId);
  if (cached) return cached;
  return recomputeAndSave(collectionId);
}
