/**
 * types.ts — shared data model types
 */

// OLD: type Role = 'admin' | 'tester' | 'viewer';
export type Role = 'admin' | 'editor' | 'tester' | 'viewer';

export interface User {
  id:                   string;
  username:             string;
  email:                string;
  passwordHash:         string;
  role:                 Role;
  isActive:             boolean;
  forcePasswordChange:  boolean;
  createdAt:            string;
  createdBy:            string | null;
  lastLogin:            string | null;
}

export interface ProjectEnvironment {
  id:   string;
  name: string;   // e.g. "DEV", "QA", "UAT", "PROD"
  url:  string;   // base URL for this environment
}

export interface Project {
  id:           string;
  name:         string;
  description:  string;
  tcIdPrefix:   string;         // e.g. "ABC" → generates ABC-01, ABC-02 …
  tcIdCounter:  number;         // auto-increments per project, starts at 1
  environments: ProjectEnvironment[];
  isActive:     boolean;
  createdAt:    string;
  createdBy:    string;
  jiraProjectKey?: string;         // e.g. "BANK" — overrides global jira-config.json projectKey
  // Legacy — kept for backward compat with old data; ignored by new UI
  appUrl?:      string;
  credentials?: ProjectCredential[];
  flakinessDefaults?: Partial<import('../utils/flakinessEngine').FlakinessConfig>;
}

export interface ProjectCredential {
  key:   string;
  value: string;
}

// ── Self-Healing Locator types ────────────────────────────────────────────────

export interface LocatorAlternative {
  selector:     string;
  selectorType: string;
  confidence:   number;   // 0–100
}

export interface HealingProfile {
  tag:          string;
  text:         string | null;
  ariaLabel:    string | null;
  role:         string | null;
  classes:      string[];
  placeholder:  string | null;
  testId:       string | null;
  parentTag:    string | null;
  parentId:     string | null;
  parentClass:  string | null;
  domDepth:     number;
  siblingIndex: number;
  capturedAt:   string;
  capturedFrom: 'recorder' | 'prescan' | 'manual';
}

export interface HealingStats {
  healCount:      number;
  lastHealedAt:   string | null;
  lastHealedFrom: string | null;
  lastHealedBy:   'auto' | 'approved' | null;
}

export interface PageModel {
  id:           string;
  projectId:    string;
  pageKey:      string;   // normalised URL pattern e.g. /patients/:id/records
  pageName:     string;
  locatorIds:   string[];
  capturedAt:   string;
  capturedFrom: 'recorder' | 'prescan';
}

export interface HealingProposal {
  id:              string;
  projectId:       string;
  locatorId:       string;
  locatorName:     string;
  scriptId:        string;
  scriptTitle:     string;
  stepOrder:       number;
  oldSelector:     string;
  oldSelectorType: string;
  newSelector:     string;
  newSelectorType: string;
  confidence:      number;
  healedAt:        string;
  status:          'auto-applied' | 'pending-review' | 'approved' | 'approved-temporary' | 'rejected';
  reviewedBy?:     string;
  reviewedAt?:     string;
  screenshotPath?: string;
  usedInRun?:      boolean;   // true = candidate was used to continue execution (non-blocking path)
}

export interface Locator {
  id:             string;
  name:           string;           // human-readable alias e.g. "Login Button"
  selector:       string;           // actual CSS/XPath/id
  selectorType:   'css' | 'xpath' | 'id' | 'name' | 'text' | 'testid' | 'role' | 'label' | 'placeholder' | 'nth' | 'last';
  pageModule:     string;           // e.g. "Mediation Config - Gateway Type"
  projectId:      string | null;    // scoped to project or global
  description:    string;
  draft?:         boolean;          // true = recorder-created, not yet saved to a script
  createdBy:      string;
  createdAt:      string;
  updatedAt:      string;
  // ── Self-Healing fields (optional — populated by recorder v4+) ────────────
  importanceScore?:  number;               // 0–100 stability rating
  alternatives?:     LocatorAlternative[]; // fallback selectors with confidence scores
  healingProfile?:   HealingProfile;       // element fingerprint for similarity matching
  healingStats?:     HealingStats;         // runtime heal event counters
  pageKey?:          string | null;        // normalised URL at time of recording
  frameContext?:     string | null;        // iframe selector when locator lives inside iframe e.g. "#flowIframe"
  // ── Name provenance (naming preservation feature) ─────────────────────────
  nameSource?:       'auto' | 'user';      // 'auto' = recorder-generated, 'user' = human-renamed (immutable to recorder)
  updatedBy?:        string;               // last editor username — audit trail, foundation for future optimistic locking
}

export interface CommonFunction {
  id:          string;
  projectId:   string | null;
  name:        string;           // e.g. "Login as Admin"
  identifier:  string;           // unique per project, alphanumeric + underscore, e.g. "login_user"
  description: string;
  steps:       FunctionStep[];
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
}

export interface FunctionStep {
  order:       number;
  keyword:     string;
  // Locator fields — mirror ScriptStep but use 'selector' (not 'locator') for the value
  locatorName: string | null;   // human-readable name, e.g. "Username"
  locatorType: string;          // css | xpath | id | name | testid | role | label | text
  selector:    string | null;   // actual locator value for the chosen type
  description: string;
  // Legacy fields (kept for backward-compatibility with old data)
  detail?:  string;
  value?:   string | null;
}

// ── Test Script ───────────────────────────────────────────────────────────────

export interface TestDataRow {
  value: string;   // actual value used in execution
}

export interface FnStepValue {
  fnStepIdx: number;                                            // index of the function step
  valueMode: 'static' | 'dynamic' | 'commondata' | 'testdata';
  value:     string | null;
  testData:  TestDataRow[];
}

export interface ScriptStep {
  id:            string;
  order:         number;
  keyword:       string;         // e.g. "CLICK", "FILL", "ASSERT TEXT"
  locator:       string | null;  // DOM selector (required when keyword.needsLocator)
  locatorId:     string | null;  // reference to Locator repo entry
  locatorType:   string;         // css | xpath | id | name | text | testid | role | label
  valueMode:     'static' | 'dynamic' | 'commondata' | 'testdata' | 'variable';
  value:         string | null;  // static value, dynamic token, ${cdKey}, fn name, or var name
  testData:      TestDataRow[];  // rows for Test Data (Static) mode
  fnStepValues?: FnStepValue[];  // per-child-step values when keyword = CALL FUNCTION
  description:   string;
  screenshot:    boolean;
  // ── Variable Store (session scope) ────────────────────────────────────────
  storeAs?:      string;         // variable name to save result into e.g. "patientId"
  storeScope?:   'session' | 'global';  // session = current script only; global = shared across suite
  storeSource?:  'text' | 'value' | 'attr' | 'js';  // only for SET VARIABLE keyword
  storeAttrName?: string;        // attribute name when storeSource = 'attr'
  // ── Frame context (set by SWITCH_FRAME steps) ─────────────────────────────
  // When non-null, this step executes inside an iframe. Value is the iframe
  // CSS selector e.g. "#flowIframe". Propagated by recorderParser from
  // RecorderEvent.frameContext and consumed by codegenGenerator + debugger.
  frameContext?:  string | null;  // iframe selector e.g. "#flowIframe", null = top frame
}

export interface TestScript {
  id:          string;
  projectId:   string;
  tcId:        string;          // auto-generated e.g. "MED-01"
  component:   string;          // categorization e.g. "Login", "Billing"
  subcomponent?: string;        // optional; matches Subcomponent.name at save time
  title:       string;
  description: string;
  tags:        string[];
  priority:    'low' | 'medium' | 'high' | 'critical';
  steps:       ScriptStep[];
  createdBy:   string;
  createdAt:   string;
  modifiedBy:  string;
  modifiedAt:  string;
}

// ── Component / Subcomponent ──────────────────────────────────────────────────

export interface Subcomponent {
  id:   string;
  name: string;
}

export interface ComponentDef {
  id:            string;
  projectId:     string;
  name:          string;
  subcomponents: Subcomponent[];
  createdAt:     string;
}

// ── Common Data ───────────────────────────────────────────────────────────────

export interface CommonData {
  id:          string;
  projectId:   string;
  dataName:    string;   // unique per project+environment
  value:       string;   // stored as enc:<base64> when sensitive=true
  environment: string;   // e.g. "QA", "UAT", "DEV", "PROD"
  moduleType:  'ui' | 'api' | 'shared';  // which module owns this record
  sensitive:   boolean;  // if true: value shown masked in UI, stored encrypted
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
}

// ── API Key ───────────────────────────────────────────────────────────────────

export interface ApiKey {
  id:          string;
  name:        string;        // human label e.g. "ADO Pipeline — QA"
  keyHash:     string;        // SHA-256 hex of the raw key — never store raw
  prefix:      string;        // first 8 chars of raw key shown in UI for identification
  projectId:   string | null; // null = all projects
  createdBy:   string;
  createdAt:   string;
  lastUsedAt:  string | null;
  expiresAt:   string | null; // ISO or null = never
}

// ── Test Suite ────────────────────────────────────────────────────────────────

export interface SuiteHookStep {
  order:       number;
  keyword:     string;
  locator:     string;   // raw selector or locator name
  value:       string;
  description: string;
}

export interface OverlayHandler {
  type:   'alert' | 'confirm' | 'prompt' | 'any';  // dialog type to handle
  action: 'accept' | 'dismiss';                     // what to do
  text?:  string;                                   // for prompt: text to type before accepting
}

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface TestSuite {
  id:            string;
  projectId:     string;
  name:          string;
  description:   string;
  scriptIds:     string[];       // ordered list of TestScript IDs
  environmentId: string | null;  // selected environment for execution
  retries:       0 | 1 | 2;     // Playwright --retries flag (0 = disabled)
  browsers:      BrowserName[];  // browsers to run against; defaults to ['chromium']
  beforeEachSteps: SuiteHookStep[];
  afterEachSteps:  SuiteHookStep[];
  fastMode:        boolean;
  fastModeSteps:   SuiteHookStep[];
  overlayHandlers: OverlayHandler[];
  createdBy:     string;
  createdAt:     string;
  modifiedBy:    string;
  modifiedAt:    string;
  flakinessOverrides?: Partial<import('../utils/flakinessEngine').FlakinessConfig>;
  beforeAllApiCollectionId?: string;
  blockOnApiFailure?: boolean;
}

// ── Scheduled Run ─────────────────────────────────────────────────────────────

export interface ScheduledRun {
  id:             string;
  projectId:      string;
  suiteId:        string;
  environmentId:  string;
  cronExpression: string;   // standard 5-field cron: "0 9 * * 1-5"
  label:          string;   // human-readable name e.g. "Weekday regression"
  enabled:        boolean;
  createdBy:      string;
  createdAt:      string;
  lastRunId?:     string;
  lastRunAt?:     string;
}

export interface AuditEntry {
  id:           string;
  userId:       string | null;
  username:     string | null;
  action:       string;           // e.g. "USER_LOGIN", "PROJECT_CREATED", "TC_RUN"
  resourceType: string | null;
  resourceId:   string | null;
  details:      string | null;
  ip:           string | null;
  createdAt:    string;
}

export interface NotificationSettings {
  // Email (SMTP)
  emailEnabled:    boolean;
  smtpHost:        string;
  smtpPort:        number;
  smtpSecure:      boolean;   // true = TLS (port 465), false = STARTTLS (port 587)
  smtpUser:        string;
  smtpPass:        string;
  emailFrom:       string;    // "QA Platform <noreply@company.com>"
  emailTo:         string;    // comma-separated recipient list
  // Slack
  slackEnabled:    boolean;
  slackWebhook:    string;    // incoming webhook URL
  // Microsoft Teams
  teamsEnabled:    boolean;
  teamsWebhook:    string;    // Power Automate / Office 365 connector URL
  // Trigger rules
  notifyOnFailure: boolean;   // send when a suite run has ≥1 failure
  notifyOnSuccess: boolean;   // send when a suite run passes 100%
  notifyOnAlways:  boolean;   // send on every completed run regardless
}

export interface AppSettings {
  sessionTimeoutMinutes: number;
  allowRegistration:     boolean;
  appName:               string;
  maxFailedLogins:       number;
  notifications:         NotificationSettings;
  nlProvider?:           string;   // 'anthropic'|'openai'|'groq'|'gemini'|'ollama'|'compatible'
  nlApiKey?:             string;   // API key for cloud providers (stored server-side only)
  nlModel?:              string;   // model name / tag
  nlBaseUrl?:            string;   // Ollama or compatible endpoint base URL
  // Legacy field — kept for backwards compat, migrated to nlApiKey on first save
  anthropicApiKey?:      string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  emailEnabled:    false,
  smtpHost:        '',
  smtpPort:        587,
  smtpSecure:      false,
  smtpUser:        '',
  smtpPass:        '',
  emailFrom:       '',
  emailTo:         '',
  slackEnabled:    false,
  slackWebhook:    '',
  teamsEnabled:    false,
  teamsWebhook:    '',
  notifyOnFailure: true,
  notifyOnSuccess: false,
  notifyOnAlways:  false,
};

export const DEFAULT_SETTINGS: AppSettings = {
  sessionTimeoutMinutes: 60,
  allowRegistration:     false,
  appName:               'QA Agent Platform',
  maxFailedLogins:       5,
  notifications:         DEFAULT_NOTIFICATION_SETTINGS,
};

// ── Licensing ─────────────────────────────────────────────────────────────────

// P4-01: Boolean feature keys — can be individually overridden in a .lic file
export type FeatureKey = 'recorder' | 'debugger' | 'scheduler' | 'sso' | 'apiAccess' | 'whiteLabel';

export interface LicensePayload {
  tier:         'starter' | 'team' | 'enterprise' | 'trial';
  orgId:        string;
  orgName:      string;
  seats:        number;        // -1 = unlimited
  maxInstances: number;        // -1 = unlimited; how many machines may activate this key
  expiresAt:    string;        // ISO date string
  machineId?:   string;        // P3-02: signed into .lic — tamper-proof machine binding
  features: {
    recorder:    boolean;
    debugger:    boolean;
    scheduler:   boolean;
    sso:         boolean;
    apiAccess:   boolean;
    whiteLabel:  boolean;
    auditDays:   number;       // -1 = unlimited
    maxProjects: number;       // -1 = unlimited
  };
  // P4-01: Vendor-signed per-feature overrides — applied on top of tier defaults.
  // Enables granting or revoking individual features independent of tier.
  // Only respected in RSA-signed .lic files — HMAC keys cannot carry overrides.
  featureOverrides?: Partial<Record<FeatureKey, boolean>>;
  // P3-08: Enterprise white-label config (optional — Enterprise .lic only)
  whiteLabelConfig?: {
    appName:      string;
    logoUrl?:     string;
    primaryColor?: string;   // CSS hex e.g. "#3b82f6"
  };
}

// ── Jira Defect Filing ───────────────────────────────────────────────

export interface JiraConfig {
  projectKey: string;
  issueType: string;
  defaultPriority: string;
  parentLinkFieldId: string;
  referSSFieldId: string;        // captured for future use; v1 uses /attachments endpoint
  closeTransitionName: string;
  maxAttachmentMB: number;
  baseUrl?: string;              // overrides .env JIRA_BASE_URL when set
  email?: string;                // overrides .env JIRA_EMAIL when set
  apiTokenEnc?: string;          // AES-GCM encrypted token (overrides .env JIRA_API_TOKEN)
  updatedAt: string;
  updatedBy: string;
}

export type DefectAttachmentStatus = 'ok' | 'failed' | 'skipped';

export interface DefectRecord {
  defectKey: string;
  jiraId: string;
  testId: string;
  testName: string;
  suiteId: string;
  suiteName: string;
  environmentId: string;
  environmentName: string;
  projectId: string;
  parentStoryKey: string;
  status: 'open' | 'closed';
  createdAt: string;
  createdBy: string;
  filedFromRunId: string;
  closedAt?: string;
  closedByRunId?: string;
  jiraUrl: string;
  attachments: {
    screenshot?: DefectAttachmentStatus;
    video?: DefectAttachmentStatus;
    trace?: DefectAttachmentStatus;
  };
  comments: Array<{ runId: string; addedAt: string; addedBy: string }>;
}

export interface DefectsRegistry {
  _schemaVersion: 1;
  defects: DefectRecord[];
}

export type DismissCategory =
  | 'script-issue'
  | 'locator-issue'
  | 'flaky'
  | 'data-issue'
  | 'env-issue';

export interface DismissEntry {
  timestamp: string;
  runId: string;
  testId: string;
  testName: string;
  suiteId: string;
  category: DismissCategory;
  dismissedBy: string;
  errorMessage: string;
}

// ── NL Keyword Suggestion ─────────────────────────────────────────────────────

export interface ConfidenceBreakdown {
  verb:    number;   // 0–1
  locator: number;   // 0–1
  value:   number;   // 0–1
}

export interface SuggestedStep {
  keyword:             string | null;
  locatorName:         string | null;
  value:               string | null;
  confidence:          number;
  confidenceBreakdown: ConfidenceBreakdown;
  matched:             boolean;
  source:              'rule' | 'ai';
  originalSentence:    string;
}

export interface NlSuggestResponse {
  version: 'v1';
  steps:   SuggestedStep[];
  meta: {
    provider?:   string;
    durationMs:  number;
    cached:      boolean;
    aiTimedOut?: boolean;
  };
}

export interface NlConfig {
  enabled:             boolean;
  provider:            string;   // NlProviderType from nlProvider.ts
  model:               string;
  baseUrl:             string;
  apiKeyEncrypted:     string;   // AES-GCM via encryptToken() in server.ts
  confidenceThreshold: number;   // default 0.5
  timeoutMs:           number;   // default 3000
}

export interface NlAliasMap {
  [locatorName: string]: string[];   // up to 10 aliases per locator
}

// ── API Testing Module ─────────────────────────────────────────────────────────

export interface ApiVariable {
  key: string;
  value: string;
  sensitive?: boolean;
}

export interface ApiDynamicValue {
  type: 'uuid' | 'timestamp' | 'env' | 'random_int' | 'random_string' | 'faker_name' | 'faker_email' | 'faker_uuid';
  format?: string;
}

export interface ApiAuthConfig {
  type: 'none' | 'bearer' | 'apiKey' | 'basic' | 'oauth2CC';
  bearer?: { token: string };
  apiKey?: { header: string; value: string };
  basic?: { username: string; password: string };
  oauth2CC?: { tokenUrl: string; clientId: string; clientSecret: string; scope?: string };
}

export interface ApiEnvironment {
  id: string;
  projectId?: string;
  name: string;
  baseUrl: string;
  variables: ApiVariable[];
  authConfig?: ApiAuthConfig;
}

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
  bodyType?: 'json' | 'form' | 'raw' | 'none';
  openapiSpecId?: string;
}

export interface ApiAssertion {
  field: string;
  operator: 'eq' | 'neq' | 'equals' | 'notEquals' | 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual' | 'exists' | 'notExists' | 'matches' | 'isEmpty' | 'isType' | 'jsonSchemaValid';
  expected?: unknown;
  weight?: number;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'soft';
  message?: string;
}

export interface ApiVariableExtraction {
  name: string;
  source: 'responseBody' | 'responseHeader' | 'statusCode';
  path: string;
  scope: 'step' | 'collection' | 'global';
}

export interface ApiStepExecution {
  retryPolicy?: { maxRetries: number; delayMs: number; retryOn?: number[] };
  idempotent?: boolean;
  timeoutMs?: number;
  preScript?: string;
  postScript?: string;
  variableWritePolicy?: 'merge' | 'replace';
  onFailure?: 'stop' | 'continue' | 'skipDependents';
  teardown?: boolean;
  logLevel?: 'minimal' | 'standard' | 'verbose';
  delayAfterMs?: number;
  condition?: string;
}

export interface ApiTestStep {
  id: string;
  name: string;
  request: ApiRequest;
  assertions: ApiAssertion[];
  extractVariables: ApiVariableExtraction[];
  execution: ApiStepExecution;
  dependsOn: string[];
  group?: string;
  order?: number;
  captureBaseline?: boolean;
  baselineRunId?: string;
}

export interface ApiCollection {
  id: string;
  projectId?: string;
  name: string;
  environmentId: string;
  steps: ApiTestStep[];
  variables: ApiVariable[];
  onFailure: 'stop' | 'continue' | 'skipDependents';
  executionMode: 'sequential' | 'parallel' | 'dag';
  maxConcurrency?: number;
  logLevel?: 'minimal' | 'standard' | 'verbose';
  rateLimit?: { requestsPerSecond: number };
  tags?: string[];
  autoFileDefects?: boolean;
}

export interface ApiAssertionResult {
  assertionIndex: number;
  field: string;
  operator: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
  message?: string;
  confidenceScore?: number;
}

export interface JsonDiff {
  path: string;
  expected: unknown;
  actual: unknown;
}

export interface BaselineDiff {
  statusChanged: boolean;
  headersAdded: string[];
  headersRemoved: string[];
  bodyDiff: JsonDiff[];
}

export interface ApiResponseSnapshot {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  baselineDiff?: BaselineDiff;
  bodyTruncated: boolean;
  durationMs: number;
  har?: unknown;
}

export interface ApiStepResult {
  stepId: string;
  stepName: string;
  status: 'passed' | 'failed' | 'skipped' | 'error' | 'degraded';
  request: ApiRequest;
  response?: ApiResponseSnapshot;
  assertionResults: ApiAssertionResult[];
  extractedVariables: Record<string, string>;
  durationMs: number;
  contractViolations?: string[];
  error?: string;
  healingProposal?: string;
  isTeardown?: boolean;
}

export interface ApiCollectionRunResult {
  id: string;
  collectionId: string;
  projectId?: string;
  startedAt: string;
  completedAt: string;
  status: 'passed' | 'failed' | 'error' | 'running';
  stepResults: ApiStepResult[];
  variableContext: Record<string, string>;
}

// Phase D Step 7 — per-node execution data merged into graph for run overlay
export interface RunGraphNodeResult {
  stepId: string;
  stepName: string;
  status: 'passed' | 'failed' | 'error' | 'skipped' | 'degraded' | 'running' | 'queued' | 'retrying' | 'timed_out' | 'pending';
  durationMs: number | null;
  retryCount: number;
  retryHistory: Array<{
    attempt: number;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    httpStatus?: number;
    error?: string;
    resultStatus: string;
    retriedAfter: boolean;
  }>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  contractViolations?: string[];
  assertionFailures?: string[];
  isTeardown?: boolean;
}

export interface RunGraphProjection {
  runId: string;
  collectionId: string;
  runStatus: 'passed' | 'failed' | 'error' | 'running';
  startedAt: string;
  completedAt: string;
  graph: import('../workflow-graph/contracts/graph.contracts').GraphProjection;
  nodeResults: Record<string, RunGraphNodeResult>;
}
