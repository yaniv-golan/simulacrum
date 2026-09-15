// A readiness probe for the operator: would a tier's launch admission admit the host now, and is
// the verification window free? Read-only — it samples what the admission samples, evaluates
// both reaches through the admission's own code with no wait, reads the window owner and holds
// nothing. It is advisory: the tier's own launch admission decides, and nothing here is an
// attempt, a report or evidence.
import { cpus, loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';
import { admitQuietHost, PRESSURE_POLICY } from './check-sequence.mjs';
import { samplePressure } from './host-pressure.mjs';
import { launchAdmission, REACHES } from './verification-tiers.mjs';
import { currentWindowOwner, describeOwner } from './verification-window.mjs';
export const ADVISORY = "advisory: the tier's own launch admission decides";
export async function hostReadiness({
  reach = 'timing',
  cores = cpus().length,
  load1 = () => loadavg()[0],
  pressure = () => samplePressure(),
  owner = () => currentWindowOwner(),
  policy = PRESSURE_POLICY,
} = {}) {
  if (!REACHES.includes(reach))
    throw Error(`verify:host needs a reach (${REACHES.join('|')}), got ${reach}`);
  // One sample serves both verdicts; the admission code itself evaluates it with no wait.
  const sample = await pressure();
  const load = load1();
  const host = { cores, load1: () => load, pressure: async () => sample };
  const admit = (options) => admitQuietHost({ ...options, waitMs: 0 });
  const verdicts = {};
  for (const candidate of REACHES)
    verdicts[candidate] = await launchAdmission({ reach: candidate, admit, host, policy });
  const rows = [];
  const foreign = (sample.foreign ?? []).map((entry) => `${entry.comm} ${entry.pcpu} %`).join(', ');
  rows.push(
    sample.method === 'unavailable'
      ? {
          id: 'pressure',
          ok: true,
          detail: `sampler unavailable (${sample.error ?? 'no detail'}); the admission decides on load alone`,
        }
      : {
          id: 'pressure',
          ok: true,
          detail: `idle ${sample.idlePercent} %, load1 ${Number(load.toFixed(2))} of ${cores} cores; busiest foreign: ${foreign || 'none ≥ 1 %'}`,
        },
  );
  for (const candidate of REACHES) {
    const verdict = verdicts[candidate];
    rows.push(
      verdict.ok
        ? { id: `admission:${candidate}`, ok: true, detail: 'would be admitted now' }
        : { id: `admission:${candidate}`, ok: false, error: verdict.reason },
    );
  }
  const held = owner();
  rows.push(
    held
      ? { id: 'window', ok: false, error: `held by ${describeOwner(held)}` }
      : { id: 'window', ok: true, detail: 'free' },
  );
  const admitted = verdicts[reach].ok && !held;
  return { reach, rows, admitted, advisory: ADVISORY };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const reachIndex = argv.indexOf('--reach');
  const reach = reachIndex === -1 ? 'timing' : argv[reachIndex + 1];
  const unknown = argv.filter(
    (arg, i) =>
      !['--json', '--reach'].includes(arg) && !(i === reachIndex + 1 && reachIndex !== -1),
  );
  if (unknown.length || (reachIndex !== -1 && !REACHES.includes(reach))) {
    console.error('Usage: verify:host [--reach timing|structural] [--json]');
    process.exitCode = 1;
  } else {
    const result = await hostReadiness({ reach });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const row of result.rows)
        console.log(`${row.ok ? 'ok  ' : 'no  '} ${row.id.padEnd(22)} ${row.detail ?? row.error}`);
      console.log(
        `${result.admitted ? 'READY' : 'NOT READY'} for a ${result.reach}-reach launch — ${result.advisory}`,
      );
    }
    process.exitCode = result.admitted ? 0 : 1;
  }
}
