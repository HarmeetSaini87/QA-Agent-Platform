/**
 * types.ts — shared data model types
 */

export type Role = 'admin' | 'tester';

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

export interface Locator {
  id:          string;
  name:        string;           // human-readable alias e.g. "Login Button"
  selector:    string;           // actual CSS/XPath/id
  selectorType: 'css' | 'xpath' | 'id' | 'name' | 'text' | 'testid' | 'role' | 'label' | 'placeholder';
  pageModule:  string;           // e.g. "Mediation Config - Gateway Type"
  projectId:   string | null;    // scoped to project or global
  description: string;
  draft?:      boolean;          // true = recorder-created, not yet saved to a script
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
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
  order:    number;
  keyword:  string;
  detail:   string;
  selector: string | null;
  value:    string | null;
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
  storeScope?:   'session';      // session = current script only (global added later)
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

// ── Test Suite ────────────────────────────────────────────────────────────────

export interface TestSuite {
  id:            string;
  projectId:     string;
  name:          string;
  description:   string;
  scriptIds:     string[];       // ordered list of TestScript IDs
  environmentId: string | null;  // selected environment for execution
  retries:       0 | 1 | 2;     // Playwright --retries flag (0 = disabled)
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

export interface AppSettings {
  sessionTimeoutMinutes: number;
  allowRegistration:     boolean;
  appName:               string;
  maxFailedLogins:       number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sessionTimeoutMinutes: 60,
  allowRegistration:     false,
  appName:               'QA Agent Platform',
  maxFailedLogins:       5,
};
