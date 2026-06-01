import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraClient, JiraAuthError, JiraValidationError, JiraNotFoundError } from '../jiraClient';

const creds = { baseUrl: 'https://example.atlassian.net', email: 'u@x.com', apiToken: 'tok' };

describe('JiraClient', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('builds Basic auth header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ emailAddress: 'u@x.com' }), { status: 200 })
    );
    const client = new JiraClient(creds);
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(res.user).toBe('u@x.com');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic ' + Buffer.from('u@x.com:tok').toString('base64'));
  });

  it('returns ok=false on testConnection 401', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const client = new JiraClient(creds);
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
  });

  it('createIssue returns key/id on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: '10001', key: 'BSM-42', self: 'url' }), { status: 201 })
    );
    const client = new JiraClient(creds);
    const out = await client.createIssue({
      projectKey: 'BSM', issueType: 'Defect', summary: 'X',
      descriptionADF: { type: 'doc', version: 1, content: [] },
      priority: 'Medium', parentStoryKey: 'BSM-1',
    });
    expect(out.key).toBe('BSM-42');
    expect(out.id).toBe('10001');
  });

  it('createIssue maps 401 to JiraAuthError', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new JiraClient(creds);
    await expect(client.createIssue({
      projectKey: 'BSM', issueType: 'Defect', summary: 'X',
      descriptionADF: { type: 'doc', version: 1 }, priority: 'Medium',
    })).rejects.toBeInstanceOf(JiraAuthError);
  });

  it('createIssue maps 400 to JiraValidationError with details', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ errors: { summary: 'required' } }), { status: 400 }
    ));
    const client = new JiraClient(creds);
    try {
      await client.createIssue({
        projectKey: 'BSM', issueType: 'Defect', summary: '',
        descriptionADF: { type: 'doc', version: 1 }, priority: 'Medium',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(JiraValidationError);
      expect((e as JiraValidationError).details).toEqual({ errors: { summary: 'required' } });
    }
  });

  it('searchOpenDefectByTestId returns first matching key or null', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ issues: [{ key: 'BSM-9' }] }), { status: 200 }
    ));
    const client = new JiraClient(creds);
    const k = await client.searchOpenDefectByTestId('TID_a', 's1', 'BSM');
    expect(k).toBe('BSM-9');
  });

  it('searchOpenDefectByTestId returns null when no match', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ issues: [] }), { status: 200 }
    ));
    const client = new JiraClient(creds);
    expect(await client.searchOpenDefectByTestId('TID_x', 's', 'BSM')).toBeNull();
  });

  it('addAttachment posts multipart with X-Atlassian-Token header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ id: '999' }]), { status: 200 })
    );
    const client = new JiraClient(creds);
    const res = await client.addAttachment('BSM-1',
      { name: 's.png', buffer: Buffer.from('x'), mime: 'image/png' });
    expect(res.id).toBe('999');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Atlassian-Token']).toBe('no-check');
  });

  it('transitionIssue resolves transition name to id then posts', async () => {
    const spy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ transitions: [{ id: '31', name: 'Closed' }] }), { status: 200 }
      ))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new JiraClient(creds);
    await client.transitionIssue('BSM-1', 'Closed');
    expect(spy.mock.calls).toHaveLength(2);
    const body = JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string);
    expect(body.transition.id).toBe('31');
  });

  it('transitionIssue throws when name not found', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ transitions: [{ id: '11', name: 'In Progress' }] }), { status: 200 }
    ));
    const client = new JiraClient(creds);
    await expect(client.transitionIssue('BSM-1', 'Closed')).rejects.toThrow(/transition.*not found/i);
  });
});
