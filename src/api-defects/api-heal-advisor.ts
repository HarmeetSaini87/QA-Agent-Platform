import type { ApiStepResult } from '../data/types';
import type { ApiHealingSuggestion } from './contracts/api-defect.contracts';

const VERSION_RX = /\/(v\d+)\//i;

export function proposeUrlFixes(step: ApiStepResult): ApiHealingSuggestion[] {
  const suggestions: ApiHealingSuggestion[] = [];
  const url = step.request.url;
  const status = step.response?.status;
  const error = step.error ?? '';

  if (step.status === 'passed' && !error) return [];

  if (status === 404) {
    const m = url.match(VERSION_RX);
    if (m) {
      const currentVersion = m[1];
      const versionNum = parseInt(currentVersion.replace('v', ''), 10);
      if (!isNaN(versionNum)) {
        const nextVersion = `v${versionNum + 1}`;
        suggestions.push({
          type: 'version_drift',
          currentUrl: url,
          suggestedUrl: url.replace(`/${currentVersion}/`, `/${nextVersion}/`),
          confidence: 0.6,
          reason: `Endpoint returned 404. API may have upgraded from ${currentVersion} to ${nextVersion}.`,
        });
      }
    }

    if (!url.includes('/api/')) {
      const urlObj = tryParseUrl(url);
      if (urlObj) {
        suggestions.push({
          type: 'missing_prefix',
          currentUrl: url,
          suggestedUrl: urlObj.origin + '/api' + urlObj.pathname + urlObj.search,
          confidence: 0.5,
          reason: 'Endpoint returned 404. Common fix: add /api prefix to the path.',
        });
      }
    }
  }

  if (!step.response && (error.includes('ECONNREFUSED') || error.includes('ENOTFOUND') || error.includes('ETIMEDOUT'))) {
    suggestions.push({
      type: 'base_url_drift',
      currentUrl: url,
      suggestedUrl: url,
      confidence: 0.7,
      reason: `Network error: ${error.slice(0, 80)}. Verify the base URL in the environment configuration.`,
    });
  }

  if (status === 401 || status === 403) {
    suggestions.push({
      type: 'auth_refresh',
      currentUrl: url,
      suggestedUrl: url,
      confidence: 0.8,
      reason: `Auth failure (${status}). Refresh the bearer token or API key in the environment configuration.`,
    });
  }

  return suggestions;
}

function tryParseUrl(url: string): URL | null {
  try { return new URL(url); } catch { return null; }
}
