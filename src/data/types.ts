/**
 * types.ts — shared data model types
 */

export type Role = 'admin' | 'tester' | 'viewer';

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
  // Legacy — kept for backward compat with old data; ignored by new UI
  appUrl?:      string;
  credentials?: ProjectCredential[];
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
  status:          'auto-applied' | 'pending-review' | 'approved' | 'rejected';
  reviewedBy?:     string;
  reviewedAt?:     string;
  screenshotPath?: string;
}

export interface Locator {
  id:             string;
  name:           string;           // human-readable alias e.g. "Login Button"
  selector:       string;           // actual CSS/XPath/id
  selectorType:   'css' | 'xpath' | 'id' | 'name' | 'text' | 'testid' | 'role' | 'label' | 'placeholder';
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
}

export interface TestScript {
  id:          string;
  projectId:   string;
  tcId:        string;          // auto-generated e.g. "MED-01"
  component:   string;          // categorization e.g. "Login", "Billing"
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

// ── Common Data ───────────────────────────────────────────────────────────────

export interface CommonData {
  id:          string;
  projectId:   string;
  dataName:    string;   // unique per project+environment
  value:       string;   // stored as enc:<base64> when sensitive=true
  environment: string;   // e.g. "QA", "UAT", "DEV", "PROD"
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
