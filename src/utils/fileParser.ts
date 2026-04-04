/**
 * fileParser.ts
 * Extracts plain text from uploaded / downloaded attachment files.
 *
 * Supported formats:
 *   PDF       → pdf-parse
 *   Word      → mammoth (.docx, .doc)
 *   Excel/CSV → xlsx + csv-parse (treats each sheet as a table)
 *   Text/MD   → fs.readFileSync
 *   Images    → metadata noted + path preserved for AI visual inspection
 *   Other     → skipped with a warning
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parse as parseCsv } from 'csv-parse/sync';
import { logger } from './logger';

// ── Result types ──────────────────────────────────────────────────────────────

export interface ParsedFile {
  filePath: string;
  filename: string;
  extension: string;
  text: string;           // Extracted plain text
  pageCount?: number;     // PDFs only
  sheetCount?: number;    // Excel only
  isImage: boolean;       // If true — AI should inspect visually
  error?: string;         // Set if parsing failed
}

export interface CombinedContext {
  fullText: string;                // All text merged — sent to AI planner
  parsedFiles: ParsedFile[];       // Individual results for reporting
  imageFilePaths: string[];        // Paths the AI should inspect visually
  failedFiles: string[];           // Files that could not be parsed
}

// ── File type detection ───────────────────────────────────────────────────────

const EXT_MAP: Record<string, string> = {
  '.pdf':  'pdf',
  '.docx': 'word',
  '.doc':  'word',
  '.xlsx': 'excel',
  '.xls':  'excel',
  '.csv':  'csv',
  '.txt':  'text',
  '.md':   'text',
  '.text': 'text',
  '.png':  'image',
  '.jpg':  'image',
  '.jpeg': 'image',
  '.gif':  'image',
  '.bmp':  'image',
  '.webp': 'image',
  '.tiff': 'image',
  '.tif':  'image',
};

function detectType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_MAP[ext] ?? 'unknown';
}

// ── Individual parsers ────────────────────────────────────────────────────────

async function parsePdf(filePath: string): Promise<{ text: string; pageCount: number }> {
  // Dynamic import — pdf-parse uses require() internally
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);
  return {
    text: result.text.replace(/\s{3,}/g, '\n').trim(),
    pageCount: result.numpages,
  };
}

async function parseWord(filePath: string): Promise<{ text: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mammoth = require('mammoth') as {
    extractRawText: (opts: { path: string }) => Promise<{ value: string; messages: unknown[] }>;
  };
  const result = await mammoth.extractRawText({ path: filePath });
  return { text: result.value.trim() };
}

function parseExcel(filePath: string): { text: string; sheetCount: number } {
  const workbook = XLSX.readFile(filePath);
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    if (rows.length === 0) continue;

    parts.push(`--- Sheet: ${sheetName} ---`);

    // Header row
    const headers = Object.keys(rows[0]);
    parts.push(headers.join(' | '));
    parts.push('-'.repeat(60));

    // Data rows
    for (const row of rows) {
      const values = headers.map(h => String(row[h] ?? '').trim());
      // Skip fully empty rows
      if (values.every(v => v === '')) continue;
      parts.push(values.join(' | '));
    }
    parts.push('');
  }

  return {
    text: parts.join('\n').trim(),
    sheetCount: workbook.SheetNames.length,
  };
}

function parseCsvFile(filePath: string): { text: string } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parseCsv(content, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];

  if (rows.length === 0) return { text: '' };

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(' | '),
    '-'.repeat(60),
    ...rows.map(r => headers.map(h => r[h] ?? '').join(' | ')),
  ];
  return { text: lines.join('\n').trim() };
}

function parseText(filePath: string): { text: string } {
  const content = fs.readFileSync(filePath, 'utf-8');
  return { text: content.trim() };
}

function describeImage(filePath: string): { text: string } {
  const stats = fs.statSync(filePath);
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toUpperCase().replace('.', '');
  return {
    text: `[IMAGE FILE: ${filename} | Format: ${ext} | Size: ${(stats.size / 1024).toFixed(1)} KB | Path: ${filePath}]\nThis image requires visual inspection by the AI agent.`,
  };
}

// ── Main parser ───────────────────────────────────────────────────────────────

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const filename = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const type = detectType(filePath);

  const base: ParsedFile = {
    filePath,
    filename,
    extension,
    text: '',
    isImage: type === 'image',
  };

  if (!fs.existsSync(filePath)) {
    return { ...base, error: `File not found: ${filePath}` };
  }

  try {
    switch (type) {
      case 'pdf': {
        const { text, pageCount } = await parsePdf(filePath);
        logger.info(`  PDF parsed: ${filename} (${pageCount} pages, ${text.length} chars)`);
        return { ...base, text, pageCount };
      }
      case 'word': {
        const { text } = await parseWord(filePath);
        logger.info(`  Word parsed: ${filename} (${text.length} chars)`);
        return { ...base, text };
      }
      case 'excel': {
        const { text, sheetCount } = parseExcel(filePath);
        logger.info(`  Excel parsed: ${filename} (${sheetCount} sheets, ${text.length} chars)`);
        return { ...base, text, sheetCount };
      }
      case 'csv': {
        const { text } = parseCsvFile(filePath);
        logger.info(`  CSV parsed: ${filename} (${text.length} chars)`);
        return { ...base, text };
      }
      case 'text': {
        const { text } = parseText(filePath);
        logger.info(`  Text parsed: ${filename} (${text.length} chars)`);
        return { ...base, text };
      }
      case 'image': {
        const { text } = describeImage(filePath);
        logger.info(`  Image noted: ${filename} (visual inspection required)`);
        return { ...base, text, isImage: true };
      }
      default:
        logger.warn(`  Skipped unsupported file type: ${filename} (${extension})`);
        return { ...base, error: `Unsupported file type: ${extension}` };
    }
  } catch (err) {
    const message = (err as Error).message;
    logger.warn(`  Failed to parse ${filename}: ${message}`);
    return { ...base, error: message };
  }
}

export async function parseFiles(filePaths: string[]): Promise<ParsedFile[]> {
  const results: ParsedFile[] = [];
  for (const fp of filePaths) {
    results.push(await parseFile(fp));
  }
  return results;
}

// ── Combiner — merges all texts into one AI context block ─────────────────────

export function combineIntoContext(parsedFiles: ParsedFile[]): CombinedContext {
  const textBlocks: string[] = [];
  const imageFilePaths: string[] = [];
  const failedFiles: string[] = [];

  for (const pf of parsedFiles) {
    if (pf.error) {
      failedFiles.push(pf.filename);
      continue;
    }
    if (pf.isImage) {
      imageFilePaths.push(pf.filePath);
      textBlocks.push(`\n=== ATTACHMENT: ${pf.filename} (IMAGE — see path for visual inspection) ===\n${pf.text}`);
    } else if (pf.text.trim()) {
      textBlocks.push(`\n=== ATTACHMENT: ${pf.filename} ===\n${pf.text}`);
    }
  }

  return {
    fullText: textBlocks.join('\n\n').trim(),
    parsedFiles,
    imageFilePaths,
    failedFiles,
  };
}
