import { describe, it, expect, beforeEach } from 'vitest';
import { SimpleWorkerPool } from '../simple-worker-pool';
import { createInProcessWorker } from '../../runtime-workers/in-process-worker';

function makeMeta(w: ReturnType<typeof createInProcessWorker>) {
  return {
    workerId: w.workerId,
    runtimeType: 'in-process' as const,
    createdAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
  };
}

describe('SimpleWorkerPool', () => {
  let pool: SimpleWorkerPool;
  beforeEach(() => { pool = new SimpleWorkerPool(); });

  it('returns null when no workers registered', () => {
    expect(pool.selectWorker()).toBeNull();
  });

  it('selectWorker returns the registered worker', () => {
    const w = createInProcessWorker();
    pool.register(w, makeMeta(w));
    expect(pool.selectWorker()).toBe(w);
  });

  it('round-robins across two workers', () => {
    const w1 = createInProcessWorker('w1');
    const w2 = createInProcessWorker('w2');
    pool.register(w1, makeMeta(w1));
    pool.register(w2, makeMeta(w2));
    const first = pool.selectWorker();
    const second = pool.selectWorker();
    const third = pool.selectWorker();
    expect(first).not.toBe(second);
    expect(third).toBe(first);
  });

  it('skips disposed workers', async () => {
    const w1 = createInProcessWorker('w1');
    const w2 = createInProcessWorker('w2');
    pool.register(w1, makeMeta(w1));
    pool.register(w2, makeMeta(w2));
    await w1.dispose();
    expect(pool.selectWorker()).toBe(w2);
  });

  it('deregister removes worker from selection', () => {
    const w = createInProcessWorker();
    pool.register(w, makeMeta(w));
    pool.deregister(w.workerId);
    expect(pool.selectWorker()).toBeNull();
  });

  it('isAcceptingWork false when all workers disposed', async () => {
    const w = createInProcessWorker();
    pool.register(w, makeMeta(w));
    await w.dispose();
    expect(pool.isAcceptingWork).toBe(false);
  });

  it('getMetrics reports correct counts', () => {
    const w1 = createInProcessWorker('w1');
    const w2 = createInProcessWorker('w2');
    pool.register(w1, makeMeta(w1));
    pool.register(w2, makeMeta(w2));
    const m = pool.getMetrics();
    expect(m.totalWorkers).toBe(2);
    expect(m.acceptingWorkersCount).toBe(2);
  });

  it('getMetrics drops acceptingWorkersCount after worker disposal', async () => {
    const w1 = createInProcessWorker('w1');
    const w2 = createInProcessWorker('w2');
    pool.register(w1, makeMeta(w1));
    pool.register(w2, makeMeta(w2));
    await w1.dispose();
    const m = pool.getMetrics();
    expect(m.totalWorkers).toBe(2);
    expect(m.acceptingWorkersCount).toBe(1);
  });
});
