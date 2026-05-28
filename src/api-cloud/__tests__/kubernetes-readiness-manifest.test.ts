// src/api-cloud/__tests__/kubernetes-readiness-manifest.test.ts
import { describe, it, expect } from 'vitest';
import { KubernetesReadinessManifestBuilder } from '../kubernetes-readiness-manifest';

describe('KubernetesReadinessManifestBuilder', () => {
  const builder = new KubernetesReadinessManifestBuilder();

  it('buildPodSpec: produces required labels', () => {
    const spec = builder.buildPodSpec({ workerId: 'abc12345' });
    expect(spec.labels['app.kubernetes.io/name']).toBe('qa-agent-platform');
    expect(spec.labels['qa-platform/worker-id']).toBe('abc12345');
  });

  it('buildPodSpec: includes tenant label when provided', () => {
    const spec = builder.buildPodSpec({ workerId: 'w1', tenantId: 'acme' });
    expect(spec.labels['qa-platform/tenant-id']).toBe('acme');
    expect(spec.namespace).toContain('acme');
  });

  it('buildPodSpec: default namespace when no tenant', () => {
    const spec = builder.buildPodSpec({ workerId: 'w1' });
    expect(spec.namespace).toBe('qa-platform');
  });

  it('buildPodSpec: replay and teardown owners set when runId provided', () => {
    const spec = builder.buildPodSpec({ workerId: 'w1', runId: 'run-99' });
    expect(spec.annotations['qa-platform/replay-owner']).toBe('w1');
    expect(spec.annotations['qa-platform/teardown-owner']).toBe('w1');
  });

  it('validate: valid spec passes', () => {
    const spec = builder.buildPodSpec({ workerId: 'w1' });
    const result = builder.validate(spec);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('validate: missing worker-id fails', () => {
    const spec = builder.buildPodSpec({ workerId: 'w1' });
    // Simulate missing label
    const broken = { ...spec, labels: { ...spec.labels, 'qa-platform/worker-id': undefined } as never };
    const result = builder.validate(broken);
    expect(result.valid).toBe(false);
    expect(result.missing.some(m => m.includes('worker-id'))).toBe(true);
  });
});
