import { writeSync } from 'node:fs';
const started = performance.now();
writeSync(2, '[cloud-runtime] import begin\n');
try {
  await import('./playtest/verify-runtime.mjs');
  writeSync(
    2,
    `[cloud-runtime] import end elapsedMs=${(performance.now() - started).toFixed(1)}\n`,
  );
} catch (error) {
  writeSync(
    2,
    `[cloud-runtime] import failed elapsedMs=${(performance.now() - started).toFixed(1)} ${error.stack ?? error}\n`,
  );
  throw error;
}
