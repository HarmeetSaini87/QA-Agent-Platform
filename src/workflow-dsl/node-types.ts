/**
 * node-types.ts
 * Future workflow node type registry.
 *
 * Phase A: type definitions ONLY — no implementation.
 * Phase B+: execution-engine will switch on WorkflowNodeType.
 *
 * Current MVP uses ApiTestStep for all nodes (type = 'HTTP' implicitly).
 * This file prepares for named node types without changing existing steps.
 */

export type WorkflowNodeType =
  | 'HTTP'          // standard API request — current ApiTestStep maps here
  | 'ASSERTION'     // standalone assertion node (Phase C)
  | 'EXTRACT'       // variable extraction node (Phase C)
  | 'CONDITION'     // conditional branch (Phase C)
  | 'TRANSFORM'     // request/response transformer (Phase D)
  | 'PARALLEL'      // parallel fan-out gate (Phase C)
  | 'CONTRACT'      // OpenAPI contract check (Phase C)
  | 'AI'            // AI-generated step (Phase E)
  | 'LOOP';         // loop over dataset (Phase E)

/**
 * NodeCapability — used by Phase F plugin system to declare what a node supports.
 */
export interface NodeCapability {
  type: WorkflowNodeType;
  supportsRetry: boolean;
  supportsCondition: boolean;
  supportsExtraction: boolean;
  supportsAssertion: boolean;
  supportsParallel: boolean;
}

export const CORE_NODE_CAPABILITIES: Record<'HTTP', NodeCapability> = {
  HTTP: {
    type: 'HTTP',
    supportsRetry: true,
    supportsCondition: true,
    supportsExtraction: true,
    supportsAssertion: true,
    supportsParallel: true,
  },
};
