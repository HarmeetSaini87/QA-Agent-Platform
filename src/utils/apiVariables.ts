import { JSONPath } from 'jsonpath-plus';
import type { ApiVariableExtraction, ApiResponseSnapshot } from '../data/types';

export type VariableContext = Record<string, string>;

export class VariableConflictError extends Error {
  key: string; stepA: string; stepB: string;
  constructor(key: string, stepA: string, stepB: string) {
    super(`Variable conflict on "${key}" between steps "${stepA}" and "${stepB}"`);
    this.name = 'VariableConflictError';
    this.key = key; this.stepA = stepA; this.stepB = stepB;
  }
}

const VAR_RE = /\{\{([^}]+)\}\}|\$\{([^}]+)\}/g;

// ── Dynamic value generators (spec §5.3) ──────────────────────────────────────

const FIRST_NAMES = ['Alice','Bob','Carol','David','Emma','Frank','Grace','Henry','Iris','James',
  'Kate','Liam','Mia','Noah','Olivia','Paul','Quinn','Rose','Sam','Tara'];
const LAST_NAMES  = ['Anderson','Brown','Clark','Davis','Evans','Fisher','Garcia','Hill','Jones','King',
  'Lee','Miller','Nelson','Owen','Parker','Quinn','Reed','Smith','Taylor','White'];
const DOMAINS     = ['example.com','test.io','mail.dev','fake.org','sample.net'];

function resolveDynamic(type: string, format?: string): string {
  switch (type) {
    case 'uuid':
    case 'faker_uuid':
      return crypto.randomUUID();
    case 'timestamp':
      return format === 'unix' ? String(Math.floor(Date.now() / 1000)) : new Date().toISOString();
    case 'env':
      return format ? (process.env[format] ?? '') : '';
    case 'random_int': {
      const [minS, maxS] = (format ?? '0:100').split(':');
      const min = parseInt(minS ?? '0', 10);
      const max = parseInt(maxS ?? '100', 10);
      return String(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    case 'random_string': {
      const len = parseInt(format ?? '8', 10);
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }
    case 'faker_name': {
      const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
      const ln = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
      return `${fn} ${ln}`;
    }
    case 'faker_email': {
      const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)].toLowerCase();
      const ln = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)].toLowerCase();
      const d  = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
      return `${fn}.${ln}@${d}`;
    }
    default:
      return '';
  }
}

// Syntax: {{$dynamic:type}} or {{$dynamic:type:format}}
const DYNAMIC_RE = /^\$dynamic:([^:]+)(?::(.+))?$/;

export function substituteVars(template: string, context: VariableContext): string {
  return template.replace(VAR_RE, (_, a, b) => {
    const key = (a ?? b) as string;
    const dynMatch = DYNAMIC_RE.exec(key);
    if (dynMatch) return resolveDynamic(dynMatch[1], dynMatch[2]);
    return Object.prototype.hasOwnProperty.call(context, key) ? context[key] : `{{${key}}}`;
  });
}

export function snapshotContext(ctx: VariableContext): VariableContext {
  return { ...ctx };
}

export function mergeStepLocals(
  shared: VariableContext,
  stepLocals: Record<string, VariableContext>,
  policy: 'last-write-wins' | 'error-on-conflict'
): VariableContext {
  const result: VariableContext = { ...shared };
  const seen: Record<string, string> = {};

  for (const [stepId, locals] of Object.entries(stepLocals)) {
    for (const [key, value] of Object.entries(locals)) {
      if (policy === 'error-on-conflict' && Object.prototype.hasOwnProperty.call(seen, key)) {
        throw new VariableConflictError(key, seen[key], stepId);
      }
      seen[key] = stepId;
      result[key] = value;
    }
  }
  return result;
}

export function extractVariables(
  extractions: ApiVariableExtraction[],
  response: ApiResponseSnapshot
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const e of extractions) {
    try {
      let value: string | undefined;
      if (e.source === 'statusCode') {
        value = String(response.status);
      } else if (e.source === 'responseHeader') {
        const headerKey = Object.keys(response.headers).find(
          k => k.toLowerCase() === e.path.toLowerCase()
        );
        value = headerKey ? response.headers[headerKey] : undefined;
      } else {
        // responseBody — JSONPath
        const results = JSONPath({ path: e.path, json: response.body as object });
        value = results.length > 0 ? String(results[0]) : undefined;
      }
      if (value !== undefined) out[e.name] = value;
    } catch {
      // extraction failure is non-fatal
    }
  }
  return out;
}
