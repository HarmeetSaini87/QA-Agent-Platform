/**
 * script-sandbox.ts
 * Phase B Step 7 extraction from apiRunner.ts.
 *
 * Moved: runScript (pre/post script VM sandbox execution).
 * apiRunner.ts retains commented-out original per CLAUDE.md rule.
 *
 * Sandbox invariants preserved:
 *   - variable context is frozen (no mutation from user scripts)
 *   - response is frozen when provided
 *   - setVar() is the only mutation surface — returns key→value map
 *   - 500ms timeout prevents infinite loops
 *   - script errors are non-fatal (warn only)
 */

import vm from 'node:vm';
import type { VariableContext } from '../../utils/apiVariables';
import type { ApiResponseSnapshot } from '../../data/types';

export function runScript(
  script: string,
  variables: VariableContext,
  response?: ApiResponseSnapshot
): Record<string, string> {
  const mutations: Record<string, string> = {};
  try {
    const sandbox = vm.createContext({
      ...Object.freeze({ ...variables }),
      response: response ? Object.freeze(response) : undefined,
      setVar: (key: string, val: string) => { mutations[key] = val; },
    });
    vm.runInContext(script, sandbox, { timeout: 500 });
  } catch (e) {
    console.warn('[script-sandbox] script error:', e instanceof Error ? e.message : String(e));
  }
  return mutations;
}
