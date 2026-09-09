import { setTimeout as delay } from 'node:timers/promises';
export async function waitUntil(observe, label, { timeoutMs = 2000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('positive wait deadline required');
  const start = performance.now();
  while (!(await observe())) {
    if (performance.now() - start >= timeoutMs)
      throw Error(`${label} did not complete within ${timeoutMs}ms`);
    await delay(1);
  }
}
