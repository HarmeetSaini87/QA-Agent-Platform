/**
 * parse-attachments.ts
 * Parses already-downloaded Jira attachments for a story,
 * combines all text, and writes a RequirementDoc JSON.
 *
 * Run AFTER fetch-jira-story.ts has downloaded the files.
 *
 * Usage:
 *   npx tsx scripts/parse-attachments.ts --story=PROJ-123
 *   npx tsx scripts/parse-attachments.ts --file=requirements/uploads/my-prd.pdf
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { parseFile, parseFiles, combineIntoContext } from '../src/utils/fileParser';
import { logger } from '../src/utils/logger';
import { RequirementDoc } from '../src/types/plan.types';
import { config } from '../src/framework/config';

dotenv.config();

// ── Args ──────────────────────────────────────────────────────────────────────

const storyArg = process.argv.find(a => a.startsWith('--story='))?.split('=').slice(1).join('=');
const fileArg  = process.argv.find(a => a.startsWith('--file='))?.split('=').slice(1).join('=');

if (!storyArg && !fileArg) {
  console.error('❌  Provide --story=PROJ-123 or --file=path/to/file');
  process.exit(1);
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function run() {
  logger.info('━━━ File Parser ━━━');

  let filePaths: string[] = [];
  let source: RequirementDoc['source'];
  let sourceRef: string;
  let storyData: Record<string, unknown> | null = null;

  // ── Mode 1: Parse attachments from a fetched Jira story ───────────────────
  if (storyArg) {
    const storyId = storyArg.toUpperCase();
    const downloadDir = path.resolve(config.paths.requirements, 'downloads', storyId);
    const storyDataPath = path.join(downloadDir, 'story-data.json');

    if (!fs.existsSync(storyDataPath)) {
      logger.error(`Story data not found at: ${storyDataPath}`);
      logger.error(`Run first: npm run fetch-jira -- --story=${storyId}`);
      process.exit(1);
    }

    storyData = JSON.parse(fs.readFileSync(storyDataPath, 'utf-8'));
    filePaths = (storyData!.attachmentPaths as string[]) ?? [];
    source = 'jira';
    sourceRef = storyId;

    if (filePaths.length === 0) {
      logger.warn('No attachment files found for this story. Using story text only.');
    }
  }

  // ── Mode 2: Parse a single uploaded file ──────────────────────────────────
  if (fileArg) {
    const resolved = path.resolve(fileArg);
    if (!fs.existsSync(resolved)) {
      logger.error(`File not found: ${resolved}`);
      process.exit(1);
    }
    filePaths = [resolved];
    source = 'prd-upload';
    sourceRef = path.basename(resolved);
  }

  // ── Parse all files ───────────────────────────────────────────────────────
  logger.info(`Parsing ${filePaths.length} file(s)...`);
  const parsedFiles = await parseFiles(filePaths);
  const context = combineIntoContext(parsedFiles);

  // ── Build RequirementDoc ──────────────────────────────────────────────────
  const doc: RequirementDoc & { _attachmentPaths?: string[]; _imageFilePaths?: string[] } = {
    source: source!,
    sourceRef: sourceRef!,
    summary:             storyData ? String(storyData.summary ?? '') : '',
    description:         storyData ? String(storyData.description ?? '') : '',
    acceptanceCriteria:  storyData ? String(storyData.acceptanceCriteria ?? '') : '',
    attachmentTexts:     context.fullText ? [context.fullText] : [],
    _attachmentPaths:    context.imageFilePaths,  // For AI visual inspection
    _imageFilePaths:     context.imageFilePaths,
  };

  // ── Print results ─────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`Source     : ${doc.source} (${doc.sourceRef})`);
  if (doc.summary) console.log(`Summary    : ${doc.summary}`);
  console.log('─'.repeat(60));
  console.log('Parsed files:');

  for (const pf of parsedFiles) {
    const status = pf.error
      ? `✘ ERROR: ${pf.error}`
      : pf.isImage
        ? `⊙ IMAGE  (${pf.filename}) — AI visual inspection`
        : `✔ OK     (${pf.filename}) — ${pf.text.length} chars extracted`;
    console.log(`  ${status}`);
  }

  if (context.failedFiles.length > 0) {
    console.log(`\n⚠  Failed to parse: ${context.failedFiles.join(', ')}`);
  }
  if (context.imageFilePaths.length > 0) {
    console.log(`\nImages for AI visual inspection (${context.imageFilePaths.length}):`);
    context.imageFilePaths.forEach(p => console.log(`  • ${p}`));
  }

  console.log(`\nCombined text: ${context.fullText.length} chars`);
  if (context.fullText.length > 0) {
    console.log('\nPreview (first 400 chars):');
    console.log('─'.repeat(60));
    console.log(context.fullText.slice(0, 400) + (context.fullText.length > 400 ? '...' : ''));
  }
  console.log('─'.repeat(60));

  // ── Save RequirementDoc ───────────────────────────────────────────────────
  const outDir = storyArg
    ? path.resolve(config.paths.requirements, 'downloads', storyArg.toUpperCase())
    : path.resolve(config.paths.requirements, 'uploads');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const docPath = path.join(outDir, 'requirement-doc.json');
  fs.writeFileSync(docPath, JSON.stringify(doc, null, 2), 'utf-8');

  console.log(`\n✅  RequirementDoc saved: ${docPath}`);
  console.log(`\nNext step: open your AI IDE and say:`);
  if (storyArg) {
    console.log(`  "Generate a test plan from the requirement doc at ${docPath}"`);
  } else {
    console.log(`  "Generate a test plan from the requirement doc at ${docPath}"`);
  }
}

run().catch(err => {
  logger.error(err.message);
  process.exit(1);
});
