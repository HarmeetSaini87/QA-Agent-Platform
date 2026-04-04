// ─────────────────────────────────────────────────────────────────────────────
// Jira Cloud REST API v3 — response types
// ─────────────────────────────────────────────────────────────────────────────

// ── Atlassian Document Format (ADF) ──────────────────────────────────────────
// Jira stores rich text fields as ADF JSON. We convert these to plain text.

export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface AdfDocument {
  version: number;
  type: 'doc';
  content: AdfNode[];
}

// ── Attachment ────────────────────────────────────────────────────────────────

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string;       // Download URL
  created: string;
  author: { displayName: string; emailAddress: string };
}

// ── Issue fields ──────────────────────────────────────────────────────────────

export interface JiraIssueFields {
  summary: string;
  description: AdfDocument | null;
  status: { name: string };
  priority: { name: string } | null;
  issuetype: { name: string };
  assignee: { displayName: string; emailAddress: string } | null;
  labels: string[];
  attachment: JiraAttachment[];
  // Custom fields — acceptance criteria field name varies per Jira config
  // We scan all fields at runtime — these are the most common
  [key: string]: unknown;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

// ── Field metadata ────────────────────────────────────────────────────────────

export interface JiraFieldMeta {
  id: string;
  name: string;
  schema: { type: string };
}

// ── Parsed story — normalised output from the Jira client ────────────────────

export interface ParsedJiraStory {
  storyId: string;           // e.g. PROJ-123
  summary: string;
  description: string;       // Plain text converted from ADF
  acceptanceCriteria: string; // Plain text — from dedicated AC field or extracted from description
  priority: string;
  status: string;
  labels: string[];
  attachments: JiraAttachment[];
  attachmentPaths: string[];  // Local file paths after download
}
