// src/api-plugins/examples/custom-json-assertion.plugin.ts
// Phase F — Example Plugin: custom-json-assertion (custom-assertion type)
//
// Adds a jsonPathCount operator: assert that the array at a given JSONPath
// has exactly the expected number of elements.
//
// Example assertion: { operator: 'jsonPathCount', field: '$.data', expected: 5 }
//
// ADVISORY: example only. Register via loadExamplePlugins(). Never auto-registered.

import type { PluginManifest } from '../contracts/plugin-manifest.contracts';
import { globalPluginRegistry } from '../plugin-registry';
import { globalHookRegistry, makeHookRegistration } from '../hook-registry';

export const CUSTOM_JSON_ASSERTION_PLUGIN_ID = 'example.custom-json-assertion';

export const customJsonAssertionManifest: PluginManifest = {
  pluginId: CUSTOM_JSON_ASSERTION_PLUGIN_ID,
  name: 'Custom JSON Array Count Assertion',
  version: '1.0.0',
  author: 'TestForge Examples',
  description:
    'Adds the "jsonPathCount" assertion operator. Evaluates the length of an array ' +
    'at a given JSONPath against an expected count. Demonstrates custom-assertion ' +
    'plugin pattern. Advisory only — does not alter execution or retries.',
  capabilities: ['custom-assertion'],
  isolationTier: 'enrichment',
  requiredRoles: ['admin', 'editor', 'tester'],
  registeredAt: new Date().toISOString(),
};

/** Evaluates the jsonPathCount operator against a response body. Pure function. */
export function evaluateJsonPathCount(
  responseBody: unknown,
  jsonPath: string,
  expectedCount: number,
): { passed: boolean; actual: number | null; message: string } {
  // Simple dot-notation resolver for top-level paths (e.g. $.data, $.items)
  // For production use, replace with a full JSONPath library.
  const key = jsonPath.replace(/^\$\./, '').replace(/^\$\['/, '').replace(/'\]$/, '');
  const body = responseBody as Record<string, unknown>;
  const value = body?.[key];

  if (!Array.isArray(value)) {
    return {
      passed: false,
      actual: null,
      message: `jsonPathCount: "${jsonPath}" did not resolve to an array (got ${typeof value})`,
    };
  }

  const actual = value.length;
  const passed = actual === expectedCount;
  return {
    passed,
    actual,
    message: passed
      ? `jsonPathCount: "${jsonPath}" has ${actual} element(s) ✓`
      : `jsonPathCount: "${jsonPath}" expected ${expectedCount} element(s) but got ${actual}`,
  };
}

/**
 * Registers the custom-json-assertion plugin manifest + assertion hook.
 * Call only via loadExamplePlugins() — never called automatically.
 */
export function registerCustomJsonAssertionPlugin(): void {
  globalPluginRegistry.register(customJsonAssertionManifest);
  globalPluginRegistry.enable(CUSTOM_JSON_ASSERTION_PLUGIN_ID);

  const hookReg = makeHookRegistration(CUSTOM_JSON_ASSERTION_PLUGIN_ID, 'assertion', 20);
  globalHookRegistry.registerHook(hookReg);
}

export const CUSTOM_JSON_ASSERTION_USAGE = `
## custom-json-assertion plugin

**Type:** custom-assertion
**Hook:** assertion (priority 20)
**New operator:** \`jsonPathCount\`

### How it works
When the assertion engine encounters operator \`jsonPathCount\`, it delegates to
\`evaluateJsonPathCount(responseBody, field, expected)\`.

### Example step assertion
\`\`\`json
{
  "field": "$.data",
  "operator": "jsonPathCount",
  "expected": 5
}
\`\`\`
Passes if \`response.body.data\` is an array with exactly 5 elements.

### Registration
\`\`\`typescript
registerCustomJsonAssertionPlugin();
\`\`\`

### evaluateJsonPathCount API
\`\`\`typescript
evaluateJsonPathCount(responseBody, '$.data', 5)
// → { passed: true, actual: 5, message: '...' }
\`\`\`
`;
