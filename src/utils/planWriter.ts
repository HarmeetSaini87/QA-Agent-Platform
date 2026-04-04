import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  TestPlan,
  TestCase,
  TestStep,
  RequirementDoc,
  RawExcelRow,
  StepActionType,
} from '../types/plan.types';
import { config } from '../framework/config';
import { logger } from './logger';

// ── Step inference ────────────────────────────────────────────────────────────
// Maps plain-English step text to a structured TestStep.
// This is a best-effort heuristic — the AI agent refines during execution.

const ACTION_PATTERNS: Array<{ pattern: RegExp; action: StepActionType }> = [
  { pattern: /navigat|go to|open|visit/i,                action: 'navigate' },
  { pattern: /click|press|tap|hit|select.*button/i,      action: 'click' },
  { pattern: /fill|enter|type|input|write/i,             action: 'fill' },
  { pattern: /select|choose|pick/i,                      action: 'selectOption' },
  { pattern: /upload|attach|set file/i,                  action: 'setInputFiles' },
  { pattern: /check|tick|enable/i,                       action: 'check' },
  { pattern: /wait|hold/i,                               action: 'waitForElement' },
  { pattern: /verify|assert|check.*that|confirm|ensure|validate|should|must/i, action: 'assertVisible' },
  { pattern: /logout|log out|sign out/i,                 action: 'click' },
  { pattern: /screenshot|capture/i,                      action: 'screenshot' },
  { pattern: /search|find|look for/i,                    action: 'fill' },
  { pattern: /delete|remove|bin|trash/i,                 action: 'click' },
  { pattern: /back|return/i,                             action: 'click' },
  { pattern: /save|submit|confirm|yes/i,                 action: 'click' },
];

function inferAction(stepText: string): StepActionType {
  for (const { pattern, action } of ACTION_PATTERNS) {
    if (pattern.test(stepText)) return action;
  }
  return 'custom';
}

function stepTextToTestStep(stepText: string, stepNumber: number): TestStep {
  return {
    stepNumber,
    action: inferAction(stepText),
    description: stepText,
    selector: null as any,
    fallbackSelectors: [],
    value: undefined,
  };
}

// ── Excel rows → TestCases ────────────────────────────────────────────────────

function rowToTestCase(row: RawExcelRow): TestCase {
  const steps: TestStep[] = row.steps
    .filter(s => s.trim().length > 0)
    .map((stepText, idx) => stepTextToTestStep(stepText, idx + 1));

  // Always append a final screenshot step if not already there
  const lastStep = steps[steps.length - 1];
  if (!lastStep || lastStep.action !== 'screenshot') {
    steps.push({
      stepNumber: steps.length + 1,
      action: 'screenshot',
      description: 'Take a final screenshot of the end state',
      selector: null as any,
      fallbackSelectors: [],
    });
  }

  const priority = (['high', 'medium', 'low'].includes(row.priority.toLowerCase())
    ? row.priority.toLowerCase()
    : 'medium') as 'high' | 'medium' | 'low';

  return {
    id: row.tcId,
    title: row.title,
    module: row.module,
    priority,
    preconditions: row.preconditions || undefined,
    steps,
    expectedResult: row.expectedResult,
    testData: row.testData,
    tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    sourceStoryId: undefined,
    sourceFile: undefined,
  };
}

// ── Main writer ───────────────────────────────────────────────────────────────

export function buildTestPlan(doc: RequirementDoc): TestPlan {
  let testCases: TestCase[] = [];

  if (doc.source === 'excel' && doc.rawRows) {
    testCases = doc.rawRows.map(rowToTestCase);
    logger.info(`Built ${testCases.length} test cases from Excel rows`);
  } else {
    // For jira/prd-upload sources the AI planner generates testCases
    // This function is called with a pre-populated doc in those flows
    logger.warn(`Source "${doc.source}" requires AI planner — testCases must be populated externally`);
  }

  const plan: TestPlan = {
    planId: `plan-${uuidv4().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    source: doc.source,
    sourceRef: doc.sourceRef,
    appBaseURL: config.app.baseURL,
    testCases,
  };

  return plan;
}

export function writePlan(plan: TestPlan, outputDir: string): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Derive filename from sourceRef
  const safeName = plan.sourceRef
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  const filename = `${safeName}-plan.json`;
  const outputPath = path.join(outputDir, filename);

  fs.writeFileSync(outputPath, JSON.stringify(plan, null, 2), 'utf-8');
  logger.info(`Test plan written: ${outputPath}`);
  logger.info(`  Plan ID  : ${plan.planId}`);
  logger.info(`  Source   : ${plan.source} (${plan.sourceRef})`);
  logger.info(`  Tests    : ${plan.testCases.length}`);

  return outputPath;
}
