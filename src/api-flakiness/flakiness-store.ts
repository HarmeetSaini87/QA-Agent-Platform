// src/api-flakiness/flakiness-store.ts
import * as fs from 'fs';
import * as path from 'path';
import type { CollectionFlakinessReport } from './contracts/flakiness.contracts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const FLAKINESS_DIR = path.join(DATA_DIR, 'api-flakiness');

function ensureDir(): void {
  if (!fs.existsSync(FLAKINESS_DIR)) fs.mkdirSync(FLAKINESS_DIR, { recursive: true });
}

export function saveReport(report: CollectionFlakinessReport): void {
  ensureDir();
  const filePath = path.join(FLAKINESS_DIR, `${report.collectionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
}

export function loadReport(collectionId: string): CollectionFlakinessReport | undefined {
  const filePath = path.join(FLAKINESS_DIR, `${collectionId}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CollectionFlakinessReport;
}

export function listReportIds(): string[] {
  if (!fs.existsSync(FLAKINESS_DIR)) return [];
  return fs.readdirSync(FLAKINESS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}
