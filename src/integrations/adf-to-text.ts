/**
 * adf-to-text.ts
 * Converts Atlassian Document Format (ADF) JSON to plain text.
 * Jira Cloud stores all rich text fields (description, AC) as ADF.
 */

import { AdfNode, AdfDocument } from '../types/jira.types';

// ── Node type → text conversion ───────────────────────────────────────────────

function nodeToText(node: AdfNode, depth = 0, _index?: number): string {
  if (!node) return '';

  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map(n => nodeToText(n, depth)).join('\n').trim();

    case 'paragraph':
      return (node.content ?? []).map(n => nodeToText(n, depth)).join('') + '\n';

    case 'text':
      return node.text ?? '';

    case 'hardBreak':
      return '\n';

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1;
      const prefix = '#'.repeat(level) + ' ';
      return prefix + (node.content ?? []).map(n => nodeToText(n)).join('') + '\n';
    }

    case 'bulletList':
      return (node.content ?? []).map(n => nodeToText(n, depth)).join('') + '\n';

    case 'orderedList':
      return (node.content ?? []).map((n, i) => nodeToText(n, depth, i + 1)).join('') + '\n';

    case 'listItem': {
      const prefix = depth > 0 ? '  '.repeat(depth) + '• ' : '• ';
      return prefix + (node.content ?? []).map(n => nodeToText(n, depth + 1)).join('').trim() + '\n';
    }

    case 'blockquote':
      return (node.content ?? []).map(n => '> ' + nodeToText(n, depth)).join('');

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? '';
      const code = (node.content ?? []).map(n => n.text ?? '').join('');
      return '```' + lang + '\n' + code + '\n```\n';
    }

    case 'inlineCode':
      return '`' + (node.text ?? '') + '`';

    case 'rule':
      return '\n---\n';

    case 'table': {
      const rows = (node.content ?? []).map(row => {
        const cells = (row.content ?? []).map(cell =>
          (cell.content ?? []).map(n => nodeToText(n)).join('').trim()
        );
        return '| ' + cells.join(' | ') + ' |';
      });
      return rows.join('\n') + '\n';
    }

    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return (node.content ?? []).map(n => nodeToText(n, depth)).join('');

    case 'mention':
      return `@${(node.attrs?.text as string) ?? 'user'}`;

    case 'emoji':
      return (node.attrs?.shortName as string) ?? '';

    case 'panel': {
      const panelType = (node.attrs?.panelType as string) ?? 'info';
      const content = (node.content ?? []).map(n => nodeToText(n)).join('');
      return `[${panelType.toUpperCase()}]\n${content}\n`;
    }

    case 'expand': {
      const title = (node.attrs?.title as string) ?? '';
      const content = (node.content ?? []).map(n => nodeToText(n)).join('');
      return `[${title}]\n${content}\n`;
    }

    case 'mediaSingle':
    case 'media':
      return '[attachment]\n';

    default:
      // Fallback — recurse into content if available
      if (node.content) {
        return node.content.map(n => nodeToText(n, depth)).join('');
      }
      return node.text ?? '';
  }
}

export function adfToText(adf: AdfDocument | null | undefined): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf; // Already plain text in some older Jira versions
  return nodeToText(adf).replace(/\n{3,}/g, '\n\n').trim();
}

// ── Acceptance criteria extractor ─────────────────────────────────────────────
// When AC is embedded in the description (no separate AC field),
// extract the section that starts with a heading containing "acceptance"

export function extractACFromDescription(plainText: string): {
  description: string;
  acceptanceCriteria: string;
} {
  // Match an "Acceptance Criteria" heading (markdown ## or plain) and everything after it
  // until the next heading or end of string
  const acPatterns = [
    // Markdown heading: ## Acceptance Criteria
    /^#{1,4}\s*acceptance\s+criteria\s*\n([\s\S]+?)(?=\n#{1,4}\s|\s*$)/im,
    // Plain label: "Acceptance Criteria:" or "Acceptance Criteria\n"
    /acceptance\s+criteria\s*:?\s*\n([\s\S]+?)(?=\n#{1,4}\s|\s*$)/im,
  ];

  for (const pattern of acPatterns) {
    const match = plainText.match(pattern);
    if (match && match[1]?.trim()) {
      const ac = match[1].trim();
      // Remove the full matched block (heading + content) from description
      const description = plainText.replace(match[0], '').trim();
      return { description, acceptanceCriteria: ac };
    }
  }

  // Fallback: look for BDD blocks (Given/When/Then) anywhere in the text
  const bddPattern = /(?:^|\n)((?:given|when|then)[\s\S]+?)(?=\n#{1,4}\s|\s*$)/im;
  const bddMatch = plainText.match(bddPattern);
  if (bddMatch && bddMatch[1]?.trim()) {
    return {
      description: plainText.replace(bddMatch[0], '').trim(),
      acceptanceCriteria: bddMatch[1].trim(),
    };
  }

  return { description: plainText, acceptanceCriteria: '' };
}
