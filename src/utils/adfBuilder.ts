// Atlassian Document Format builders. Pure functions.
// Spec: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/

export interface ADFNode {
  type: string;
  version?: number;
  attrs?: Record<string, unknown>;
  content?: ADFNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

function text(t: string): ADFNode {
  return { type: 'text', text: t };
}

function paragraph(...children: ADFNode[]): ADFNode {
  return { type: 'paragraph', content: children };
}

function paragraphText(s: string): ADFNode {
  return paragraph(text(s));
}

function heading(level: number, t: string): ADFNode {
  return { type: 'heading', attrs: { level }, content: [text(t)] };
}

function codeBlock(t: string): ADFNode {
  return { type: 'codeBlock', attrs: { language: 'text' }, content: [text(t)] };
}

function orderedList(items: string[]): ADFNode {
  return {
    type: 'orderedList',
    content: items.map(i => ({
      type: 'listItem',
      content: [paragraphText(i)],
    })),
  };
}

function emptyParagraph(): ADFNode {
  return { type: 'paragraph' };
}

export interface DescriptionInput {
  testName: string;
  testId: string;
  suiteName: string;
  projectName: string;
  runTimestamp: string;
  runId: string;
  envName: string;
  envUrl: string;
  browser: string;
  os: string;
  steps: string[];
  errorMessage: string;
  errorDetailFirst5: string;
}

export function buildDefectDescription(input: DescriptionInput): ADFNode {
  const content: ADFNode[] = [];

  content.push(heading(3, 'Description'));
  content.push(paragraphText(
    `Test "${input.testName}" failed in suite "${input.suiteName}" ` +
    `(project "${input.projectName}") on ${input.runTimestamp}.`
  ));
  content.push(paragraphText(`Run ID: ${input.runId}`));
  // OLD: content.push(paragraphText(`testId: ${input.testId}`)); — removed from visible body; dedup uses JQL only

  content.push(heading(3, 'Precondition'));
  content.push(paragraphText(`Environment: ${input.envName} — ${input.envUrl}`));
  content.push(paragraphText(`Browser: ${input.browser}`));
  content.push(paragraphText(`OS: ${input.os}`));

  content.push(heading(3, 'Steps'));
  if (input.steps.length) {
    content.push(orderedList(input.steps));
  } else {
    content.push(paragraphText('(no step details captured)'));
  }

  content.push(heading(3, 'Actual Result'));
  content.push(paragraphText(input.errorMessage || 'Test failed'));
  if (input.errorDetailFirst5) {
    const codeBlockContent = `${input.errorMessage || 'Test failed'}\n${input.errorDetailFirst5}`;
    content.push(codeBlock(codeBlockContent));
  }

  content.push(heading(3, 'Expected Result'));
  // Parse "Expected: ..." line from errorDetail if present (e.g. toHaveURL / toHaveText assertions)
  const expectedMatch = (input.errorDetailFirst5 || input.errorMessage || '').match(/Expected:\s*"?([^\n"]+)"?/);
  if (expectedMatch) {
    content.push(paragraphText(expectedMatch[1].trim()));
  } else {
    content.push(emptyParagraph());
  }

  return { type: 'doc', version: 1, content };
}

export function buildAutoCloseCommentADF(runId: string, timestamp: string): ADFNode {
  return {
    type: 'doc',
    version: 1,
    content: [paragraphText(
      `Auto-closed by TestForge — test passed on run ${runId} at ${timestamp}. ` +
      `Please verify the fix is genuine.`
    )],
  };
}

export interface FailureCommentInput {
  runId: string;
  timestamp: string;
  errorMessage: string;
  errorDetailFirst5: string;
}

export function buildFailureCommentADF(input: FailureCommentInput): ADFNode {
  const content: ADFNode[] = [];
  content.push(paragraphText(
    `Test failed again on run ${input.runId} at ${input.timestamp}.`
  ));
  content.push(paragraphText(`Error: ${input.errorMessage || 'Test failed'}`));
  if (input.errorDetailFirst5) content.push(codeBlock(input.errorDetailFirst5));
  return { type: 'doc', version: 1, content };
}

import type { ApiStepResult, ApiCollection, ApiEnvironment } from '../data/types';
import type { ApiDefectPayload } from '../api-defects/contracts/api-defect.contracts';

export function buildApiDefectAdf(
  step: ApiStepResult,
  collection: ApiCollection,
  environment: ApiEnvironment
): ADFNode {
  const failedAssertions = step.assertionResults.filter(a => !a.passed);
  const summary = failedAssertions.length > 0
    ? `expected ${failedAssertions[0].field} ${failedAssertions[0].operator} ${JSON.stringify(failedAssertions[0].expected)}, got ${JSON.stringify(failedAssertions[0].actual)}`
    : (step.error ?? 'step failed');

  const content: ADFNode[] = [];
  content.push(heading(2, 'Collection'));
  content.push(paragraphText(`${collection.name} — Environment: ${environment.name} (${environment.baseUrl})`));

  content.push(heading(2, 'Failed Step'));
  content.push(paragraphText(`${step.stepName} — ${step.request.method} ${step.request.url}`));
  content.push(paragraphText(`Status: ${step.response?.status ?? 'N/A'} | Duration: ${step.durationMs}ms`));

  if (failedAssertions.length > 0) {
    content.push(heading(2, 'Failed Assertions'));
    content.push(orderedList(
      failedAssertions.map(a =>
        `${a.field} ${a.operator} ${JSON.stringify(a.expected)} — got ${JSON.stringify(a.actual)}`
      )
    ));
  }

  content.push(heading(2, 'Request Sent'));
  const redactedHeaders = { ...step.request.headers };
  if (redactedHeaders['Authorization']) redactedHeaders['Authorization'] = '[REDACTED]';
  if (redactedHeaders['authorization']) redactedHeaders['authorization'] = '[REDACTED]';
  content.push(codeBlock(
    `${step.request.method} ${step.request.url}\n` +
    Object.entries(redactedHeaders).map(([k, v]) => `${k}: ${v}`).join('\n') +
    (step.request.body ? `\n\n${JSON.stringify(step.request.body, null, 2)}` : '')
  ));

  if (step.response) {
    content.push(heading(2, 'Response Received'));
    const bodyStr = typeof step.response.body === 'string'
      ? step.response.body.slice(0, 500)
      : JSON.stringify(step.response.body).slice(0, 500);
    content.push(codeBlock(`Status: ${step.response.status}\n${bodyStr}${step.response.bodyTruncated ? '\n[truncated]' : ''}`));
  }

  return { type: 'doc', version: 1, content };
}

// ─── Phase D Step 9: Enriched API Defect ADF ────────────────────────────────

export function buildEnrichedApiDefectAdf(payload: ApiDefectPayload): ADFNode {
  const content: ADFNode[] = [];

  content.push(heading(2, 'Collection'));
  content.push(paragraphText(`${payload.collectionName} — Environment: ${payload.environmentName} (${payload.environmentBaseUrl})`));
  content.push(paragraphText(`Run ID: ${payload.runId}`));

  content.push(heading(2, 'Failed Step'));
  content.push(paragraphText(`${payload.stepName} — ${payload.method} ${payload.url}`));
  content.push(paragraphText(`Status: ${payload.httpStatus ?? 'N/A'} | Duration: ${payload.durationMs}ms | Retries: ${payload.retryCount}`));

  if (payload.flakinessScore !== undefined) {
    const flakyTag = payload.isFlaky ? '⚡ FLAKY' : 'stable';
    content.push(paragraphText(`Flakiness: ${flakyTag} | Score: ${Math.round(payload.flakinessScore * 100)}% | Fail Rate: ${Math.round((payload.failRate ?? 0) * 100)}%`));
  }

  if (payload.failedAssertions.length > 0) {
    content.push(heading(2, 'Failed Assertions'));
    content.push(orderedList(
      payload.failedAssertions.map(a =>
        `${a.field} ${a.operator} ${JSON.stringify(a.expected)} — got ${JSON.stringify(a.actual)}`
      )
    ));
  }

  if (payload.retryHistory.length > 0) {
    content.push(heading(2, 'Retry History'));
    content.push(orderedList(
      payload.retryHistory.map(h =>
        `Attempt ${h.attempt}: HTTP ${h.httpStatus ?? 'N/A'} — ${h.durationMs}ms${h.error ? ' | ' + h.error.slice(0, 80) : ''}`
      )
    ));
  }

  if (payload.dependencyChain.length > 0) {
    content.push(heading(2, 'Dependency Chain'));
    content.push(paragraphText(`This step depends on: ${payload.dependencyChain.join(', ')}`));
  }

  if (payload.healingSuggestions.length > 0) {
    content.push(heading(2, 'Healing Suggestions'));
    content.push(orderedList(
      payload.healingSuggestions.map(s =>
        `[${s.type}] ${s.reason} (confidence: ${Math.round(s.confidence * 100)}%)${s.suggestedUrl !== s.currentUrl ? ' → ' + s.suggestedUrl : ''}`
      )
    ));
  }

  if (payload.requestBody) {
    content.push(heading(2, 'Request Sent'));
    content.push(codeBlock(`${payload.method} ${payload.url}\n\n${payload.requestBody}`));
  }

  if (payload.responseBody) {
    content.push(heading(2, 'Response Received'));
    content.push(codeBlock(`Status: ${payload.httpStatus ?? 'N/A'}\n${payload.responseBody}`));
  }

  if (payload.errorMessage) {
    content.push(heading(2, 'Error'));
    content.push(codeBlock(payload.errorMessage));
  }

  return { type: 'doc', version: 1, content };
}
