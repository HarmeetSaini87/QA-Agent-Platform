const MAX_CONCURRENT_RUNS = 3;
let activeRunCount = 0;
const runQueue: Array<() => void> = [];

export { MAX_CONCURRENT_RUNS, activeRunCount, runQueue };

export function enqueueRun(fn: () => void): void {
  if (activeRunCount < MAX_CONCURRENT_RUNS) {
    activeRunCount++;
    fn();
  } else {
    runQueue.push(fn);
  }
}

export function onRunComplete(): void {
  activeRunCount--;
  if (runQueue.length > 0) {
    activeRunCount++;
    const next = runQueue.shift()!;
    next();
  }
}