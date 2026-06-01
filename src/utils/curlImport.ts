import { v4 as uuidv4 } from 'uuid';
import type { ApiTestStep, ApiRequest, ApiAuthConfig } from '../data/types';

function stripContinuations(cmd: string): string {
  return cmd.replace(/\\\s*\n\s*/g, ' ').trim();
}

function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    while (i < cmd.length && /\s/.test(cmd[i])) i++;
    if (i >= cmd.length) break;

    if (cmd[i] === '"') {
      let t = '';
      i++; // skip opening quote
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) { i++; t += cmd[i]; }
        else t += cmd[i];
        i++;
      }
      i++; // skip closing quote
      tokens.push(t);
    } else if (cmd[i] === "'") {
      let t = '';
      i++;
      while (i < cmd.length && cmd[i] !== "'") { t += cmd[i]; i++; }
      i++;
      tokens.push(t);
    } else {
      let t = '';
      while (i < cmd.length && !/\s/.test(cmd[i])) { t += cmd[i]; i++; }
      tokens.push(t);
    }
  }
  return tokens;
}

export function importFromCurl(curlCommand: string, environmentId: string): ApiTestStep {
  const normalized = stripContinuations(curlCommand);
  const tokens = tokenize(normalized);

  // Skip the 'curl' token
  let idx = 0;
  if (tokens[idx]?.toLowerCase() === 'curl') idx++;

  let method: string | undefined;
  let url: string | undefined;
  const headers: Record<string, string> = {};
  let body: unknown;
  let bodyType: ApiRequest['bodyType'] = 'none';
  let basicAuth: { username: string; password: string } | undefined;
  let insecure = false;

  while (idx < tokens.length) {
    const tok = tokens[idx];

    if (tok === '-X' || tok === '--request') {
      method = tokens[++idx];
    } else if (tok === '-H' || tok === '--header') {
      const header = tokens[++idx];
      const colon = header.indexOf(':');
      if (colon > 0) {
        const k = header.slice(0, colon).trim();
        const v = header.slice(colon + 1).trim();
        headers[k] = v;
      }
    } else if (tok === '-d' || tok === '--data' || tok === '--data-raw') {
      body = tokens[++idx];
      bodyType = 'raw';
    } else if (tok === '--data-urlencode') {
      const pair = tokens[++idx];
      if (typeof body !== 'object' || body === null) body = {};
      const eq = pair.indexOf('=');
      if (eq > 0) (body as Record<string, string>)[pair.slice(0, eq)] = pair.slice(eq + 1);
      bodyType = 'form';
    } else if (tok === '--json') {
      body = tokens[++idx];
      headers['Content-Type'] = 'application/json';
      bodyType = 'json';
    } else if (tok === '-u' || tok === '--user') {
      const creds = tokens[++idx];
      const colon = creds.indexOf(':');
      basicAuth = colon > 0
        ? { username: creds.slice(0, colon), password: creds.slice(colon + 1) }
        : { username: creds, password: '' };
    } else if (tok === '-b' || tok === '--cookie') {
      headers['Cookie'] = tokens[++idx];
    } else if (tok === '-k' || tok === '--insecure') {
      insecure = true;
    } else if (!tok.startsWith('-') && !url) {
      url = tok;
    }
    idx++;
  }

  if (!url) throw new Error('No URL found in cURL command');

  // Detect bodyType from Content-Type if not already set
  if (bodyType === 'raw' && headers['Content-Type']?.includes('application/json')) {
    bodyType = 'json';
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* keep as string */ }
    }
  } else if (bodyType === 'raw' && headers['Content-Type']?.includes('application/x-www-form-urlencoded')) {
    bodyType = 'form';
  }

  if (!method) method = body !== undefined ? 'POST' : 'GET';

  const request: ApiRequest = {
    method: method.toUpperCase() as ApiRequest['method'],
    url,
    headers: Object.keys(headers).length ? headers : undefined,
    body,
    bodyType,
  };

  const authConfig: ApiAuthConfig | undefined = basicAuth
    ? { type: 'basic', basic: basicAuth }
    : undefined;

  const stepName = `${method.toUpperCase()} ${url}${insecure ? ' [insecure]' : ''}`;

  return {
    id: uuidv4(),
    name: stepName,
    request,
    assertions: [],
    extractVariables: [],
    execution: authConfig ? { onFailure: 'continue' } : {},
    dependsOn: [],
  };
}
