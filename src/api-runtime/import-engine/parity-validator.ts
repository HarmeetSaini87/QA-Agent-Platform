import { importFromPostman as legacyImportFromPostman } from '../../utils/postmanImport';
import { adaptPostmanImport } from './import-engine-adapter';

export interface ParityReport {
  legacyStepCount: number;
  newStepCount: number;
  stepCountMatch: boolean;
  methodMismatches: Array<{ stepIndex: number; legacy: string; new: string }>;
  urlMismatches: Array<{ stepIndex: number; legacy: string; new: string }>;
  nameMismatches: Array<{ stepIndex: number; legacy: string; new: string }>;
  overallParity: boolean;
  /** New-importer warnings not present in legacy */
  newImporterWarnings: string[];
  error?: string;
}

export function validatePostmanParity(collectionJson: string, environmentId: string): ParityReport {
  try {
    const legacyCollection = legacyImportFromPostman(collectionJson, environmentId);
    const newResult = adaptPostmanImport(collectionJson, environmentId);
    const newCollection = newResult.collection;

    const legacyStepCount = legacyCollection.steps.length;
    const newStepCount = newCollection.steps.length;
    const stepCountMatch = legacyStepCount === newStepCount;
    const compareCount = Math.min(legacyStepCount, newStepCount);

    const methodMismatches: ParityReport['methodMismatches'] = [];
    const urlMismatches: ParityReport['urlMismatches'] = [];
    const nameMismatches: ParityReport['nameMismatches'] = [];

    for (let i = 0; i < compareCount; i++) {
      const ls = legacyCollection.steps[i];
      const ns = newCollection.steps[i];

      const lMethod = ls.request.method?.toUpperCase() ?? '';
      const nMethod = ns.request.method?.toUpperCase() ?? '';
      if (lMethod !== nMethod) methodMismatches.push({ stepIndex: i, legacy: lMethod, new: nMethod });

      const lUrl = ls.request.url ?? '';
      const nUrl = ns.request.url ?? '';
      if (lUrl !== nUrl) urlMismatches.push({ stepIndex: i, legacy: lUrl, new: nUrl });

      if (ls.name !== ns.name) nameMismatches.push({ stepIndex: i, legacy: ls.name, new: ns.name });
    }

    const overallParity =
      stepCountMatch &&
      methodMismatches.length === 0 &&
      urlMismatches.length === 0;

    return {
      legacyStepCount,
      newStepCount,
      stepCountMatch,
      methodMismatches,
      urlMismatches,
      nameMismatches,
      overallParity,
      newImporterWarnings: newResult.warnings.map(w => `[${w.severity}] ${w.code}: ${w.message}`),
    };
  } catch (e) {
    return {
      legacyStepCount: 0,
      newStepCount: 0,
      stepCountMatch: false,
      methodMismatches: [],
      urlMismatches: [],
      nameMismatches: [],
      overallParity: false,
      newImporterWarnings: [],
      error: (e as Error).message,
    };
  }
}
