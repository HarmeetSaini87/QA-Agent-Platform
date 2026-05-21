import { nanoid } from 'nanoid';
import { ApiTestStep } from '../../data/types';
import { AiRecommendation, RecommendationProvenance } from '../contracts/recommendation.contracts';
import { AiGraphAnnotation } from '../contracts/graph-overlay-ai.contracts';

function provenance(evidenceRefs: string[]): RecommendationProvenance {
  return { source: 'dependency-analyzer', basis: 'heuristic', evidenceRefs, generatedAt: new Date().toISOString() };
}

export interface DependencyAnalysisResult {
  recommendations: AiRecommendation[];
  annotations: AiGraphAnnotation[];
}

export function analyzeDependencies(steps: ApiTestStep[], collectionId: string): DependencyAnalysisResult {
  const recommendations: AiRecommendation[] = [];
  const annotations: AiGraphAnnotation[] = [];
  const stepIds = new Set(steps.map(s => s.id));

  // Fan-in map: how many other steps depend on each step
  const fanIn: Record<string, number> = {};
  for (const step of steps) {
    for (const dep of (step.dependsOn ?? [])) {
      fanIn[dep] = (fanIn[dep] ?? 0) + 1;
    }
  }

  // Orphan dependsOn reference
  for (const step of steps) {
    for (const dep of (step.dependsOn ?? [])) {
      if (!stepIds.has(dep)) {
        recommendations.push({
          id: nanoid(8),
          category: 'dependency',
          severity: 'warning',
          title: `Step "${step.name}" has stale dependency reference`,
          detail: `dependsOn entry "${dep}" does not match any step id in this collection. It is silently ignored at runtime but indicates a stale or copy-paste reference.`,
          confidence: 95,
          actionHint: 'Remove or correct the stale dependsOn entry.',
          provenance: provenance([step.id, dep]),
          collectionId,
          stepId: step.id,
        });
      }
    }
  }

  // Bottleneck: step depended on by 3+ others
  for (const [stepId, count] of Object.entries(fanIn)) {
    if (count >= 3) {
      const step = steps.find(s => s.id === stepId);
      if (!step) continue;
      recommendations.push({
        id: nanoid(8),
        category: 'dependency',
        severity: 'warning',
        title: `Step "${step.name}" is a dependency bottleneck (${count} dependents)`,
        detail: `${count} other steps depend on this step. A single failure here causes all dependents to be skipped. Consider splitting setup responsibilities to reduce blast radius.`,
        confidence: 80,
        actionHint: 'Break this step into smaller independent setup steps, or use onFailure: "continue" on dependents that can safely proceed.',
        provenance: provenance([stepId]),
        collectionId,
        stepId,
      });
      annotations.push({
        nodeId: stepId,
        stepId,
        badges: [{ type: 'unstable-dependency', label: `${count} dependents`, confidence: 80, detail: `Bottleneck: ${count} steps depend on this node` }],
      });
    }
  }

  // Missing teardown
  const hasTeardown = steps.some(s => s.execution?.teardown === true);
  if (!hasTeardown && steps.length > 2) {
    recommendations.push({
      id: nanoid(8),
      category: 'workflow-quality',
      severity: 'info',
      title: 'No teardown steps defined in this collection',
      detail: 'Without teardown steps, each run may accumulate server-side state (created records, auth sessions). This causes assertion drift in later runs as state builds up.',
      confidence: 65,
      actionHint: 'Add cleanup steps (e.g. DELETE /resource/{id}) and mark them with execution.teardown = true.',
      provenance: provenance([collectionId]),
      collectionId,
    });
  }

  return { recommendations, annotations };
}
