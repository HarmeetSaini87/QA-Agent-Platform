/**
 * jira-to-plan.ts
 * Full pipeline: Jira story → attachments → RequirementDoc → test-plan.json
 *
 * This is the single command your team runs to go from a story ID to a ready-to-run plan.
 * The AI agent (in your IDE) will refine selectors and step details during execution.
 *
 * Usage:
 *   npx tsx scripts/jira-to-plan.ts --story=PROJ-123
 *   npm run jira-to-plan -- --story=PROJ-123
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { getJiraClient } from '../src/integrations/jira.client';
import { parseFiles, combineIntoContext } from '../src/utils/fileParser';
import { buildTestPlan, writePlan } from '../src/utils/planWriter';
import { logger } from '../src/utils/logger';
import { RequirementDoc } from '../src/types/plan.types';
import { config } from '../src/framework/config';

dotenv.config();

// ── Args ──────────────────────────────────────────────────────────────────────

const storyArg = process.argv.find(a => a.startsWith('--story='))?.split('=').slice(1).join('=');

if (!storyArg) {
  console.error('❌  --story argument is required');
  console.error('    Example: npx tsx scripts/jira-to-plan.ts --story=PROJ-123');
  process.exit(1);
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n' + '═'.repeat(60));
  logger.info('QA Agent Platform — Jira → Plan Pipeline');
  console.log('═'.repeat(60));

  // Step 1 — Fetch Jira story
  logger.info('\n[1/4] Fetching Jira story...');
  const client = getJiraClient();
  const story = await client.fetchStory(storyArg!);

  // Step 2 — Parse attachments
  logger.info(`\n[2/4] Parsing ${story.attachmentPaths.length} attachment(s)...`);
  const parsedFiles = await parseFiles(story.attachmentPaths);
  const context = combineIntoContext(parsedFiles);

  // Step 3 — Build RequirementDoc
  logger.info('\n[3/4] Building RequirementDoc...');
  const doc: RequirementDoc = {
    source: 'jira',
    sourceRef: story.storyId,
    summary: story.summary,
    description: story.description,
    acceptanceCriteria: story.acceptanceCriteria,
    attachmentTexts: context.fullText ? [context.fullText] : [],
  };

  // Save RequirementDoc for reference
  const docDir = path.resolve(config.paths.requirements, 'downloads', story.storyId);
  if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
  fs.writeFileSync(path.join(docDir, 'requirement-doc.json'), JSON.stringify(doc, null, 2));

  // Step 4 — Build and write test plan
  // Note: For Jira source, planWriter creates a skeleton plan.
  // The AI in your IDE enriches this with proper selectors during execution.
  logger.info('\n[4/4] Writing test plan...');

  // Build a skeleton plan from the story data (no raw Excel rows)
  // The AI will generate proper steps when it reads this plan + CLAUDE.md
  const skeletonPlan = buildTestPlan(doc);

  // Inject a single placeholder test case from the story summary
  // The AI replaces these with real steps when it reads the RequirementDoc
  if (skeletonPlan.testCases.length === 0) {
    skeletonPlan.testCases.push({
      id: `${story.storyId}-TC01`,
      title: story.summary,
      module: story.labels[0] ?? 'General',
      priority: (story.priority.toLowerCase() as 'high' | 'medium' | 'low') ?? 'medium',
      preconditions: 'User has valid credentials and application is accessible.',
      steps: [
        {
          stepNumber: 1,
          action: 'custom',
          description: `[AI: Generate steps from RequirementDoc at ${path.join(docDir, 'requirement-doc.json')}]`,
          selector: null as unknown as string,
          fallbackSelectors: [],
        },
      ],
      expectedResult: story.acceptanceCriteria || 'All acceptance criteria are met.',
      testData: {},
      tags: story.labels,
      sourceStoryId: story.storyId,
    });
  }

  const planPath = writePlan(skeletonPlan, config.paths.testPlans);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('✅  Pipeline complete');
  console.log('─'.repeat(60));
  console.log(`Story      : ${story.storyId} — ${story.summary}`);
  console.log(`Description: ${story.description.length} chars`);
  console.log(`AC         : ${story.acceptanceCriteria.length} chars`);
  console.log(`Attachments: ${parsedFiles.length} file(s) parsed`);
  if (context.imageFilePaths.length > 0) {
    console.log(`Images     : ${context.imageFilePaths.length} (AI will inspect visually)`);
  }
  if (context.failedFiles.length > 0) {
    console.log(`⚠  Failed  : ${context.failedFiles.join(', ')}`);
  }
  console.log(`Plan file  : ${planPath}`);
  console.log('─'.repeat(60));
  console.log('\nNext step — open your AI IDE and say:');
  console.log(`  "Read the requirement doc at requirements/downloads/${story.storyId}/requirement-doc.json`);
  console.log(`   and generate a detailed test plan, then run the tests."`);
  console.log('═'.repeat(60) + '\n');
}

run().catch(err => {
  logger.error(err.message);
  process.exit(1);
});
