// src/api-suite/contracts/api-suite.contracts.ts

export type SuiteLifecyclePhase = 'before_all' | 'before_each' | 'main' | 'after_each' | 'after_all';

export interface ApiSuite {
  id: string;
  name: string;
  projectId?: string;
  description?: string;
  /** Ordered list of main collection IDs to run */
  collectionIds: string[];
  /** Run once before all collections — variables propagated forward */
  beforeAllCollectionId?: string;
  /** Run once after all (guaranteed via try/finally) */
  afterAllCollectionId?: string;
  /** Run before each main collection */
  beforeEachCollectionId?: string;
  /** Run after each main collection (guaranteed via try/finally) */
  afterEachCollectionId?: string;
  environmentId: string;
  /** What to do when a collection fails */
  onFailure: 'stop' | 'continue';
  createdAt: string;
  updatedAt: string;
}

export interface SuiteCollectionResult {
  readonly phase: SuiteLifecyclePhase;
  readonly collectionId: string;
  readonly collectionName: string;
  /** The ApiCollectionRunResult.id for this phase run */
  readonly runId: string;
  readonly status: 'passed' | 'failed' | 'error' | 'skipped';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  /** true for beforeAll/afterAll/beforeEach/afterEach */
  readonly isLifecycleHook: boolean;
  /** Variables passed into this phase */
  readonly contextIn?: Record<string, string>;
  /** Variables extracted from this phase (for propagation) */
  readonly contextOut?: Record<string, string>;
  readonly failureReason?: string;
}

export interface SuiteRunResult {
  readonly id: string;
  readonly suiteId: string;
  readonly suiteName: string;
  readonly status: 'passed' | 'failed' | 'error' | 'running';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly phaseResults: readonly SuiteCollectionResult[];
  /** Accumulated variables from all lifecycle phases */
  readonly sharedContext: Record<string, string>;
  readonly failureReason?: string;
}

export interface SuiteRunRegistry {
  readonly _schemaVersion: 1;
  runs: SuiteRunResult[];
}
