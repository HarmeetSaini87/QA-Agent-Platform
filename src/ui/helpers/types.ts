import type { ServerResponse } from 'http';
import type { ChildProcess } from 'child_process';
import type { ScriptStep } from '../../data/types';

export type LogLevel = 'info' | 'pass' | 'fail' | 'warn';

export interface HealEvent {
  stepOrder: number;
  keyword: string;
  locatorId: string;
  healed: string;
  healedType: string;
  confidence: number;
  tier: 'T2' | 'T3' | 'T4' | 'T4-pending';
  at: string;
  runId?: string;
  projectId?: string;
  suiteName?: string;
  scriptTitle?: string;
  tcId?: string;
  locatorName?: string;
  oldSelector?: string;
  oldSelectorType?: string;
}

export interface TestEvent {
  name: string;
  status: 'running' | 'pass' | 'fail';
  durationMs: number;
  browser?: string;
  errorMessage?: string;
  errorDetail?: string;
  screenshotPath?: string;
  screenshotBefore?: string;   // URL: approved baseline image
  screenshotAfter?: string;    // URL: actual (this run) image
  screenshotDiff?: string;     // URL: pixel diff image (red = changed pixels)
  visualDiffPct?: number;      // % of pixels that differ
  visualLocatorName?: string;  // which locator was asserted
  visualResults?: Array<{      // all ASSERT VISUAL steps in this test (one entry per step)
    stepOrder:   number;
    locatorName: string;
    baselineUrl: string | null;
    actualUrl:   string | null;
    diffUrl:     string | null;
    diffPct:     number;
    status:      string;
  }>;
  videoPath?: string;
  tracePath?: string;
  failureScreenshotPath?: string;
  consoleErrors?: string[];
  steps?: { name: string; status: 'pass' | 'fail' | 'skip'; durationMs: number }[];
  testId?: string;
  quarantined?: boolean;
  defectKey?: string;
  defectStatus?: 'open' | 'closed';
}

export interface RunRecord {
  runId: string;
  planPath: string;
  planId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  exitCode: number | null;
  output: string[];
  tests: TestEvent[];
  passed: number;
  failed: number;
  total: number;
  specPath?: string;
  projectId?: string;
  projectName?: string;
  suiteId?: string;
  suiteName?: string;
  environmentId?: string;
  environmentName?: string;
  executedBy?: string;
  browsers?: string[];
  scriptIds?: string[];
  healEvents?: HealEvent[];
  traceMode?: 'on' | 'retain-on-failure' | 'off' | 'on-first-retry';
}

export interface DebugSession {
  sessionId: string;
  scriptId: string;
  scriptTitle: string;
  projectId: string;
  userId: string;
  username: string;
  environmentId: string | null;
  environmentName: string | null;
  status: 'starting' | 'paused' | 'running' | 'done' | 'stopped' | 'error';
  currentStep: number;
  totalSteps: number;
  specPath: string;
  proc?: ChildProcess;
  startedAt: string;
  finishedAt?: string;
  lastHeartbeat: number;
  pendingStep?: {
    stepIdx: number;
    keyword: string;
    locator: string;
    value: string;
    screenshotPath: string;
  };
}

export type WsOut =
  | { type: 'run:start'; runId: string; planId: string; startedAt: string }
  | { type: 'run:output'; runId: string; line: string; level: LogLevel }
  | { type: 'run:test'; runId: string; name: string; status: 'pass' | 'fail' | 'running'; durationMs?: number; browser?: string }
  | { type: 'run:stats'; runId: string; passed: number; failed: number; total: number; completed: number }
  | { type: 'run:done'; runId: string; passed: number; failed: number; total: number; exitCode: number | null }
  | { type: 'debug:step'; sessionId: string; stepIdx: number; keyword: string; locator: string; value: string; screenshotPath: string }
  | { type: 'debug:done'; sessionId: string; status: 'done' | 'stopped' | 'error' }
  | { type: 'pong' };

export interface RecorderSession {
  token: string;
  projectId: string;
  createdBy: string;
  active: boolean;
  steps: ScriptStep[];
  stepCount: number;
  lastActivity: number;
  createdAt: number;
  sseClients: Set<ServerResponse>;
}