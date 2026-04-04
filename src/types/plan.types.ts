// ─────────────────────────────────────────────────────────────
// Core types shared across all agents, parsers, and the Web UI
// ─────────────────────────────────────────────────────────────

export type InputSource = 'jira' | 'excel' | 'prd-upload' | 'chat';

export type StepActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'selectOption'
  | 'check'
  | 'uncheck'
  | 'setInputFiles'
  | 'waitForElement'
  | 'assertText'
  | 'assertVisible'
  | 'assertNotVisible'
  | 'assertURL'
  | 'screenshot'
  | 'hover'
  | 'pressKey'
  | 'scroll'
  | 'waitForNavigation'
  | 'closeDialog'
  | 'custom';

export interface TestStep {
  stepNumber: number;
  action: StepActionType;
  description: string;           // Human-readable: "Click the Add button"
  selector?: string;             // Primary selector
  fallbackSelectors?: string[];  // Tried in order if primary fails
  value?: string;                // For fill / selectOption / pressKey
  filePath?: string;             // For setInputFiles
  expectedText?: string;         // For assertText
  expectedURL?: string;          // For assertURL
  waitTimeout?: number;          // Override default timeout for this step
}

export interface TestCase {
  id: string;                    // TC_001
  title: string;
  module: string;
  priority: 'high' | 'medium' | 'low';
  preconditions?: string;
  steps: TestStep[];
  expectedResult: string;
  testData?: Record<string, string>;  // { "Gateway Name": "GW-01", "Type": "HTTP" }
  tags?: string[];
  sourceStoryId?: string;        // Jira story ID if originated from Jira
  sourceFile?: string;           // Original Excel/PRD filename
}

export interface TestPlan {
  planId: string;
  createdAt: string;             // ISO timestamp
  source: InputSource;
  sourceRef: string;             // Story ID, filename, or "chat"
  appBaseURL: string;
  testCases: TestCase[];
}

// ── Requirement doc — intermediate format from all input sources ──

export interface RequirementDoc {
  source: InputSource;
  sourceRef: string;
  summary?: string;
  description?: string;
  acceptanceCriteria?: string;
  attachmentTexts?: string[];    // Combined text from all attachments
  rawRows?: RawExcelRow[];       // Populated when source is 'excel'
}

export interface RawExcelRow {
  tcId: string;
  title: string;
  module: string;
  priority: string;
  preconditions: string;
  steps: string[];               // One entry per Step N column
  expectedResult: string;
  testData: Record<string, string>;
  tags: string;
}

// ── Execution result types ────────────────────────────────────

export type StepStatus = 'pass' | 'fail' | 'skip' | 'healing';

export interface StepResult {
  stepNumber: number;
  description: string;
  status: StepStatus;
  durationMs: number;
  screenshotPath?: string;
  errorMessage?: string;
  healEvent?: HealEvent;
}

export interface HealEvent {
  originalSelector: string;
  healedSelector: string;
  confidence: 'high' | 'medium' | 'low';
  pomFile?: string;
  patched: boolean;
}

export interface TestCaseResult {
  testCaseId: string;
  title: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  steps: StepResult[];
  startedAt: string;
  finishedAt: string;
}

export interface RunResult {
  runId: string;
  planId: string;
  startedAt: string;
  finishedAt: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  testResults: TestCaseResult[];
}
