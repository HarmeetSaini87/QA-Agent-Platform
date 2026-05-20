import { nanoid } from 'nanoid';
import { runCollection } from '../utils/apiRunner';
import { saveSuiteRunResult } from './suite-run-store';
import type { ApiSuite, SuiteRunResult, SuiteCollectionResult, SuiteLifecyclePhase } from './contracts/api-suite.contracts';
import type { ApiCollection, ApiEnvironment } from '../data/types';

export async function runSuite(
  suite: ApiSuite,
  allCollections: ApiCollection[],
  environment: ApiEnvironment,
): Promise<SuiteRunResult> {
  const suiteRunId = nanoid();
  const startedAt = new Date().toISOString();
  const phaseResults: SuiteCollectionResult[] = [];
  let sharedContext: Record<string, string> = {};
  let overallStatus: SuiteRunResult['status'] = 'passed';
  let failFast = false;

  function findCollection(id: string): ApiCollection {
    const c = allCollections.find(c => c.id === id);
    if (!c) throw new Error(`Suite orchestrator: collection ${id} not found`);
    return c;
  }

  async function runPhase(
    collectionId: string | undefined,
    phase: SuiteLifecyclePhase,
  ): Promise<SuiteCollectionResult | null> {
    if (!collectionId) return null;
    const collection = findCollection(collectionId);
    const runId = nanoid();
    const phaseStart = Date.now();
    const contextIn = { ...sharedContext };
    try {
      const result = await runCollection(collection, environment, runId, { ...sharedContext });
      if (phase === 'before_all' || phase === 'before_each') {
        sharedContext = { ...sharedContext, ...(result.variableContext ?? {}) };
      }
      if (result.status !== 'passed') overallStatus = 'failed';
      return {
        phase, collectionId, collectionName: collection.name, runId,
        status: result.status as SuiteCollectionResult['status'],
        startedAt: result.startedAt, completedAt: result.completedAt,
        durationMs: Date.now() - phaseStart,
        isLifecycleHook: phase !== 'main',
        contextIn, contextOut: result.variableContext,
      };
    } catch (err: unknown) {
      overallStatus = 'failed';
      const now = new Date().toISOString();
      return {
        phase, collectionId, collectionName: collection.name, runId,
        status: 'error',
        startedAt: now, completedAt: now,
        durationMs: Date.now() - phaseStart,
        isLifecycleHook: phase !== 'main',
        contextIn,
        failureReason: (err instanceof Error) ? err.message : String(err),
      };
    }
  }

  try {
    const beforeAllResult = await runPhase(suite.beforeAllCollectionId, 'before_all');
    if (beforeAllResult) {
      phaseResults.push(beforeAllResult);
      if (beforeAllResult.status !== 'passed' && suite.onFailure === 'stop') {
        failFast = true;
      }
    }

    if (!failFast) {
      for (const collectionId of suite.collectionIds) {
        let shouldBreak = false;
        try {
          const beforeEachResult = await runPhase(suite.beforeEachCollectionId, 'before_each');
          if (beforeEachResult) phaseResults.push(beforeEachResult);

          const mainResult = await runPhase(collectionId, 'main');
          if (mainResult) {
            phaseResults.push(mainResult);
            if (mainResult.status !== 'passed' && suite.onFailure === 'stop') {
              shouldBreak = true;
            }
          }
        } finally {
          const afterEachResult = await runPhase(suite.afterEachCollectionId, 'after_each');
          if (afterEachResult) phaseResults.push(afterEachResult);
        }
        if (shouldBreak) break;
      }
    }
  } finally {
    const afterAllResult = await runPhase(suite.afterAllCollectionId, 'after_all');
    if (afterAllResult) phaseResults.push(afterAllResult);
  }

  const completedAt = new Date().toISOString();
  const suiteResult: SuiteRunResult = {
    id: suiteRunId, suiteId: suite.id, suiteName: suite.name,
    status: overallStatus,
    startedAt, completedAt,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    phaseResults, sharedContext,
  };

  await saveSuiteRunResult(suiteResult);
  return suiteResult;
}
