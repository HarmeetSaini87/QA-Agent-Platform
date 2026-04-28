import type { ADFNode } from './adfBuilder';

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface CreateIssuePayload {
  projectKey: string;
  issueType: string;
  summary: string;
  descriptionADF: ADFNode;
  priority: string;
  parentStoryKey?: string;
}

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type?: string };
}

// ── Error classes ──
export class JiraError extends Error {
  constructor(public code: string, message: string, public httpStatus?: number, public details?: unknown) {
    super(message);
    this.name = 'JiraError';
  }
}
export class JiraAuthError       extends JiraError { constructor(d?: unknown) { super('JIRA_AUTH_FAILED',     'Jira authentication failed',      401, d); } }
export class JiraValidationError extends JiraError { constructor(d?: unknown) { super('JIRA_VALIDATION_ERROR','Jira rejected the request',       400, d); } }
export class JiraNotFoundError   extends JiraError { constructor(d?: unknown) { super('JIRA_NOT_FOUND',       'Jira resource not found',         404, d); } }
export class JiraServerError     extends JiraError { constructor(s: number, d?: unknown) { super('JIRA_SERVER_ERROR', `Jira server error (${s})`, s, d); } }
export class JiraNetworkError    extends JiraError { constructor(m: string)   { super('JIRA_UNREACHABLE',     `Jira unreachable: ${m}`,          undefined); } }

function authHeader(c: JiraCredentials): string {
  return 'Basic ' + Buffer.from(`${c.email}:${c.apiToken}`).toString('base64');
}

async function readJson(r: Response): Promise<unknown> {
  const t = await r.text();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return t; }
}

function mapError(status: number, body: unknown): JiraError {
  if (status === 401 || status === 403) return new JiraAuthError(body);
  if (status === 404) return new JiraNotFoundError(body);
  if (status >= 400 && status < 500) return new JiraValidationError(body);
  return new JiraServerError(status, body);
}

export class JiraClient {
  constructor(private creds: JiraCredentials) {}

  private url(p: string): string { return this.creds.baseUrl.replace(/\/$/, '') + p; }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: authHeader(this.creds), Accept: 'application/json', ...extra };
  }

  private async req(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: this.headers({ 'Content-Type': 'application/json', ...extraHeaders }),
        body: body == null ? undefined : JSON.stringify(body),
      });
    } catch (e: any) {
      throw new JiraNetworkError(e?.message || String(e));
    }
    if (res.status >= 200 && res.status < 300) return readJson(res);
    throw mapError(res.status, await readJson(res));
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const me: any = await this.req('GET', '/rest/api/3/myself');
      return { ok: true, user: me?.emailAddress || me?.accountId };
    } catch (e: any) {
      return { ok: false, error: e?.httpStatus ? `${e.httpStatus} ${e.code}` : e?.message };
    }
  }

  async discoverFields(): Promise<JiraField[]> {
    const arr = (await this.req('GET', '/rest/api/3/field')) as any[];
    return arr.map(f => ({ id: f.id, name: f.name, custom: !!f.custom, schema: f.schema }));
  }

  async createIssue(p: CreateIssuePayload): Promise<{ key: string; id: string; self: string }> {
    const fields: Record<string, unknown> = {
      project: { key: p.projectKey },
      issuetype: { name: p.issueType },
      summary: p.summary,
      description: p.descriptionADF,
      priority: { name: p.priority },
    };
    if (p.parentStoryKey) {
      fields.parent = { key: p.parentStoryKey };
    }
    const out = (await this.req('POST', '/rest/api/3/issue', { fields })) as any;
    return { key: out.key, id: out.id, self: out.self };
  }

  async getIssue(key: string): Promise<unknown> {
    return this.req('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`);
  }

  async searchOpenDefectByTestId(testId: string, suiteId: string, projectKey: string): Promise<string | null> {
    // suiteId reserved for future scoping; v1 keys on testId since it's globally unique
    const jql = `project = ${projectKey} AND statusCategory != Done AND text ~ "${testId}"`;
    const out = (await this.req('POST', '/rest/api/3/search', {
      jql, fields: ['summary'], maxResults: 1,
    })) as any;
    return out?.issues?.[0]?.key || null;
  }

  async addAttachment(key: string, file: { name: string; buffer: Buffer; mime: string }): Promise<{ id: string }> {
    const form = new FormData();
    const blob = new Blob([file.buffer], { type: file.mime });
    form.append('file', blob, file.name);
    let res: Response;
    try {
      res = await fetch(this.url(`/rest/api/3/issue/${encodeURIComponent(key)}/attachments`), {
        method: 'POST',
        headers: { Authorization: authHeader(this.creds), 'X-Atlassian-Token': 'no-check' },
        body: form,
      });
    } catch (e: any) { throw new JiraNetworkError(e?.message || String(e)); }
    if (res.status < 200 || res.status >= 300) {
      throw mapError(res.status, await readJson(res));
    }
    const arr = (await readJson(res)) as any[];
    return { id: arr?.[0]?.id || '' };
  }

  async addComment(key: string, body: ADFNode): Promise<{ id: string }> {
    const out = (await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body })) as any;
    return { id: out?.id || '' };
  }

  async transitionIssue(key: string, transitionName: string): Promise<void> {
    const list = (await this.req('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`)) as any;
    const t = (list.transitions || []).find((x: any) => x.name === transitionName);
    if (!t) throw new JiraError('JIRA_TRANSITION_NOT_FOUND', `transition "${transitionName}" not found`, 400);
    await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: t.id } });
  }
}
