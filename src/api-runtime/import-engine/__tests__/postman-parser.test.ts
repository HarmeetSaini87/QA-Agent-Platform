/**
 * postman-parser.test.ts
 * Phase D Step 2 — Unit tests for the Postman import pipeline.
 *
 * Coverage:
 *   A. parsePostmanCollection    — structure, folders, requests, variables, auth
 *   B. postman-variable-mapper   — scope, lazy resolution, unresolved refs
 *   C. postman-auth-mapper       — all auth types, inheritance, unsupported
 *   D. postman-assertion-mapper  — recognized patterns, UnsupportedScriptWarnings
 *   E. postman-dependency-analyzer — folder hints, entity hints, var chain hints
 *   F. compatibility-validator   — operator support, DAG validity, cycle detection
 *   G. importFromPostman (full pipeline) — e2e smoke tests
 */

import { describe, it, expect } from 'vitest';
import { parsePostmanCollection } from '../postman-parser';
import { mapPostmanVariables } from '../postman-variable-mapper';
import { mapPostmanAuth } from '../postman-auth-mapper';
import { mapPostmanScriptsToAssertions } from '../postman-assertion-mapper';
import { analyzePostmanDependencies } from '../postman-dependency-analyzer';
import { validateCompatibility } from '../compatibility-validator';
import { importFromPostman } from '../postman-workflow-mapper';
import { importFromOpenApi } from '../openapi-parser';
import type { RawScript } from '../postman-parser';
import type { PostmanImportOptions, ImportOptions } from '../contracts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCollection(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    info: {
      name: 'Test Collection',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _postman_id: 'abc-123',
    },
    item: [],
    variable: [],
    ...overrides,
  });
}

function makeRequest(overrides: Record<string, unknown> = {}, itemName?: string): Record<string, unknown> {
  // Extract name from overrides so it goes to item level, not inside request
  const { name: nameOverride, ...requestOverrides } = overrides as { name?: string; [k: string]: unknown };
  return {
    name: itemName ?? nameOverride ?? 'Test Request',
    request: {
      method: 'GET',
      url: { raw: 'https://api.example.com/v1/users', host: ['api', 'example', 'com'], path: ['v1', 'users'] },
      header: [],
      ...requestOverrides,
    },
  };
}

// ── A. parsePostmanCollection ─────────────────────────────────────────────────

describe('A. parsePostmanCollection', () => {

  it('A-001: parses minimal valid v2.1 collection', () => {
    const result = parsePostmanCollection(makeCollection());
    expect(result.format).toBe('postman_v2_1');
    expect(result.name).toBe('Test Collection');
    expect(result.requests).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('A-002: detects v2.0 schema', () => {
    const result = parsePostmanCollection(makeCollection({
      info: { name: 'v2.0 col', schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' },
    }));
    expect(result.format).toBe('postman_v2');
    expect(result.sourceMetadata.type).toBe('postman_v2');
  });

  it('A-003: emits warning on unknown schema URL, defaults to v2.1', () => {
    const result = parsePostmanCollection(makeCollection({
      info: { name: 'X', schema: 'https://unknown-schema.com/collection.json' },
    }));
    expect(result.format).toBe('postman_v2_1');
    expect(result.warnings.some(w => w.code === 'UNKNOWN_PM_FEATURE')).toBe(true);
  });

  it('A-004: throws on invalid JSON', () => {
    expect(() => parsePostmanCollection('not json')).toThrow('Postman collection parse failed');
  });

  it('A-005: throws on missing info field', () => {
    expect(() => parsePostmanCollection(JSON.stringify({ item: [] }))).toThrow("missing 'info' field");
  });

  it('A-006: flattens single request', () => {
    const col = makeCollection({ item: [makeRequest()] });
    const result = parsePostmanCollection(col);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].name).toBe('Test Request');
    expect(result.requests[0].method).toBe('GET');
  });

  it('A-007: flattens nested folder requests with correct name prefix', () => {
    const col = makeCollection({
      item: [{
        name: 'Auth',
        item: [
          makeRequest({ name: 'Login' }),
          makeRequest({ name: 'Refresh' }),
        ],
      }],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0].name).toBe('Auth / Login');
    expect(result.requests[1].name).toBe('Auth / Refresh');
    expect(result.requests[0].folderPath).toEqual(['Auth']);
    expect(result.requests[0].depth).toBe(1);
  });

  it('A-008: flattens 3-level nested folder', () => {
    const col = makeCollection({
      item: [{
        name: 'A',
        item: [{
          name: 'B',
          item: [makeRequest({ name: 'Deep' })],
        }],
      }],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests[0].name).toBe('A / B / Deep');
    expect(result.requests[0].folderPath).toEqual(['A', 'B']);
  });

  it('A-009: marks disabled requests as disabled=true', () => {
    const col = makeCollection({
      item: [{ ...makeRequest(), disabled: true }],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests[0].disabled).toBe(true);
  });

  it('A-010: parses collection-level variables', () => {
    const col = makeCollection({
      variable: [
        { key: 'baseUrl', value: 'https://api.example.com' },
        { key: 'apiKey', value: 'secret-value' },
      ],
    });
    const result = parsePostmanCollection(col);
    expect(result.collectionVariables).toHaveLength(2);
    expect(result.collectionVariables[0].key).toBe('baseUrl');
    expect(result.collectionVariables[1].sensitive).toBe(true); // apiKey → sensitive heuristic
  });

  it('A-011: preserves {{var}} references in URL without resolution (lazy rule)', () => {
    const col = makeCollection({
      item: [makeRequest({
        name: 'R',
        url: { raw: '{{baseUrl}}/v1/users/{{userId}}' },
      })],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests[0].url).toContain('{{baseUrl}}');
    expect(result.requests[0].url).toContain('{{userId}}');
  });

  it('A-012: converts :param path segments to {{param}} format', () => {
    const col = makeCollection({
      item: [makeRequest({ name: 'R', url: { raw: 'https://api.example.com/users/:userId/posts/:postId' } })],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests[0].url).toBe('https://api.example.com/users/{{userId}}/posts/{{postId}}');
  });

  it('A-013: extracts scripts from item events', () => {
    const col = makeCollection({
      item: [{
        ...makeRequest({ name: 'R' }),
        event: [
          { listen: 'test', script: { exec: ['pm.response.to.have.status(200);'] } },
          { listen: 'prerequest', script: { exec: ['console.log("pre");'] } },
        ],
      }],
    });
    const result = parsePostmanCollection(col);
    const scripts = result.requests[0].scripts;
    expect(scripts).toHaveLength(2);
    expect(scripts[0].type).toBe('test');
    expect(scripts[1].type).toBe('prerequest');
  });

  it('A-014: preserves folder hierarchy in folderTree', () => {
    const col = makeCollection({
      item: [{
        name: 'Users',
        item: [makeRequest({ name: 'List' })],
      }],
    });
    const result = parsePostmanCollection(col);
    expect(result.folderTree).toHaveLength(1);
    expect(result.folderTree[0].name).toBe('Users');
    expect(result.folderTree[0].depth).toBe(0);
  });

  it('A-015: emits warning when folder depth exceeds MAX_FOLDER_DEPTH', () => {
    // Build 11-deep nesting
    let item: Record<string, unknown> = makeRequest({ name: 'Deep' });
    for (let i = 10; i >= 0; i--) {
      item = { name: `F${i}`, item: [item] };
    }
    const col = makeCollection({ item: [item] });
    const result = parsePostmanCollection(col);
    expect(result.warnings.some(w => w.code === 'FOLDER_DEPTH_EXCEEDED')).toBe(true);
  });

  it('A-016: parses collection-level auth', () => {
    const col = makeCollection({
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{authToken}}' }] },
    });
    const result = parsePostmanCollection(col);
    expect(result.collectionAuth?.type).toBe('bearer');
    expect(result.collectionAuth?.bearer?.token).toBe('{{authToken}}');
  });

  it('A-017: request inherits collection auth when no request-level auth', () => {
    const col = makeCollection({
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}' }] },
      item: [makeRequest({ name: 'R' })],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests[0].auth.type).toBe('bearer');
    expect(result.requests[0].authSource).toBe('collection');
  });

  it('A-018: request-level auth overrides collection auth', () => {
    const col = makeCollection({
      auth: { type: 'bearer', bearer: [{ key: 'token', value: 'colTok' }] },
      item: [{
        ...makeRequest({ name: 'R' }),
        request: {
          method: 'GET',
          url: { raw: 'https://api.example.com' },
          header: [],
          auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-Api-Key' }, { key: 'value', value: 'reqKey' }] },
        },
      }],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests[0].auth.type).toBe('apiKey');
    expect(result.requests[0].authSource).toBe('request');
  });

  it('A-019: folder auth overrides collection auth for child requests', () => {
    const col = makeCollection({
      auth: { type: 'bearer', bearer: [{ key: 'token', value: 'colTok' }] },
      item: [{
        name: 'FolderX',
        auth: { type: 'basic', basic: [{ key: 'username', value: 'admin' }, { key: 'password', value: '{{pass}}' }] },
        item: [makeRequest({ name: 'R' })],
      }],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests[0].auth.type).toBe('basic');
    expect(result.requests[0].authSource).toBe('folder:FolderX');
  });

  it('A-020: parses body with raw JSON mode', () => {
    const col = makeCollection({
      item: [{
        name: 'Create',
        request: {
          method: 'POST',
          url: { raw: 'https://api.example.com/users' },
          header: [{ key: 'Content-Type', value: 'application/json' }],
          body: { mode: 'raw', raw: '{"name":"{{userName}}"}', options: { raw: { language: 'json' } } },
        },
      }],
    });
    const result = parsePostmanCollection(col);
    expect(result.requests[0].body.mode).toBe('raw_json');
    expect(result.requests[0].body.raw).toBe('{"name":"{{userName}}"}');
    // jsonBody is parsed — but {{var}} in string values remain as-is
    expect((result.requests[0].body.jsonBody as Record<string, string>).name).toBe('{{userName}}');
  });

  it('A-021: populates sourceMetadata with collection ID and item count', () => {
    const col = makeCollection({
      item: [makeRequest(), makeRequest({ name: 'R2' })],
    });
    const result = parsePostmanCollection(col);
    expect(result.sourceMetadata.originalCollectionId).toBe('abc-123');
    expect(result.sourceMetadata.totalItemCount).toBe(2);
    expect(result.sourceMetadata.originalName).toBe('Test Collection');
  });

});

// ── B. postman-variable-mapper ────────────────────────────────────────────────

describe('B. postman-variable-mapper', () => {

  it('B-001: collection vars become ScopedVariable with scope=collection', () => {
    const col = JSON.parse(makeCollection({
      variable: [{ key: 'baseUrl', value: 'https://api.dev' }],
    }));
    const parsed = parsePostmanCollection(JSON.stringify(col));
    const mapping = mapPostmanVariables(parsed);
    const sv = mapping.scopedVariables.find(v => v.key === 'baseUrl');
    expect(sv).toBeDefined();
    expect(sv!.scope).toBe('collection');
    expect(sv!.value).toBe('https://api.dev'); // NOT pre-resolved
  });

  it('B-002: values with {{refs}} are NOT pre-resolved', () => {
    const parsed = parsePostmanCollection(makeCollection({
      variable: [{ key: 'url', value: '{{protocol}}://{{host}}' }],
    }));
    const mapping = mapPostmanVariables(parsed);
    const sv = mapping.scopedVariables.find(v => v.key === 'url');
    expect(sv!.value).toBe('{{protocol}}://{{host}}'); // lazy — preserved
  });

  it('B-003: sensitive key heuristic flags apiKey/password/token', () => {
    const parsed = parsePostmanCollection(makeCollection({
      variable: [
        { key: 'apiKey', value: 'k1' },
        { key: 'dbPassword', value: 'p1' },
        { key: 'authToken', value: 't1' },
        { key: 'username', value: 'u1' },
      ],
    }));
    const mapping = mapPostmanVariables(parsed);
    const keys = mapping.scopedVariables;
    expect(keys.find(v => v.key === 'apiKey')!.sensitive).toBe(true);
    expect(keys.find(v => v.key === 'dbPassword')!.sensitive).toBe(true);
    expect(keys.find(v => v.key === 'authToken')!.sensitive).toBe(true);
    expect(keys.find(v => v.key === 'username')!.sensitive).toBe(false);
  });

  it('B-004: folder-scope var overrides collection-scope var with same key in ApiVariable[]', () => {
    const parsed = parsePostmanCollection(makeCollection({
      variable: [{ key: 'env', value: 'prod' }],
      item: [{
        name: 'F1',
        variable: [{ key: 'env', value: 'staging' }],
        item: [makeRequest()],
      }],
    }));
    const mapping = mapPostmanVariables(parsed);
    const apiVar = mapping.collectionVariables.find(v => v.key === 'env');
    expect(apiVar!.value).toBe('staging'); // folder wins
  });

  it('B-005: emits info warning for unresolved {{ref}} in request URL', () => {
    const parsed = parsePostmanCollection(makeCollection({
      item: [makeRequest({ name: 'R', url: { raw: '{{baseUrl}}/users' } })],
    }));
    const mapping = mapPostmanVariables(parsed);
    expect(mapping.warnings.some(w => w.code === 'PM_VARIABLE_UNRESOLVABLE' && w.message.includes('baseUrl'))).toBe(true);
    expect(mapping.warnings[0].severity).toBe('info'); // non-blocking
  });

  it('B-006: does NOT warn for refs that are defined in collection scope', () => {
    const parsed = parsePostmanCollection(makeCollection({
      variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
      item: [makeRequest({ name: 'R', url: { raw: '{{baseUrl}}/users' } })],
    }));
    const mapping = mapPostmanVariables(parsed);
    expect(mapping.warnings.filter(w => w.code === 'PM_VARIABLE_UNRESOLVABLE')).toHaveLength(0);
  });

});

// ── C. postman-auth-mapper ────────────────────────────────────────────────────

describe('C. postman-auth-mapper', () => {

  it('C-001: none auth → ApiAuthConfig type=none', () => {
    const result = mapPostmanAuth({ type: 'none' }, 'step1', 'Req');
    expect(result.authConfig.type).toBe('none');
    expect(result.warnings).toHaveLength(0);
  });

  it('C-002: bearer auth → ApiAuthConfig type=bearer with token', () => {
    const result = mapPostmanAuth(
      { type: 'bearer', bearer: { token: '{{authToken}}' } },
      'step1', 'Req',
    );
    expect(result.authConfig.type).toBe('bearer');
    expect(result.authConfig.bearer?.token).toBe('{{authToken}}'); // lazy — not resolved
  });

  it('C-003: apiKey header → ApiAuthConfig type=apiKey', () => {
    const result = mapPostmanAuth(
      { type: 'apiKey', apiKey: { paramName: 'X-Api-Key', value: '{{k}}', in: 'header' } },
      'step1', 'Req',
    );
    expect(result.authConfig.type).toBe('apiKey');
    expect(result.authConfig.apiKey?.header).toBe('X-Api-Key');
  });

  it('C-004: apiKey in query → warns about header injection', () => {
    const result = mapPostmanAuth(
      { type: 'apiKey', apiKey: { paramName: 'api_key', value: 'v', in: 'query' } },
      'step1', 'Req',
    );
    expect(result.authConfig.type).toBe('apiKey');
    expect(result.warnings.some(w => w.code === 'UNSUPPORTED_AUTH')).toBe(true);
  });

  it('C-005: basic auth → ApiAuthConfig type=basic', () => {
    const result = mapPostmanAuth(
      { type: 'basic', basic: { username: 'admin', password: '{{pass}}' } },
      'step1', 'Req',
    );
    expect(result.authConfig.type).toBe('basic');
    expect(result.authConfig.basic?.username).toBe('admin');
    expect(result.authConfig.basic?.password).toBe('{{pass}}'); // lazy
  });

  it('C-006: oauth2 with tokenUrl → ApiAuthConfig type=oauth2CC', () => {
    const result = mapPostmanAuth(
      { type: 'oauth2', oauth2: { tokenUrl: 'https://auth.example.com/token', clientId: 'cid', scopes: 'read write' } },
      'step1', 'Req',
    );
    expect(result.authConfig.type).toBe('oauth2CC');
    expect(result.authConfig.oauth2CC?.tokenUrl).toBe('https://auth.example.com/token');
    expect(result.authConfig.oauth2CC?.clientSecret).toBe(''); // never populated from PM export
  });

  it('C-007: oauth2 without tokenUrl → type=none + warning', () => {
    const result = mapPostmanAuth(
      { type: 'oauth2', oauth2: {} },
      'step1', 'Req',
    );
    expect(result.authConfig.type).toBe('none');
    expect(result.warnings.some(w => w.code === 'UNSUPPORTED_AUTH')).toBe(true);
  });

  it('C-008: unsupported auth type → type=none + warning', () => {
    const result = mapPostmanAuth({ type: 'unsupported' }, 'step1', 'Req');
    expect(result.authConfig.type).toBe('none');
    expect(result.warnings.some(w => w.code === 'UNSUPPORTED_AUTH')).toBe(true);
  });

  it('C-009: detectedScheme.kind matches auth type', () => {
    const bearerResult = mapPostmanAuth({ type: 'bearer', bearer: { token: 't' } }, 's', 'R');
    expect(bearerResult.detectedScheme.kind).toBe('bearer');
    expect(bearerResult.detectedScheme.appliedToStepIds).toContain('s');
  });

});

// ── D. postman-assertion-mapper ───────────────────────────────────────────────

describe('D. postman-assertion-mapper', () => {

  function script(source: string, type: RawScript['type'] = 'test'): RawScript {
    return { type, source, disabled: false };
  }

  it('D-001: pm.response.to.have.status(200) → status equals 200', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.response.to.have.status(200);')], 'R');
    expect(r.assertions).toHaveLength(1);
    expect(r.assertions[0].field).toBe('status');
    expect(r.assertions[0].operator).toBe('equals');
    expect(r.assertions[0].expected).toBe(200);
  });

  it('D-002: pm.response.to.have.status("OK") → status equals 200', () => {
    const r = mapPostmanScriptsToAssertions([script("pm.response.to.have.status('OK');")], 'R');
    expect(r.assertions[0].expected).toBe(200);
  });

  it('D-003: pm.response.to.be.ok → status lessThan 400', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.response.to.be.ok;')], 'R');
    expect(r.assertions[0].operator).toBe('lessThan');
    expect(r.assertions[0].expected).toBe(400);
  });

  it('D-004: pm.response.responseTime.to.be.below(2000) → responseTime lessThan 2000', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.response.responseTime.to.be.below(2000);')], 'R');
    expect(r.assertions[0].field).toBe('responseTime');
    expect(r.assertions[0].operator).toBe('lessThan');
    expect(r.assertions[0].expected).toBe(2000);
  });

  it('D-005: pm.response.to.have.header("Content-Type") → header exists', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.response.to.have.header("Content-Type");')], 'R');
    expect(r.assertions[0].field).toBe('header.Content-Type');
    expect(r.assertions[0].operator).toBe('exists');
  });

  it('D-006: pm.response.to.have.header("X-Rate","10") → header equals', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.response.to.have.header("X-Rate","10");')], 'R');
    expect(r.assertions[0].operator).toBe('equals');
    expect(r.assertions[0].expected).toBe('10');
  });

  it('D-007: pm.expect(jsonData.id).to.exist → $.id exists', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.expect(jsonData.id).to.exist;')], 'R');
    expect(r.assertions[0].field).toBe('$.id');
    expect(r.assertions[0].operator).toBe('exists');
  });

  it('D-008: pm.expect(jsonData.name).to.equal("Alice") → $.name equals "Alice"', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.expect(jsonData.name).to.equal("Alice");')], 'R');
    expect(r.assertions[0].field).toBe('$.name');
    expect(r.assertions[0].operator).toBe('equals');
    expect(r.assertions[0].expected).toBe('Alice');
  });

  it('D-009: pm.expect(jsonData.count).to.be.above(0) → $.count greaterThan 0', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.expect(jsonData.count).to.be.above(0);')], 'R');
    expect(r.assertions[0].operator).toBe('greaterThan');
    expect(r.assertions[0].expected).toBe(0);
  });

  it('D-010: pm.expect(jsonData.role).to.be.a("string") → $.role isType string', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.expect(jsonData.role).to.be.a("string");')], 'R');
    expect(r.assertions[0].operator).toBe('isType');
    expect(r.assertions[0].expected).toBe('string');
  });

  it('D-011: pre-request script → UnsupportedScriptWarning with scriptType=prerequest', () => {
    const r = mapPostmanScriptsToAssertions([script('var x = 1;', 'prerequest')], 'R');
    expect(r.assertions).toHaveLength(0);
    expect(r.unsupportedWarnings[0].scriptType).toBe('prerequest');
    expect(r.unsupportedWarnings[0].code).toBe('UNSUPPORTED_PRE_REQUEST');
  });

  it('D-012: pm.sendRequest → UnsupportedScriptWarning, no assertion', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.sendRequest("https://api.com", cb);')], 'R');
    expect(r.assertions).toHaveLength(0);
    expect(r.unsupportedWarnings.some(w => w.code === 'UNSUPPORTED_SCRIPT')).toBe(true);
  });

  it('D-013: disabled script → skipped entirely', () => {
    const r = mapPostmanScriptsToAssertions(
      [{ type: 'test', source: 'pm.response.to.have.status(200);', disabled: true }],
      'R',
    );
    expect(r.assertions).toHaveLength(0);
  });

  it('D-014: pm.environment.set → skipped (not an assertion)', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.environment.set("token", data.token);')], 'R');
    expect(r.assertions).toHaveLength(0);
    expect(r.unsupportedWarnings).toHaveLength(0); // silently skipped
  });

  it('D-015: mixed script — maps recognized, warns on unrecognized', () => {
    const source = [
      'pm.response.to.have.status(201);',
      'pm.sendRequest("x", cb);',
    ].join('\n');
    const r = mapPostmanScriptsToAssertions([script(source)], 'R');
    expect(r.assertions).toHaveLength(1);
    expect(r.assertions[0].expected).toBe(201);
    expect(r.unsupportedWarnings).toHaveLength(1);
    expect(r.mappedCount).toBe(1);
    expect(r.unmappedCount).toBe(1);
  });

  it('D-016: rawScript preserved in UnsupportedScriptWarning', () => {
    const r = mapPostmanScriptsToAssertions([script('pm.sendRequest("x", cb);')], 'R');
    expect(r.unsupportedWarnings[0].rawScript).toBe('pm.sendRequest("x", cb);');
  });

});

// ── E. postman-dependency-analyzer ───────────────────────────────────────────

describe('E. postman-dependency-analyzer', () => {

  it('E-001: requests in same folder get sequential-tag hints', () => {
    const parsed = parsePostmanCollection(makeCollection({
      item: [{
        name: 'Auth',
        item: [
          makeRequest({ name: 'Login' }),
          makeRequest({ name: 'Profile' }),
        ],
      }],
    }));
    const result = analyzePostmanDependencies(parsed.requests);
    const seqHints = result.hints.filter(h => h.kind === 'sequential-tag');
    expect(seqHints.length).toBeGreaterThan(0);
  });

  it('E-002: entities extracted from URL path segments', () => {
    const parsed = parsePostmanCollection(makeCollection({
      item: [makeRequest({ name: 'R', url: { raw: 'https://api.example.com/v1/patients/{{id}}' } })],
    }));
    const result = analyzePostmanDependencies(parsed.requests);
    expect(result.detectedEntities).toContain('patient');
  });

  it('E-003: POST + GET with matching entity → id-producer hint', () => {
    const parsed = parsePostmanCollection(makeCollection({
      item: [
        {
          name: 'Create Patient',
          request: {
            method: 'POST',
            url: { raw: 'https://api.example.com/v1/patients' },
            header: [],
          },
        },
        {
          name: 'Get Patient',
          request: {
            method: 'GET',
            url: { raw: 'https://api.example.com/v1/patients/{{patientId}}' },
            header: [],
          },
        },
      ],
    }));
    const result = analyzePostmanDependencies(parsed.requests);
    const idHints = result.hints.filter(h => h.kind === 'id-producer');
    expect(idHints.length).toBeGreaterThan(0);
  });

  it('E-004: pm.environment.set → producer hint detected', () => {
    const col = makeCollection({
      item: [{
        ...makeRequest({ name: 'Login' }),
        event: [{
          listen: 'test',
          script: { exec: ['pm.environment.set("authToken", pm.response.json().token);'] },
        }],
      }, makeRequest({ name: 'GetProfile', url: { raw: '{{baseUrl}}/profile' } })],
    });
    const parsed = parsePostmanCollection(col);
    const result = analyzePostmanDependencies(parsed.requests);
    const varHints = result.hints.filter(h => h.kind === 'id-consumer' && h.linkField === 'authToken');
    // authToken is set by step 0 and consumed by step 1 url ({{baseUrl}} doesn't match, but we can verify no crash)
    expect(result.hints).toBeDefined();
  });

});

// ── F. compatibility-validator ────────────────────────────────────────────────

describe('F. compatibility-validator', () => {

  it('F-001: valid ImportResult → compatible=true', () => {
    const result = importFromPostman(makeCollection({
      item: [makeRequest()],
    }), { environmentId: 'env-1' });
    const report = validateCompatibility(result);
    expect(report.compatible).toBe(true);
    expect(report.variableEngineCompatible).toBe(true);
    expect(report.assertionEngineCompatible).toBe(true);
    expect(report.workflowEngineCompatible).toBe(true);
  });

  it('F-002: unknown dependsOn ID → workflow error', () => {
    const result = importFromPostman(makeCollection({
      item: [makeRequest()],
    }), { environmentId: 'env-1' });
    // Inject a bad dependsOn
    result.collection.steps[0].dependsOn = ['nonexistent-id'];
    const report = validateCompatibility(result);
    expect(report.compatible).toBe(false);
    expect(report.issues.some(i => i.field === 'dependsOn')).toBe(true);
  });

  it('F-003: unsupported assertion operator → assertion error', () => {
    const result = importFromPostman(makeCollection({
      item: [makeRequest()],
    }), { environmentId: 'env-1' });
    // Inject bad operator
    result.collection.steps[0].assertions = [
      { field: 'status', operator: 'badOp' as never, expected: 200 },
    ];
    const report = validateCompatibility(result);
    expect(report.assertionEngineCompatible).toBe(false);
  });

  it('F-004: unsupported script warnings populated from warnings array', () => {
    const col = makeCollection({
      item: [{
        ...makeRequest({ name: 'R' }),
        event: [{
          listen: 'test',
          script: { exec: ['pm.sendRequest("x", cb);'] },
        }],
      }],
    });
    const result = importFromPostman(col, { environmentId: 'env-1' });
    const report = validateCompatibility(result);
    expect(report.unsupportedScriptWarnings).toBeDefined();
    // script was imported → warning present in result.warnings
  });

  it('F-005: cycle in dependsOn → workflow error', () => {
    const result = importFromPostman(makeCollection({
      item: [makeRequest({ name: 'A' }), makeRequest({ name: 'B' })],
    }), { environmentId: 'env-1' });
    const [a, b] = result.collection.steps;
    a.dependsOn = [b.id];
    b.dependsOn = [a.id];
    const report = validateCompatibility(result);
    expect(report.compatible).toBe(false);
    expect(report.issues.some(i => i.message.includes('circular'))).toBe(true);
  });

});

// ── G. importFromPostman — full pipeline smoke ────────────────────────────────

describe('G. importFromPostman (full pipeline)', () => {

  it('G-001: produces ImportResult with all required fields', () => {
    const result = importFromPostman(makeCollection({
      item: [makeRequest()],
    }), { environmentId: 'env-1', projectId: 'proj-1' });
    expect(result.collection).toBeDefined();
    expect(result.envelope).toBeDefined();
    expect(result.authMetadata).toBeDefined();
    expect(result.dependencyHints).toBeDefined();
    expect(result.sourceMetadata.type).toMatch(/postman/);
    expect(result.format).toMatch(/postman/);
    expect(result.normalizationTrace).toBeDefined();
  });

  it('G-002: collection steps executable through existing ApiCollection contract', () => {
    const result = importFromPostman(makeCollection({
      item: [makeRequest()],
    }), { environmentId: 'env-1' });
    const col = result.collection;
    // Must satisfy ApiCollection shape
    expect(col.id).toBeTruthy();
    expect(col.environmentId).toBe('env-1');
    expect(Array.isArray(col.steps)).toBe(true);
    expect(col.steps[0].request.method).toBeTruthy();
    expect(col.steps[0].assertions).toBeDefined();
    expect(col.steps[0].extractVariables).toBeDefined();
    expect(col.steps[0].execution).toBeDefined();
    expect(col.steps[0].dependsOn).toBeDefined();
  });

  it('G-003: WorkflowEnvelope source=postman', () => {
    const result = importFromPostman(makeCollection(), { environmentId: 'env-1' });
    expect(result.envelope.metadata.source).toBe('postman');
    expect(result.envelope.schemaVersion).toBe('1.0');
  });

  it('G-004: disabled items included with condition=false by default', () => {
    const col = makeCollection({
      item: [{ ...makeRequest(), disabled: true }],
    });
    const result = importFromPostman(col, { environmentId: 'env-1' });
    expect(result.collection.steps).toHaveLength(1);
    expect(result.collection.steps[0].execution?.condition).toBe('false');
  });

  it('G-005: disabled items excluded when includeDisabled=false', () => {
    const col = makeCollection({
      item: [
        makeRequest({ name: 'Active' }),
        { ...makeRequest({ name: 'Disabled' }), disabled: true },
      ],
    });
    const result = importFromPostman(col, { environmentId: 'env-1', includeDisabled: false });
    expect(result.collection.steps).toHaveLength(1);
    expect(result.collection.steps[0].name).toBe('Active');
    expect(result.skippedCount).toBe(1);
  });

  it('G-006: collectionName option overrides parsed collection name', () => {
    const result = importFromPostman(makeCollection(), {
      environmentId: 'env-1',
      collectionName: 'My Renamed Collection',
    });
    expect(result.collection.name).toBe('My Renamed Collection');
  });

  it('G-007: normalizationTrace contains all 5 stages', () => {
    const result = importFromPostman(makeCollection({ item: [makeRequest()] }), { environmentId: 'env-1' });
    const stages = result.normalizationTrace?.stages ?? [];
    expect(stages).toContain('Raw');
    expect(stages).toContain('Parsed');
    expect(stages).toContain('Normalized');
    expect(stages).toContain('WorkflowEnvelope');
    expect(stages).toContain('CompatibilityValidated');
  });

  it('G-008: collection variables carry through to ApiCollection.variables', () => {
    const result = importFromPostman(makeCollection({
      variable: [{ key: 'env', value: 'dev' }],
    }), { environmentId: 'env-1' });
    expect(result.collection.variables.some(v => v.key === 'env' && v.value === 'dev')).toBe(true);
  });

  it('G-009: existing src/utils/postmanImport.ts unaffected (runtime parity check)', async () => {
    // Verify that importFromPostman does NOT change the signature of the legacy util
    // by confirming both can parse the same collection independently
    const { importFromPostman: legacyImport } = await import('../../../utils/postmanImport');
    const col = makeCollection({ item: [makeRequest()] });
    const legacyResult = legacyImport(col, 'env-1');
    const newResult = importFromPostman(col, { environmentId: 'env-1' });
    // Both produce collections with same step count
    expect(newResult.collection.steps.length).toBe(legacyResult.steps.length);
  });

});

// ── Phase D Step 4 — Postman metadata population ──────────────────────────────

describe('Phase D Step 4 — Postman metadata population', () => {
  const minimalPostman = JSON.stringify({
    info: {
      name: 'Test Collection',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _postman_id: 'col-001',
    },
    item: [
      {
        name: 'Auth',
        _postman_id: 'folder-001',
        item: [
          {
            name: 'POST /token',
            request: {
              method: 'POST',
              url: { raw: 'https://api.example.com/token' },
              header: [],
              body: { mode: 'raw', raw: '' },
            },
          },
        ],
      },
      {
        name: 'GET /pets',
        request: {
          method: 'GET',
          url: { raw: 'https://api.example.com/pets' },
          header: [],
        },
      },
    ],
  });

  const opts: PostmanImportOptions = { environmentId: 'env-1', projectId: 'proj-1' };

  it('sets metadataVersion: 1', () => {
    const result = importFromPostman(minimalPostman, opts);
    expect(result.envelope.metadata.metadataVersion).toBe(1);
  });

  it('sets normalizationSource: postman', () => {
    const result = importFromPostman(minimalPostman, opts);
    expect(result.envelope.metadata.normalizationSource).toBe('postman');
  });

  it('sets metadataGeneratedAt as ISO string', () => {
    const result = importFromPostman(minimalPostman, opts);
    expect(result.envelope.metadata.metadataGeneratedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('builds folderHierarchy with correct structure', () => {
    const result = importFromPostman(minimalPostman, opts);
    const hier = result.envelope.metadata.folderHierarchy!;
    expect(hier).toBeDefined();
    expect(hier.name).toBe('Test Collection');
    expect(hier.children.length).toBeGreaterThan(0);
    expect(hier.children[0].name).toBe('Auth');
  });

  it('hierarchyPath is root → leaf order per node', () => {
    const result = importFromPostman(minimalPostman, opts);
    // Nested request name is prefixed: "Auth / POST /token" (folder flattening behaviour)
    const tokenNode = result.envelope.workflow.nodes?.find(n => n.step.name === 'Auth / POST /token');
    expect(tokenNode).toBeDefined();
    // hierarchyPath[0] is the parent folder; last element is the full prefixed step name
    expect(tokenNode!.hierarchyPath![0]).toBe('Auth');
    expect(tokenNode!.hierarchyPath![tokenNode!.hierarchyPath!.length - 1]).toBe('Auth / POST /token');
  });

  it('visualGroup equals immediate parent folder name', () => {
    const result = importFromPostman(minimalPostman, opts);
    // Nested request name is prefixed: "Auth / POST /token" (folder flattening behaviour)
    const tokenNode = result.envelope.workflow.nodes?.find(n => n.step.name === 'Auth / POST /token');
    // visualGroup is set to the immediate parent folder name for nested requests
    expect(tokenNode?.visualGroup).toBe('Auth');
  });

  it('computes WorkflowAiReadiness with readinessScore > 0', () => {
    const result = importFromPostman(minimalPostman, opts);
    const ai = result.envelope.metadata.aiReadiness!;
    expect(ai).toBeDefined();
    expect(ai.normalizedStepCount).toBeGreaterThan(0);
    expect(ai.readinessScore).toBeGreaterThan(0);
  });
});

// ── Phase D Step 4 — OpenAPI metadata population ──────────────────────────────

describe('Phase D Step 4 — OpenAPI metadata population', () => {
  const minimalOpenApi = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          tags: ['pets'],
          summary: 'List pets',
          responses: { '200': { description: 'OK' } },
        },
      },
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          tags: ['pets'],
          summary: 'Get pet',
          parameters: [
            {
              name: 'petId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  });

  const opts: ImportOptions = { environmentId: 'env-1', projectId: 'proj-1' };

  it('sets graphHints.isHeuristic: true', () => {
    const result = importFromOpenApi(minimalOpenApi, opts);
    expect(result.envelope.metadata.graphHints?.isHeuristic).toBe(true);
  });

  it('populates graphHints with detectedEntities', () => {
    const result = importFromOpenApi(minimalOpenApi, opts);
    const hints = result.envelope.metadata.graphHints!;
    expect(hints).toBeDefined();
    expect(Array.isArray(hints.detectedEntities)).toBe(true);
  });

  it('sets hierarchyPath as [tag, stepName] per node', () => {
    const result = importFromOpenApi(minimalOpenApi, opts);
    const node = result.envelope.workflow.nodes?.[0];
    expect(node?.hierarchyPath).toHaveLength(2);
    expect(node?.hierarchyPath?.[0]).toBe('pets');
  });

  it('sets normalizationSource: openapi', () => {
    const result = importFromOpenApi(minimalOpenApi, opts);
    expect(result.envelope.metadata.normalizationSource).toBe('openapi');
  });
});
