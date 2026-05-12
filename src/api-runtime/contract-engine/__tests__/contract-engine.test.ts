import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContractEngine, ContractEngineStub, getContractEngine, setContractEngine } from '../engine';
import { evictSchema, specExists } from '../spec-loader';
import type { ApiResponseSnapshot } from '../../../../data/types';

function makeSnap(overrides: Partial<ApiResponseSnapshot> = {}): ApiResponseSnapshot {
  return {
    status: 200, headers: {}, body: {}, bodyTruncated: false, durationMs: 10,
    ...overrides,
  };
}

// ── Helpers: write a temp spec file ──────────────────────────────────────────

let tmpDir: string;
let origDataDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-contract-'));
  fs.mkdirSync(path.join(tmpDir, 'openapi-specs'));
  origDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = origDataDir;
  // Evict any cached validators that referenced temp spec files
  evictSchema('valid-spec', 200);
  evictSchema('broken-schema', 200);
  evictSchema('no-body-spec', 200);
});

function writeSpec(specId: string, spec: unknown): void {
  fs.writeFileSync(
    path.join(tmpDir, 'openapi-specs', `${specId}.json`),
    JSON.stringify(spec)
  );
}

function makeMinimalSpec(schema: unknown): unknown {
  return {
    paths: {
      '/resource': {
        get: {
          responses: {
            '200': {
              content: { 'application/json': { schema } },
            },
          },
        },
      },
    },
  };
}

// ── Group 1: ContractEngineStub ───────────────────────────────────────────────

describe('ContractEngineStub', () => {
  const stub = new ContractEngineStub();

  it('validate always returns valid=true', async () => {
    const r = await stub.validate('any-spec', makeSnap());
    expect(r.valid).toBe(true);
    expect(r.specMissing).toBe(true);
  });

  it('checkDrift always returns empty array', () => {
    expect(stub.checkDrift('any', makeSnap())).toEqual([]);
  });

  it('detectDrift always returns empty array', async () => {
    expect(await stub.detectDrift('col', 'step', makeSnap())).toEqual([]);
  });
});

// ── Group 2: ContractEngine — spec missing ────────────────────────────────────

describe('ContractEngine — spec missing', () => {
  const engine = new ContractEngine();

  it('returns valid=true with specMissing=true when spec file absent', async () => {
    const r = await engine.validate('no-such-spec', makeSnap());
    expect(r.valid).toBe(true);
    expect(r.specMissing).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('checkDrift returns [] when spec absent', () => {
    expect(engine.checkDrift('no-such-spec', makeSnap())).toEqual([]);
  });
});

// ── Group 3: ContractEngine — valid response ──────────────────────────────────

describe('ContractEngine — valid response', () => {
  it('returns valid=true for body matching schema', async () => {
    writeSpec('valid-spec', makeMinimalSpec({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    }));
    const engine = new ContractEngine();
    const r = await engine.validate('valid-spec', makeSnap({ body: { id: 42 } }));
    expect(r.valid).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.specMissing).toBe(false);
  });

  it('checkDrift returns [] for valid body', () => {
    writeSpec('valid-spec', makeMinimalSpec({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    }));
    const engine = new ContractEngine();
    expect(engine.checkDrift('valid-spec', makeSnap({ body: { id: 1 } }))).toEqual([]);
  });
});

// ── Group 4: ContractEngine — violation ──────────────────────────────────────

describe('ContractEngine — violations', () => {
  it('returns violations for body failing required field', async () => {
    writeSpec('valid-spec', makeMinimalSpec({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    }));
    const engine = new ContractEngine();
    const r = await engine.validate('valid-spec', makeSnap({ body: {} }));
    expect(r.valid).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.violations[0].severity).toBe('breaking');
  });

  it('checkDrift returns violation strings for invalid body', () => {
    writeSpec('valid-spec', makeMinimalSpec({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    }));
    const engine = new ContractEngine();
    const msgs = engine.checkDrift('valid-spec', makeSnap({ body: {} }));
    expect(msgs.length).toBeGreaterThan(0);
    expect(typeof msgs[0]).toBe('string');
  });
});

// ── Group 5: spec with no matching status ─────────────────────────────────────

describe('ContractEngine — no status match', () => {
  it('returns valid=true when spec has no entry for the response status', async () => {
    writeSpec('no-body-spec', makeMinimalSpec({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    }));
    const engine = new ContractEngine();
    // spec defines 200 but response is 404
    const r = await engine.validate('no-body-spec', makeSnap({ status: 404, body: {} }));
    expect(r.valid).toBe(true);
  });
});

// ── Group 6: singleton ────────────────────────────────────────────────────────

describe('getContractEngine / setContractEngine', () => {
  it('getContractEngine returns same instance each call', () => {
    const a = getContractEngine();
    const b = getContractEngine();
    expect(a).toBe(b);
  });

  it('setContractEngine allows stub injection', () => {
    const saved = getContractEngine();
    const stub = new ContractEngineStub();
    setContractEngine(stub);
    expect(getContractEngine()).toBe(stub);
    setContractEngine(saved); // restore
  });
});

// ── Group 7: detectDrift stub (Phase C placeholder) ──────────────────────────

describe('ContractEngine — detectDrift', () => {
  it('returns empty array (Phase C placeholder)', async () => {
    const engine = new ContractEngine();
    const violations = await engine.detectDrift('col1', 'step1', makeSnap());
    expect(violations).toEqual([]);
  });
});
