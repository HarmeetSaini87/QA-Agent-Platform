import type { ApiTestStep } from '../../data/types';
import type { AiRecommendation } from '../../api-intelligence/contracts/recommendation.contracts';
import type { RemediationFieldChange } from '../contracts/remediation-proposal.contracts';

export function buildDiff(rec: AiRecommendation, steps: ApiTestStep[]): RemediationFieldChange[] {
  const step = steps.find(s => s.id === rec.stepId);
  const label = step?.name ?? rec.stepId ?? 'step';
  const changes: RemediationFieldChange[] = [];

  switch (rec.category) {
    case 'retry': {
      const current = step?.execution?.retryPolicy?.maxRetries ?? 0;
      changes.push({
        field: 'execution.retryPolicy.maxRetries',
        before: current,
        after: Math.max(0, current - 1),
        humanLabel: `Max retries for '${label}'`,
      });
      break;
    }
    case 'healing': {
      changes.push({
        field: 'request.url',
        before: step?.request?.url ?? '(current URL)',
        after: rec.actionHint,
        humanLabel: `URL for '${label}'`,
      });
      break;
    }
    case 'dependency': {
      changes.push({
        field: 'dependsOn',
        before: step?.dependsOn ?? [],
        after: '(remove orphaned dependency references)',
        humanLabel: `Dependency list for '${label}'`,
      });
      break;
    }
    case 'assertion': {
      changes.push({
        field: 'assertions',
        before: `${step?.assertions?.length ?? 0} assertions configured`,
        after: rec.actionHint,
        humanLabel: `Assertion coverage for '${label}'`,
      });
      break;
    }
    case 'flakiness': {
      const currentMax = step?.execution?.retryPolicy?.maxRetries ?? 0;
      changes.push({
        field: 'execution.retryPolicy.maxRetries',
        before: currentMax,
        after: Math.max(2, currentMax),
        humanLabel: `Max retries for '${label}'`,
      });
      changes.push({
        field: 'quarantineEligible',
        before: false,
        after: true,
        humanLabel: `Quarantine eligibility for '${label}'`,
      });
      break;
    }
    case 'environment': {
      changes.push({
        field: 'environment.baseUrl',
        before: '(current environment base URL)',
        after: rec.actionHint,
        humanLabel: 'Environment base URL',
      });
      break;
    }
    default:
      break;
  }
  return changes;
}
