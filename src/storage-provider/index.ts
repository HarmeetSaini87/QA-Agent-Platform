/**
 * storage-provider/index.ts
 * Barrel export for all storage wrappers.
 *
 * DEPENDENCY BOUNDARY — storage-provider modules:
 *   MAY import:   data/store.ts, data/types.ts, shared-core/contracts/
 *   MUST NOT import: ui/, auth/, api-runtime/, execution-coordinator/
 *
 * Storage layout summary:
 *   data/api-collections.json         collection-store (ApiCollection)
 *   data/api-envs.json                environment-store (ApiEnvironment)
 *   data/workflows/<id>.json          workflow-store (WorkflowEnvelope)
 *   data/api-runs/<id>.json           execution-store (ApiCollectionRunResult)
 *   data/api-runs/<id>.snapshot.json  execution-store (ExecutionSnapshot)
 *   data/api-baselines/<c>__<s>.json  artifact-store (ApiResponseSnapshot baseline)
 *   data/api-har/<id>.har.json        artifact-store (HarArtifact)
 *   data/api-timelines/<id>.json      artifact-store (ExecutionTimeline)
 *   data/settings.json                config-store (AppSettings singleton)
 *   data/nl-config.json               config-store (NlConfig)
 *   data/jira-config.json             config-store (JiraConfig — credential file)
 *   data/common_data.json             variable-store (CommonData)
 *   data/common_data.json + api-envs  variable-store (scope layer builder)
 */

export * from './collection-store';
export * from './environment-store';
export * from './workflow-store';
export * from './execution-store';
export * from './artifact-store';
export * from './config-store';
export * from './variable-store';
