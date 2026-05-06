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
  content.push(paragraphText(`testId: ${input.testId}`));

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
  content.push(emptyParagraph());

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
