/**
 * fetch-jira-story.ts
 * CLI to fetch a Jira story and write a partial test-plan.json.
 * Full plan generation happens after P5 (file parser) processes attachments.
 *
 * Usage:
 *   npx tsx scripts/fetch-jira-story.ts --story=PROJ-123
 *   npx tsx scripts/fetch-jira-story.ts --story=https://pnmx.atlassian.net/browse/PROJ-123
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { getJiraClient } from '../src/integrations/jira.client';
import { logger } from '../src/utils/logger';

dotenv.config();

// ── Args ──────────────────────────────────────────────────────────────────────

const storyArg = process.argv.find(a => a.startsWith('--story='))?.split('=').slice(1).join('=');

if (!storyArg) {
  console.error('❌  --story argument is required');
  console.error('    Example: npx tsx scripts/fetch-jira-story.ts --story=PROJ-123');
  process.exit(1);
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function run() {
  logger.info('━━━ Jira Story Fetcher ━━━');

  const client = getJiraClient();
  const story = await client.fetchStory(storyArg!);

  // ── Print summary ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`Story ID  : ${story.storyId}`);
  console.log(`Summary   : ${story.summary}`);
  console.log(`Status    : ${story.status}`);
  console.log(`Priority  : ${story.priority}`);
  console.log(`Labels    : ${story.labels.join(', ') || 'none'}`);
  console.log('─'.repeat(60));
  console.log('Description:');
  console.log(story.description.slice(0, 400) + (story.description.length > 400 ? '...' : ''));
  console.log('─'.repeat(60));

  if (story.acceptanceCriteria) {
    console.log('Acceptance Criteria:');
    console.log(story.acceptanceCriteria.slice(0, 600) + (story.acceptanceCriteria.length > 600 ? '...' : ''));
    console.log('─'.repeat(60));
  } else {
    console.log('⚠  No Acceptance Criteria found on this story.');
    console.log('─'.repeat(60));
  }

  if (story.attachments.length > 0) {
    console.log(`Attachments (${story.attachments.length}):`);
    for (const a of story.attachments) {
      const downloaded = story.attachmentPaths.some(p => p.includes(a.filename));
      console.log(`  ${downloaded ? '✔' : '✘'} ${a.filename} (${a.mimeType})`);
    }
    console.log('─'.repeat(60));
  }

  // ── Save raw story data for the next step (P5 will parse attachments) ──────
  const outDir = path.resolve('requirements/downloads', story.storyId);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const storyDataPath = path.join(outDir, 'story-data.json');
  fs.writeFileSync(storyDataPath, JSON.stringify(story, null, 2), 'utf-8');

  console.log(`\n✅  Story data saved: ${storyDataPath}`);
  console.log(`\nNext step: run the file parser to extract text from attachments:`);
  console.log(`  npx tsx scripts/parse-attachments.ts --story=${story.storyId}`);
  console.log(`  (This becomes available after P5 is built)`);
}

run().catch(err => {
  logger.error(err.message);
  process.exit(1);
});
