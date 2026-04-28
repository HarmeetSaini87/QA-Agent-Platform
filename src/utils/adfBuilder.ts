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
