import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { RawExcelRow, RequirementDoc } from '../types/plan.types';
import { logger } from './logger';

/**
 * Reads the predefined TC Excel/CSV template and returns a RequirementDoc.
 * Column mapping is based on the agreed template format.
 *
 * Required columns: TC ID, Title, Module, Priority, Expected Result
 * Step columns:     Step 1, Step 2, ... Step N (any number)
 * Test data cols:   Any column not in the reserved list is treated as test data
 */

const RESERVED_COLUMNS = new Set([
  'tc id', 'title', 'module', 'priority', 'preconditions',
  'expected result', 'tags'
]);

const isStepColumn = (col: string) => /^step\s*\d+$/i.test(col.trim());

export function readExcelFile(filePath: string): RequirementDoc {
  const ext = path.extname(filePath).toLowerCase();
  let rows: Record<string, string>[];

  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets[sheetName],
      { defval: '' }
    );
  } else {
    throw new Error(`Unsupported file format: ${ext}. Use .xlsx, .xls, or .csv`);
  }

  logger.info(`Read ${rows.length} rows from ${path.basename(filePath)}`);

  // ── Column classification log (first row only) ──────────────────────────────
  // RULE: Metadata cols (TC ID, Title, Module, Priority, Preconditions, Expected Result, Tags)
  //       are used ONLY for reporting/grouping. They are NOT converted to test steps.
  //       Step cols (Step 1, Step 2 … Step N) are the ONLY source of automation logic.
  //       All remaining cols become testData key-value pairs (input values for steps).
  if (rows.length > 0) {
    const sampleNorm = Object.keys(rows[0]).map(k => k.toLowerCase().trim());
    const metaCols   = sampleNorm.filter(k => RESERVED_COLUMNS.has(k));
    const stepCols   = sampleNorm.filter(isStepColumn);
    const dataCols   = sampleNorm.filter(k => !RESERVED_COLUMNS.has(k) && !isStepColumn(k));
    logger.info(`Column classification — Metadata: [${metaCols.join(', ')}] | Steps: [${stepCols.join(', ')}] | TestData: [${dataCols.join(', ')}]`);
  }

  const rawRows: RawExcelRow[] = rows.map((row, index) => {
    // Normalise column keys to lowercase for case-insensitive matching
    const normRow: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      normRow[k.toLowerCase().trim()] = String(v).trim();
    }

    // Extract step columns in order
    const stepCols = Object.keys(normRow)
      .filter(isStepColumn)
      .sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''));
        const numB = parseInt(b.replace(/\D/g, ''));
        return numA - numB;
      });

    const steps = stepCols
      .map(col => normRow[col])
      .filter(s => s && s.length > 0);

    // Extract test data — any column that is not reserved and not a step column
    const testData: Record<string, string> = {};
    for (const [col, val] of Object.entries(normRow)) {
      if (!RESERVED_COLUMNS.has(col) && !isStepColumn(col) && val) {
        // Restore original casing from the original row key
        const originalKey = Object.keys(row).find(k => k.toLowerCase().trim() === col) || col;
        testData[originalKey] = val;
      }
    }

    if (!normRow['tc id']) {
      logger.warn(`Row ${index + 2} is missing TC ID — skipping`);
    }

    return {
      tcId: normRow['tc id'] || `TC_AUTO_${index + 1}`,
      title: normRow['title'] || '',
      module: normRow['module'] || 'General',
      priority: normRow['priority'] || 'medium',
      preconditions: normRow['preconditions'] || '',
      steps,
      expectedResult: normRow['expected result'] || '',
      testData,
      tags: normRow['tags'] || '',
    };
  }).filter(row => row.tcId && row.title);

  return {
    source: 'excel',
    sourceRef: path.basename(filePath),
    rawRows,
  };
}
