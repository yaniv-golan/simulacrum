// The milestone gate EXECUTES what it owns and propagates failure. It never
// prints an instruction and exits zero.
//
// Structural checks, bars and exit obligations are ALL CUMULATIVE: a later gate
// re-checks everything due at or before it. Obligations previously read only
// `[target]`, so an M1 gate passed with an unmet M0 obligation.
import { readManifest } from './validate-manifest.mjs';
import { pathToFileURL } from 'node:url';
import { createVerificationContext } from './verification-run.mjs';
import { runStructuralChecks } from './gate-structural.mjs';
import { evaluateBar } from './bars.mjs';
import { CHECKS, executeCheck } from './checks.mjs';
import { prepareBrowserBuild } from './verify-browser-suite.mjs';

const manifest = readManifest();
export async function runGate(target = manifest.milestone, context = createVerificationContext()) {
  const gateStarted = performance.now();

  if (!manifest.milestones.includes(target)) {
    console.error(`unknown milestone: ${target}`);
    throw Error(`unknown milestone: ${target}`);
  }
  if (target !== manifest.milestone) {
    console.error(`current milestone is ${manifest.milestone}; refusing to gate ${target}`);
    throw Error(`current milestone is ${manifest.milestone}; refusing to gate ${target}`);
  }

  const order = manifest.milestones;
  const cutoff = order.indexOf(target);
  const dueAt = (m) => order.indexOf(m) <= cutoff;

  if (manifest.milestones.indexOf(target) >= manifest.milestones.indexOf('M3b'))
    await prepareBrowserBuild(context);

  console.log(`milestone ${target} (owned by scripts/manifest.json)\n`);
  const { failed, ran } = await runStructuralChecks(target, context);

  const bars = [];
  let redBars = 0;
  let dueBarCount = 0;
  for (const [id, bar] of Object.entries(manifest.bars)) {
    if (!dueAt(bar.dueAt)) {
      console.log(`--    bar:${id.padEnd(4)} deferred to ${bar.dueAt}`);
      continue;
    }
    dueBarCount += 1;
    const result = await evaluateBar(id, context);
    const { state, why } = result;
    bars.push({
      ...result,
      human: Boolean(bar.human),
      ...(bar.human ? { assessment: result.assessment ?? 'invalid' } : {}),
    });
    if (state === 'RED') redBars += 1;
    console.log(`${state.padEnd(5)} bar:${id.padEnd(4)} due ${bar.dueAt} -- ${why}`);
  }

  // Every obligation due at or before the target, not only this milestone's.
  let unmet = 0;
  let obligationCount = 0;
  for (const milestone of order.filter(dueAt)) {
    const obligations = manifest.exitObligations?.[milestone];
    if (obligations === undefined) {
      unmet += 1;
      console.error(`UNREG  ${milestone} declares no exit obligations -- register them`);
      continue;
    }
    for (const ob of obligations) {
      obligationCount += 1;
      if (!ob.check) {
        unmet += 1;
        console.error(`UNMET  ${ob.id} (${milestone}) -- no check registered: ${ob.how}`);
        continue;
      }
      const fn = CHECKS[ob.check];
      if (typeof fn !== 'function') {
        unmet += 1;
        console.error(
          `BADREF ${ob.id} (${milestone}) -- check "${ob.check}" is not in the registry`,
        );
        continue;
      }
      try {
        // Deadlines are enforced EXTERNALLY, in a child process. Promise.race
        // shares an event loop with the check, so a synchronous loop simply
        // prevents the timer firing: an 80 ms blocking check passed a 10 ms
        // deadline. Only a separate process can be killed.
        await executeCheck(ob.check, context);
        console.log(`ok     ${ob.id} (${milestone})`);
      } catch (error) {
        unmet += 1;
        console.error(`FAIL   ${ob.id} (${milestone}): ${error.message}`);
      }
    }
  }

  if (failed > 0 || redBars > 0 || unmet > 0) {
    console.error(
      `\nREFUSED at ${target}: ${failed} of ${ran} structural check(s) not green; ` +
        `${redBars} of ${dueBarCount} due bar(s) red; ${unmet} of ${obligationCount} obligation(s) unmet.`,
    );
    return { ok: false, failed, ran, redBars, dueBarCount, unmet, obligationCount, bars };
  }
  console.log(`\n${target} gate green in ${(performance.now() - gateStarted).toFixed(1)}ms.`);

  return { ok: true, failed, ran, redBars, dueBarCount, unmet, obligationCount, bars };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runGate(process.argv[2]);
  process.exitCode = result.ok ? 0 : 1;
}
