// src/api-flakiness/cluster-engine.ts
import type { StepFlakinessRecord, ClusterGroup, ClusterDimension } from './contracts/flakiness.contracts';

interface ClusterAccumulator {
  dimension: ClusterDimension;
  dimensionKey: string;
  stepIds: string[];
  stepNames: string[];
  totalFailures: number;
  flakinessScores: number[];
}

export function clusterFailures(records: StepFlakinessRecord[]): ClusterGroup[] {
  const accumulators = new Map<string, ClusterAccumulator>();

  function addToCluster(clusterId: string, dimension: ClusterDimension, dimensionKey: string, rec: StepFlakinessRecord): void {
    if (!accumulators.has(clusterId)) {
      accumulators.set(clusterId, { dimension, dimensionKey, stepIds: [], stepNames: [], totalFailures: 0, flakinessScores: [] });
    }
    const acc = accumulators.get(clusterId)!;
    acc.stepIds.push(rec.stepId);
    acc.stepNames.push(rec.stepName);
    acc.totalFailures += rec.failedRuns;
    acc.flakinessScores.push(rec.flakinessScore);
  }

  for (const rec of records) {
    const sig = rec.dominantSignature;
    if (!sig) continue;

    switch (sig.category) {
      case 'http_status':
        if (sig.httpStatus !== undefined) {
          addToCluster(`http_status:${sig.httpStatus}`, 'http_status', String(sig.httpStatus), rec);
        }
        break;
      case 'assertion':
        if (sig.assertionField && sig.assertionOperator) {
          const key = `${sig.assertionField} ${sig.assertionOperator}`;
          addToCluster(`assertion_type:${key}`, 'assertion_type', key, rec);
        }
        break;
      case 'network':
      case 'timeout':
        if (sig.transportError) {
          addToCluster(`transport_error:${sig.transportError}`, 'transport_error', sig.transportError, rec);
        }
        break;
      case 'dependency_propagation':
        addToCluster('dependency_chain:propagation', 'dependency_chain', 'propagation', rec);
        break;
    }
  }

  return Array.from(accumulators.entries())
    .filter(([, acc]) => acc.stepIds.length >= 1)
    .map(([clusterId, acc]) => ({
      clusterId,
      dimension: acc.dimension,
      dimensionKey: acc.dimensionKey,
      stepIds: acc.stepIds,
      stepNames: acc.stepNames,
      totalFailures: acc.totalFailures,
      avgFlakinessScore: parseFloat(
        (acc.flakinessScores.reduce((s, v) => s + v, 0) / acc.flakinessScores.length).toFixed(4)
      ),
    }))
    .sort((a, b) => b.totalFailures - a.totalFailures);
}
