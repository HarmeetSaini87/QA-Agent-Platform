/**
 * planOrchestrator.ts
 * The single entry point for ALL test plan generation paths.
 *
 * Three input paths, one output format:
 *
 *   Path A — Excel TC file  →  readExcelFile()  →  buildTestPlan()  →  TestPlan (full steps)
 *   Path B — Jira story     →  JiraClient()     →  parseFiles()     →  TestPlan (AI skeleton)
 *   Path C — PRD / upload   →  parseFile()      →  buildTestPlan()  →  TestPlan (AI skeleton)
 *
 * "AI skeleton" = plan with structured scenario outlines the AI enriches during execution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readExcelFile } from './excelReader';
import { buildTestPlan, writePlan } from './planWriter';
import { parseFile, parseFiles, combineIntoContext } from './fileParser';
import { parseAcceptanceCriteria } from './acParser';
import { config } from '../framework/config';
import { logger } from './logger';
import {
  TestPlan,
  TestCase,
  TestStep,
  RequirementDoc,
  InputSource,
} from '../types/plan.types';

// ── Result ────────────────────────────────────────────────────────────────────

export interface OrchestrateResult {
  plan: TestPlan;
  planPath: string;
  requirementDocPath?: string;
  source: InputSource;
  summary: OrchestratorSummary;
}

export interface OrchestratorSummary {
  sourceRef: string;
  testCaseCount: number;
  totalSteps: number;
  isAISkeleton: boolean;   // true = AI needs to enrich steps during execution
  imageFilePaths: string[]; // images AI should inspect visually
  warnings: string[];
}

// ── Path A — Excel ────────────────────────────────────────────────────────────

export async function orchestrateFromExcel(excelPath: string): Promise<OrchestrateResult> {
  logger.info(`[Orchestrator] Source: Excel — ${path.basename(excelPath)}`);

  const doc = readExcelFile(excelPath);
  const plan = buildTestPlan(doc);
  const planPath = writePlan(plan, config.paths.testPlans);

  return {
    plan,
    planPath,
    source: 'excel',
    summary: {
      sourceRef: path.basename(excelPath),
      testCaseCount: plan.testCases.length,
      totalSteps: plan.testCases.reduce((s, tc) => s + tc.steps.length, 0),
      isAISkeleton: false,
      imageFilePaths: [],
      warnings: plan.testCases
        .filter(tc => tc.steps.length <= 1)
        .map(tc => `${tc.id} has no steps — check the Excel row`),
    },
  };
}

// ── Path B — Jira story ───────────────────────────────────────────────────────

export async function orchestrateFromJira(storyIdOrUrl: string): Promise<OrchestrateResult> {
  logger.info(`[Orchestrator] Source: Jira — ${storyIdOrUrl}`);

  // Lazy import to avoid crashing when Jira is not configured
  const { getJiraClient } = await import('../integrations/jira.client');
  const client = getJiraClient();
  const story = await client.fetchStory(storyIdOrUrl);

  // Parse all attachments
  const parsed = await parseFiles(story.attachmentPaths);
  const context = combineIntoContext(parsed);

  const doc: RequirementDoc = {
    source: 'jira',
    sourceRef: story.storyId,
    summary: story.summary,
    description: story.description,
    acceptanceCriteria: story.acceptanceCriteria,
    attachmentTexts: context.fullText ? [context.fullText] : [],
  };

  const { plan, requirementDocPath } = buildSkeletonPlan(doc, context.imageFilePaths);
  const planPath = writePlan(plan, config.paths.testPlans);

  // Persist RequirementDoc for AI reference
  const docDir = path.resolve(config.paths.requirements, 'downloads', story.storyId);
  if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
  const docPath = path.join(docDir, 'requirement-doc.json');
  fs.writeFileSync(docPath, JSON.stringify(doc, null, 2));

  return {
    plan,
    planPath,
    requirementDocPath: docPath,
    source: 'jira',
    summary: {
      sourceRef: story.storyId,
      testCaseCount: plan.testCases.length,
      totalSteps: plan.testCases.reduce((s, tc) => s + tc.steps.length, 0),
      isAISkeleton: true,
      imageFilePaths: context.imageFilePaths,
      warnings: context.failedFiles.map(f => `Could not parse attachment: ${f}`),
    },
  };
}

// ── Path C — PRD / uploaded file ──────────────────────────────────────────────

export async function orchestrateFromPrd(filePath: string): Promise<OrchestrateResult> {
  logger.info(`[Orchestrator] Source: PRD upload — ${path.basename(filePath)}`);

  const parsedFile = await parseFile(filePath);
  const context = combineIntoContext([parsedFile]);

  const doc: RequirementDoc = {
    source: 'prd-upload',
    sourceRef: path.basename(filePath),
    summary: '',
    description: parsedFile.isImage ? '' : parsedFile.text,
    acceptanceCriteria: '',
    attachmentTexts: context.fullText ? [context.fullText] : [],
  };

  const { plan, requirementDocPath } = buildSkeletonPlan(doc, context.imageFilePaths);
  const planPath = writePlan(plan, config.paths.testPlans);

  // Persist RequirementDoc
  const docDir = path.resolve(config.paths.requirements, 'uploads');
  if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
  const docPath = path.join(docDir, `${path.basename(filePath, path.extname(filePath))}-req-doc.json`);
  fs.writeFileSync(docPath, JSON.stringify(doc, null, 2));

  return {
    plan,
    planPath,
    requirementDocPath: docPath,
    source: 'prd-upload',
    summary: {
      sourceRef: path.basename(filePath),
      testCaseCount: plan.testCases.length,
      totalSteps: plan.testCases.reduce((s, tc) => s + tc.steps.length, 0),
      isAISkeleton: true,
      imageFilePaths: context.imageFilePaths,
      warnings: context.failedFiles.map(f => `Could not parse: ${f}`),
    },
  };
}

// ── Path D — Pre-built RequirementDoc (used by Web UI) ────────────────────────

export async function orchestrateFromRequirementDoc(
  doc: RequirementDoc,
  imageFilePaths: string[] = [],
): Promise<OrchestrateResult> {
  logger.info(`[Orchestrator] Source: RequirementDoc — ${doc.source}/${doc.sourceRef}`);

  if (doc.source === 'excel' && doc.rawRows) {
    const plan = buildTestPlan(doc);
    const planPath = writePlan(plan, config.paths.testPlans);
    return {
      plan,
      planPath,
      source: 'excel',
      summary: {
        sourceRef: doc.sourceRef,
        testCaseCount: plan.testCases.length,
        totalSteps: plan.testCases.reduce((s, tc) => s + tc.steps.length, 0),
        isAISkeleton: false,
        imageFilePaths: [],
        warnings: [],
      },
    };
  }

  const { plan, requirementDocPath } = buildSkeletonPlan(doc, imageFilePaths);
  const planPath = writePlan(plan, config.paths.testPlans);
  return {
    plan,
    planPath,
    requirementDocPath,
    source: doc.source,
    summary: {
      sourceRef: doc.sourceRef,
      testCaseCount: plan.testCases.length,
      totalSteps: plan.testCases.reduce((s, tc) => s + tc.steps.length, 0),
      isAISkeleton: true,
      imageFilePaths,
      warnings: [],
    },
  };
}

// ── Skeleton plan builder (Jira + PRD paths) ──────────────────────────────────

function buildSkeletonPlan(
  doc: RequirementDoc,
  imageFilePaths: string[],
): { plan: TestPlan; requirementDocPath?: string } {

  const scenarios = parseAcceptanceCriteria(doc.acceptanceCriteria ?? '');

  // If no AC scenarios found, create one catch-all test case from the summary/description
  const testCases: TestCase[] = scenarios.length > 0
    ? scenarios.map((s, i) => scenarioToTestCase(s, i, doc))
    : [fallbackTestCase(doc)];

  // Append AI instruction step to every test case
  for (const tc of testCases) {
    injectAiInstructions(tc, doc, imageFilePaths);
  }

  const plan: TestPlan = {
    planId:     `plan-${uuidv4().slice(0, 8)}`,
    createdAt:  new Date().toISOString(),
    source:     doc.source,
    sourceRef:  doc.sourceRef,
    appBaseURL: config.app.baseURL,
    testCases,
  };

  return { plan };
}

// ── Scenario → TestCase ───────────────────────────────────────────────────────

function scenarioToTestCase(
  scenario: ReturnType<typeof parseAcceptanceCriteria>[number],
  index: number,
  doc: RequirementDoc,
): TestCase {
  const tcId = `${doc.sourceRef}-TC${String(index + 1).padStart(2, '0')}`;

  // Build outline steps from BDD parts if available
  const steps: TestStep[] = [];

  if (scenario.isBDD) {
    if (scenario.given) steps.push(outlineStep(1, 'navigate', `[PRECONDITION] ${scenario.given}`));
    if (scenario.when)  steps.push(outlineStep(steps.length + 1, 'click', `[ACTION] ${scenario.when}`));
    if (scenario.then)  steps.push(outlineStep(steps.length + 1, 'assertVisible', `[ASSERT] ${scenario.then}`));
  } else {
    steps.push(outlineStep(1, 'custom', `[ACTION] ${scenario.rawText}`));
  }

  // Always end with screenshot
  steps.push(outlineStep(steps.length + 1, 'screenshot', 'Take a final screenshot'));

  return {
    id:              tcId,
    title:           scenario.suggestedTitle,
    module:          doc.summary?.split(' ').slice(0, 3).join(' ') ?? doc.sourceRef,
    priority:        scenario.suggestedPriority,
    preconditions:   scenario.given ?? 'User has valid credentials and the application is accessible.',
    steps,
    expectedResult:  scenario.then ?? scenario.rawText,
    testData:        {},
    tags:            ['ai-generated'],
    sourceStoryId:   doc.source === 'jira' ? doc.sourceRef : undefined,
    sourceFile:      doc.source !== 'jira' ? doc.sourceRef : undefined,
  };
}

function fallbackTestCase(doc: RequirementDoc): TestCase {
  return {
    id:            `${doc.sourceRef}-TC01`,
    title:         doc.summary || `Test ${doc.sourceRef}`,
    module:        doc.sourceRef,
    priority:      'medium',
    preconditions: 'User has valid credentials and the application is accessible.',
    steps: [
      outlineStep(1, 'navigate',     '[AI: Navigate to the relevant page]'),
      outlineStep(2, 'custom',       '[AI: Perform the main action from the requirement]'),
      outlineStep(3, 'assertVisible','[AI: Assert the expected outcome]'),
      outlineStep(4, 'screenshot',   'Take a final screenshot'),
    ],
    expectedResult:  doc.acceptanceCriteria || doc.description?.slice(0, 200) || 'All requirements are met.',
    testData:        {},
    tags:            ['ai-generated'],
    sourceStoryId:   doc.source === 'jira' ? doc.sourceRef : undefined,
    sourceFile:      doc.source !== 'jira' ? doc.sourceRef : undefined,
  };
}

function outlineStep(num: number, action: TestStep['action'], description: string): TestStep {
  return {
    stepNumber:        num,
    action,
    description,
    selector:          null as unknown as string,
    fallbackSelectors: [],
  };
}

// ── AI instruction injector ───────────────────────────────────────────────────
// Adds a metadata step at position 0 that tells the AI where to find the
// full requirement context. The AI reads CLAUDE.md section 5 on how to handle this.

function injectAiInstructions(tc: TestCase, doc: RequirementDoc, imageFilePaths: string[]): void {
  const context: string[] = [];

  if (doc.summary)            context.push(`Summary: ${doc.summary}`);
  if (doc.description)        context.push(`Description: ${doc.description.slice(0, 300)}...`);
  if (doc.acceptanceCriteria) context.push(`AC: ${doc.acceptanceCriteria.slice(0, 300)}...`);
  if (doc.attachmentTexts?.length) context.push(`Attachments: ${doc.attachmentTexts.length} file(s) parsed`);
  if (imageFilePaths.length)  context.push(`Images: ${imageFilePaths.join(', ')}`);

  const instructionStep: TestStep = {
    stepNumber:        0,
    action:            'custom',
    description:       `[AI_CONTEXT] ${context.join(' | ')}`,
    selector:          null as unknown as string,
    fallbackSelectors: [],
  };

  tc.steps.unshift(instructionStep);

  // Re-number all steps
  tc.steps.forEach((s, i) => { s.stepNumber = i; });
}
