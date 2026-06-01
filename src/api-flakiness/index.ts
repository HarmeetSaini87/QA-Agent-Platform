// src/api-flakiness/index.ts
export type {
  FailureCategory,
  FailureSignature,
  RetryStats,
  StepFlakinessRecord,
  ClusterDimension,
  ClusterGroup,
  CollectionFlakinessReport,
} from './contracts/flakiness.contracts';
export { buildFailureSignature } from './failure-signature';
export { aggregateRunsForStep } from './aggregator';
export { clusterFailures } from './cluster-engine';
export { getReport, recomputeAndSave, computeReport } from './flakiness-service';
