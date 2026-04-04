/**
 * jira.client.ts
 * Jira Cloud REST API v3 client.
 *
 * Responsibilities:
 *  1. Fetch a story by ID or URL — summary, description, AC, attachments
 *  2. Download all attachments to a local temp folder
 *  3. Return a ParsedJiraStory for downstream parsing (P5)
 */

import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../framework/config';
import { logger } from '../utils/logger';
import { adfToText, extractACFromDescription } from './adf-to-text';
import {
  JiraIssue,
  JiraFieldMeta,
  JiraAttachment,
  ParsedJiraStory,
  AdfDocument,
} from '../types/jira.types';

// ── Constants ─────────────────────────────────────────────────────────────────

// Common custom field names for Acceptance Criteria across Jira configurations
const AC_FIELD_NAMES = [
  'acceptance criteria',
  'acceptancecriteria',
  'acceptance_criteria',
  'ac',
  'definition of done',
  'dod',
];

// Fields to request from Jira (requesting specific fields is faster than *)
const REQUESTED_FIELDS = [
  'summary',
  'description',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'labels',
  'attachment',
  'comment',
].join(',');

// ── Jira client class ─────────────────────────────────────────────────────────

export class JiraClient {
  private http: AxiosInstance;
  private fieldMap: Map<string, string> | null = null;  // fieldId → fieldName

  constructor() {
    if (!config.jira.isConfigured) {
      throw new Error(
        'Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in your .env file.'
      );
    }

    const token = Buffer.from(
      `${config.jira.email}:${config.jira.apiToken}`
    ).toString('base64');

    this.http = axios.create({
      baseURL: `${config.jira.baseUrl}/rest/api/3`,
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Log non-sensitive request info
    this.http.interceptors.request.use(req => {
      logger.debug(`Jira API → ${req.method?.toUpperCase()} ${req.url}`);
      return req;
    });
  }

  // ── Public: fetch story ───────────────────────────────────────────────────

  /**
   * Fetch a Jira story by ID or full URL.
   * Downloads all attachments to the requirements/downloads/<storyId>/ folder.
   * Returns a normalised ParsedJiraStory.
   *
   * @param storyIdOrUrl  e.g. "PROJ-123" or "https://pnmx.atlassian.net/browse/PROJ-123"
   */
  async fetchStory(storyIdOrUrl: string): Promise<ParsedJiraStory> {
    const storyId = this.extractStoryId(storyIdOrUrl);
    logger.info(`Fetching Jira story: ${storyId}`);

    // 1. Fetch field metadata (once per session) to identify AC field
    const fieldMap = await this.getFieldMap();

    // 2. Fetch the issue with all fields
    const issue = await this.fetchIssue(storyId, fieldMap);

    // 3. Convert description ADF → plain text
    const rawDescription = adfToText(issue.fields.description as AdfDocument | null);

    // 4. Find acceptance criteria
    const { description, acceptanceCriteria } = await this.extractAcceptanceCriteria(
      issue,
      rawDescription,
      fieldMap
    );

    // 5. Download attachments
    const attachmentPaths = await this.downloadAttachments(
      storyId,
      issue.fields.attachment
    );

    const parsed: ParsedJiraStory = {
      storyId,
      summary: issue.fields.summary,
      description,
      acceptanceCriteria,
      priority: issue.fields.priority?.name ?? 'Medium',
      status: issue.fields.status.name,
      labels: issue.fields.labels ?? [],
      attachments: issue.fields.attachment,
      attachmentPaths,
    };

    logger.info(`Story fetched: "${parsed.summary}"`);
    logger.info(`  Description  : ${description.length} chars`);
    logger.info(`  AC           : ${acceptanceCriteria.length} chars`);
    logger.info(`  Attachments  : ${attachmentPaths.length} files downloaded`);

    return parsed;
  }

  // ── Public: story → RequirementDoc ───────────────────────────────────────

  /**
   * Converts a ParsedJiraStory to a RequirementDoc for the planWriter.
   * The attachmentTexts are populated by the file parser in P5.
   */
  storyToRequirementDoc(story: ParsedJiraStory) {
    return {
      source: 'jira' as const,
      sourceRef: story.storyId,
      summary: story.summary,
      description: story.description,
      acceptanceCriteria: story.acceptanceCriteria,
      attachmentTexts: [],         // Populated after P5 file parsing
      _attachmentPaths: story.attachmentPaths,  // For P5 to process
    };
  }

  // ── Private: API calls ────────────────────────────────────────────────────

  private async fetchIssue(storyId: string, fieldMap: Map<string, string>): Promise<JiraIssue> {
    // Build field list: standard fields + all known AC custom fields
    const acFieldIds = this.findAcFieldIds(fieldMap);
    const fields = `${REQUESTED_FIELDS}${acFieldIds.length ? ',' + acFieldIds.join(',') : ''}`;

    try {
      const response = await this.http.get<JiraIssue>(`/issue/${storyId}`, {
        params: { fields },
      });
      return response.data;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 404) {
          throw new Error(`Story "${storyId}" not found. Check the story ID and your Jira permissions.`);
        }
        if (err.response?.status === 401) {
          throw new Error('Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN in .env');
        }
        throw new Error(`Jira API error ${err.response?.status}: ${JSON.stringify(err.response?.data)}`);
      }
      throw err;
    }
  }

  private async getFieldMap(): Promise<Map<string, string>> {
    if (this.fieldMap) return this.fieldMap;

    try {
      const response = await this.http.get<JiraFieldMeta[]>('/field');
      const map = new Map<string, string>();
      for (const f of response.data) {
        map.set(f.id, f.name.toLowerCase());
      }
      this.fieldMap = map;
      logger.debug(`Loaded ${map.size} Jira field definitions`);
      return map;
    } catch {
      logger.warn('Could not fetch Jira field metadata — AC custom field detection disabled');
      return new Map();
    }
  }

  private findAcFieldIds(fieldMap: Map<string, string>): string[] {
    const ids: string[] = [];
    for (const [id, name] of fieldMap.entries()) {
      if (AC_FIELD_NAMES.some(acName => name.includes(acName))) {
        ids.push(id);
        logger.debug(`Found AC field: ${id} = "${name}"`);
      }
    }
    return ids;
  }

  private async extractAcceptanceCriteria(
    issue: JiraIssue,
    rawDescription: string,
    fieldMap: Map<string, string>
  ): Promise<{ description: string; acceptanceCriteria: string }> {

    // Strategy 1: Look for a dedicated AC custom field
    for (const [fieldId, fieldName] of fieldMap.entries()) {
      if (AC_FIELD_NAMES.some(ac => fieldName.includes(ac))) {
        const fieldValue = issue.fields[fieldId];
        if (fieldValue) {
          const acText = typeof fieldValue === 'string'
            ? fieldValue
            : adfToText(fieldValue as AdfDocument);
          if (acText.trim()) {
            logger.debug(`AC found in field "${fieldName}" (${fieldId})`);
            return { description: rawDescription, acceptanceCriteria: acText };
          }
        }
      }
    }

    // Strategy 2: Extract AC section from description text
    const extracted = extractACFromDescription(rawDescription);
    if (extracted.acceptanceCriteria) {
      logger.debug('AC extracted from description text');
      return extracted;
    }

    // Strategy 3: No AC found — return description as-is with empty AC
    logger.warn('No Acceptance Criteria found. Check if story has an AC field or AC section in description.');
    return { description: rawDescription, acceptanceCriteria: '' };
  }

  // ── Private: attachments ──────────────────────────────────────────────────

  private async downloadAttachments(
    storyId: string,
    attachments: JiraAttachment[]
  ): Promise<string[]> {
    if (!attachments || attachments.length === 0) {
      logger.info('No attachments on this story');
      return [];
    }

    const downloadDir = path.resolve(config.paths.requirements, 'downloads', storyId);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const paths: string[] = [];

    for (const attachment of attachments) {
      const filePath = path.join(downloadDir, attachment.filename);

      // Skip if already downloaded
      if (fs.existsSync(filePath)) {
        logger.debug(`Attachment already downloaded: ${attachment.filename}`);
        paths.push(filePath);
        continue;
      }

      try {
        logger.info(`Downloading: ${attachment.filename} (${this.formatBytes(attachment.size)})`);

        const response = await this.http.get(attachment.content, {
          responseType: 'arraybuffer',
          // Override baseURL — attachment.content is an absolute URL
          baseURL: undefined,
        });

        fs.writeFileSync(filePath, Buffer.from(response.data));
        paths.push(filePath);
        logger.info(`  ✔ Saved: ${filePath}`);
      } catch (err) {
        logger.warn(`  ✘ Failed to download "${attachment.filename}": ${(err as Error).message}`);
      }
    }

    return paths;
  }

  // ── Private: utilities ────────────────────────────────────────────────────

  private extractStoryId(input: string): string {
    // Handle full Jira URLs: https://pnmx.atlassian.net/browse/PROJ-123
    const urlMatch = input.match(/\/browse\/([A-Z]+-\d+)/i);
    if (urlMatch) return urlMatch[1].toUpperCase();

    // Handle plain story IDs: PROJ-123
    const idMatch = input.match(/^[A-Z]+-\d+$/i);
    if (idMatch) return input.toUpperCase();

    throw new Error(
      `Invalid Jira story reference: "${input}". ` +
      'Expected a story ID like "PROJ-123" or a full Jira URL.'
    );
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

let _client: JiraClient | null = null;

export function getJiraClient(): JiraClient {
  if (!_client) _client = new JiraClient();
  return _client;
}
