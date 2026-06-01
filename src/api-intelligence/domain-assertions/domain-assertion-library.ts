// src/api-intelligence/domain-assertions/domain-assertion-library.ts
// Pre-built assertion template packs for enterprise domains.
// Pure module — no DB/HTTP calls. ADVISORY ONLY — never auto-applied.

import type { ApiAssertion } from '../../data/types';

export type DomainId =
  | 'general-rest'
  | 'ecommerce'
  | 'fintech'
  | 'salesforce-crm'
  | 'paginated-api';

export interface DomainPack {
  id: DomainId;
  name: string;
  description: string;
  tags: string[];
  assertions: ApiAssertion[];
  advisoryNote: string;
}

const ADVISORY = 'Domain assertions are advisory templates. Review expected values before saving — they are starting points, not production-ready assertions.';

// ── Domain Packs ──────────────────────────────────────────────────────────────

const GENERAL_REST: DomainPack = {
  id: 'general-rest',
  name: 'General REST API',
  description: 'Baseline assertions applicable to any REST endpoint: status, content-type, response time, and body existence.',
  tags: ['rest', 'baseline', 'universal'],
  advisoryNote: ADVISORY,
  assertions: [
    {
      field: 'status',
      operator: 'equals',
      expected: '200',
      severity: 'critical',
      weight: 10,
      message: 'Expected HTTP 200 OK',
    },
    {
      field: 'header.content-type',
      operator: 'contains',
      expected: 'application/json',
      severity: 'high',
      weight: 8,
      message: 'Response must be JSON',
    },
    {
      field: 'responseTime',
      operator: 'lessThan',
      expected: '2000',
      severity: 'soft',
      weight: 4,
      message: 'Response time must be under 2 s',
    },
    {
      field: 'bodyIsJson',
      operator: 'equals',
      expected: 'true',
      severity: 'high',
      weight: 7,
      message: 'Response body must be valid JSON',
    },
  ],
};

const ECOMMERCE: DomainPack = {
  id: 'ecommerce',
  name: 'eCommerce API',
  description: 'Assertions for product catalogues, orders, pricing, inventory, and cart APIs. Covers Shopify, Magento, WooCommerce patterns.',
  tags: ['ecommerce', 'shopify', 'magento', 'woocommerce', 'orders', 'products'],
  advisoryNote: ADVISORY,
  assertions: [
    {
      field: 'status',
      operator: 'equals',
      expected: '200',
      severity: 'critical',
      weight: 10,
      message: 'Expected HTTP 200 OK',
    },
    {
      field: 'header.content-type',
      operator: 'contains',
      expected: 'application/json',
      severity: 'high',
      weight: 8,
      message: 'Response must be JSON',
    },
    {
      field: 'responseTime',
      operator: 'lessThan',
      expected: '3000',
      severity: 'soft',
      weight: 3,
      message: 'Catalogue/order APIs must respond within 3 s',
    },
    {
      field: '$.id',
      operator: 'exists',
      severity: 'critical',
      weight: 9,
      message: 'Resource must have an id field',
    },
    {
      field: '$.price',
      operator: 'greaterThan',
      expected: '0',
      severity: 'high',
      weight: 8,
      message: 'Price must be positive',
    },
    {
      field: '$.currency',
      operator: 'exists',
      severity: 'high',
      weight: 7,
      message: 'Currency field must be present',
    },
    {
      field: '$.status',
      operator: 'exists',
      severity: 'medium',
      weight: 5,
      message: 'Order/product status field must exist',
    },
    {
      field: '@arrayLength:$.items',
      operator: 'greaterThan',
      expected: '0',
      severity: 'soft',
      weight: 4,
      message: 'Items array should not be empty (adjust if single-resource endpoint)',
    },
  ],
};

const FINTECH: DomainPack = {
  id: 'fintech',
  name: 'Fintech & Banking API',
  description: 'Assertions for payment, transaction, account, and ledger APIs. Strict SLA, monetary integrity, and no-error-field checks.',
  tags: ['fintech', 'banking', 'payments', 'transactions', 'stripe', 'plaid'],
  advisoryNote: ADVISORY,
  assertions: [
    {
      field: 'status',
      operator: 'equals',
      expected: '200',
      severity: 'critical',
      weight: 10,
      message: 'Fintech API must return 200',
    },
    {
      field: 'header.content-type',
      operator: 'contains',
      expected: 'application/json',
      severity: 'critical',
      weight: 9,
      message: 'Response must be JSON',
    },
    {
      field: 'responseTime',
      operator: 'lessThan',
      expected: '1000',
      severity: 'high',
      weight: 8,
      message: 'Payment APIs must respond within 1 s (SLA critical)',
    },
    {
      field: '$.transaction_id',
      operator: 'exists',
      severity: 'critical',
      weight: 10,
      message: 'Transaction ID must be present',
    },
    {
      field: '$.amount',
      operator: 'exists',
      severity: 'critical',
      weight: 10,
      message: 'Amount field must exist',
    },
    {
      field: '$.currency',
      operator: 'matches',
      expected: '^[A-Z]{3}$',
      severity: 'high',
      weight: 8,
      message: 'Currency must be a 3-letter ISO 4217 code (e.g. USD, EUR, GBP)',
    },
    {
      field: '$.error',
      operator: 'notExists',
      severity: 'critical',
      weight: 10,
      message: 'Response must not contain an error field',
    },
    {
      field: '$.status',
      operator: 'notEquals',
      expected: 'failed',
      severity: 'high',
      weight: 9,
      message: 'Transaction status must not be "failed"',
    },
    {
      field: 'bodyIsJson',
      operator: 'equals',
      expected: 'true',
      severity: 'critical',
      weight: 9,
      message: 'Body must be valid JSON — required for ledger safety',
    },
  ],
};

const SALESFORCE_CRM: DomainPack = {
  id: 'salesforce-crm',
  name: 'Salesforce / CRM API',
  description: 'Assertions for Salesforce REST API, SOQL query results, record CRUD, and standard CRM platforms (HubSpot, Dynamics).',
  tags: ['salesforce', 'crm', 'hubspot', 'dynamics', 'soql', 'records'],
  advisoryNote: ADVISORY,
  assertions: [
    {
      field: 'status',
      operator: 'equals',
      expected: '200',
      severity: 'critical',
      weight: 10,
      message: 'Expected 200 OK',
    },
    {
      field: 'header.content-type',
      operator: 'contains',
      expected: 'application/json',
      severity: 'high',
      weight: 8,
      message: 'Response must be JSON',
    },
    {
      field: 'responseTime',
      operator: 'lessThan',
      expected: '5000',
      severity: 'soft',
      weight: 3,
      message: 'CRM API should respond within 5 s',
    },
    {
      field: '$.Id',
      operator: 'exists',
      severity: 'critical',
      weight: 9,
      message: 'Salesforce record must have an Id field',
    },
    {
      field: '$.success',
      operator: 'equals',
      expected: 'true',
      severity: 'critical',
      weight: 10,
      message: 'success flag must be true (Salesforce DML response)',
    },
    {
      field: '$.totalSize',
      operator: 'greaterThan',
      expected: '0',
      severity: 'high',
      weight: 7,
      message: 'SOQL query must return at least one record',
    },
    {
      field: '@arrayLength:$.records',
      operator: 'greaterThan',
      expected: '0',
      severity: 'high',
      weight: 7,
      message: 'records array must not be empty',
    },
    {
      field: '$.errors',
      operator: 'isEmpty',
      severity: 'critical',
      weight: 9,
      message: 'errors array must be empty (Salesforce DML)',
    },
  ],
};

const PAGINATED_API: DomainPack = {
  id: 'paginated-api',
  name: 'Paginated / List API',
  description: 'Assertions for list endpoints with pagination: data array, total count, page metadata, and navigation links.',
  tags: ['pagination', 'list', 'cursor', 'offset', 'rest', 'collection'],
  advisoryNote: ADVISORY,
  assertions: [
    {
      field: 'status',
      operator: 'equals',
      expected: '200',
      severity: 'critical',
      weight: 10,
      message: 'Expected HTTP 200 OK',
    },
    {
      field: 'header.content-type',
      operator: 'contains',
      expected: 'application/json',
      severity: 'high',
      weight: 8,
      message: 'Response must be JSON',
    },
    {
      field: 'responseTime',
      operator: 'lessThan',
      expected: '3000',
      severity: 'soft',
      weight: 3,
      message: 'Paginated list should respond within 3 s',
    },
    {
      field: '$.data',
      operator: 'exists',
      severity: 'critical',
      weight: 9,
      message: 'data array must exist (adjust field name if API uses "items", "results", etc.)',
    },
    {
      field: '@arrayLength:$.data',
      operator: 'greaterThan',
      expected: '0',
      severity: 'high',
      weight: 8,
      message: 'data array must not be empty for a seeded dataset',
    },
    {
      field: '$.total',
      operator: 'greaterThan',
      expected: '0',
      severity: 'high',
      weight: 7,
      message: 'total count must be positive',
    },
    {
      field: '$.page',
      operator: 'exists',
      severity: 'medium',
      weight: 5,
      message: 'page field should exist (adjust if using cursor-based pagination)',
    },
    {
      field: '$.pageSize',
      operator: 'exists',
      severity: 'medium',
      weight: 5,
      message: 'pageSize field should exist',
    },
    {
      field: 'bodyIsJson',
      operator: 'equals',
      expected: 'true',
      severity: 'high',
      weight: 8,
      message: 'Body must be valid JSON',
    },
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────────

const DOMAIN_REGISTRY: Record<DomainId, DomainPack> = {
  'general-rest': GENERAL_REST,
  'ecommerce': ECOMMERCE,
  'fintech': FINTECH,
  'salesforce-crm': SALESFORCE_CRM,
  'paginated-api': PAGINATED_API,
};

export function listDomains(): Omit<DomainPack, 'assertions'>[] {
  return Object.values(DOMAIN_REGISTRY).map(({ assertions: _a, ...meta }) => meta);
}

export function getDomainPack(domainId: string): DomainPack | undefined {
  return DOMAIN_REGISTRY[domainId as DomainId];
}

export function getAllDomainIds(): DomainId[] {
  return Object.keys(DOMAIN_REGISTRY) as DomainId[];
}
