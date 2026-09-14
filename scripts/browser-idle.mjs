import { waitScaleFromEnvironment, liveSliceFromEnvironment } from './host-profile.mjs';
/** A settled window that can prove the renderer was alive while nothing changed.
 * "Nothing changed" is the assertion; "no animation frame ran" is starvation, and a starved
 * window would pass every nothing-changed assertion for the wrong reason. Alive means the
 * presentation loop ran in every third of the window: a change queued at any point would then
 * have been drawn, and a late one would have been drawn before the reading after the window.
 * The rule scales with the window and asks nothing about frame rate — a slow loop under
 * contention still proves the window; only a stalled one does not. */
export const FRAME_MS = 1000 / 60;
export const SEGMENTS = 3;
/** Wait for a page predicate, refusing a starved renderer instead of expiring a private
 * deadline: the wait proceeds in slices, and a slice in which the presentation loop did not
 * tick means the page could not have answered — that is `renderer starved`, not "the predicate
 * stayed false". A live loop that is merely slow keeps waiting up to `maxMs`, which stays under
 * the row watchdog so a predicate that never becomes true still fails inside the check, with
 * its evidence (slices waited, ticks seen) and the failure artifacts a watchdog kill would lose. */
export async function liveWait(
  page,
  predicate,
  argument,
  { sliceMs = liveSliceFromEnvironment(), maxMs = 30000, label = 'predicate' } = {},
) {
  // Patience scales with the platform (a slow runner is slower everywhere); the slice is the
  // platform's own registered fact — starvation is "no frame in a slice" on any host.
  const scale = waitScaleFromEnvironment();
  const budgetMs = maxMs * scale;
  const ticks = () =>
    page.evaluate(() => window.workshopProbe.readInteractionState().rendering.loopTicks);
  const first = await ticks();
  const sample = { label, sliceMs, maxMs: budgetMs, ticksPerSlice: [], outcome: null };
  const record = (outcome) => {
    sample.outcome = outcome;
    sample.slices = sample.ticksPerSlice.length;
    for (const sink of sinks) sink({ ...sample, ticksPerSlice: [...sample.ticksPerSlice] });
  };
  let before = first;
  for (let slices = 1; slices * sliceMs <= budgetMs; slices++) {
    try {
      const result = await page.waitForFunction(predicate, argument, { timeout: sliceMs });
      sample.ticksPerSlice.push(Math.max(0, (await ticks()) - before));
      record('true');
      return result;
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
    }
    const after = await ticks();
    sample.ticksPerSlice.push(Math.max(0, after - before));
    if (after <= before) {
      record('renderer-starved');
      const starved = Error(
        `renderer starved: no animation frame in a ${sliceMs} ms wait slice (slice ${slices}); the wait proves nothing`,
      );
      starved.failureKind = 'renderer-starved';
      throw starved;
    }
    before = after;
  }
  record('expired');
  throw Error(
    `${label} stayed false for ${budgetMs} ms (${Math.floor(budgetMs / sliceMs)} slices) while the presentation loop ticked ${before - first} times`,
  );
}
/** Every live wait reports its slices and per-slice loop ticks to registered sinks: the
 * browser session writes them into its timing record so a hosted run measures the renderer
 * cadence its `liveSliceMs` is later registered from. Returns the unregister function. */
const sinks = new Set();
export function recordLiveWaits(sink) {
  sinks.add(sink);
  return () => sinks.delete(sink);
}
export async function settledWindow(page, ms, { wait = (t) => page.waitForTimeout(t) } = {}) {
  const ticks = () =>
    page.evaluate(() => window.workshopProbe.readInteractionState().rendering.loopTicks);
  const segment = Math.floor(ms / SEGMENTS);
  const samples = [await ticks()];
  for (let i = 1; i <= SEGMENTS; i++) {
    await wait(i === SEGMENTS ? ms - segment * (SEGMENTS - 1) : segment);
    samples.push(await ticks());
  }
  const segments = samples.slice(1).map((s, i) => s - samples[i]);
  const stalled = segments.findIndex((n) => n <= 0);
  if (stalled !== -1) {
    const error = Error(
      `renderer starved: no animation frame in third ${stalled + 1} of a ${ms} ms window (${segments.join('/')} frames); the window proves nothing`,
    );
    error.failureKind = 'renderer-starved';
    throw error;
  }
  return {
    ms,
    before: samples[0],
    after: samples.at(-1),
    observed: samples.at(-1) - samples[0],
    segments,
  };
}
/** Hold a drive and wait for a number of driven ticks: the count starts at the tick the page
 * first reports the command (a source duty), not at the harness's key press, because the
 * press reaches a slow page late and ticks are wall-clock accumulated — a read at an absolute
 * tick would then measure harness latency, not the machine. Returns the tick the drive began. */
export async function drivenTicks(page, ticks, { label = 'drive' } = {}) {
  await liveWait(
    page,
    () =>
      JSON.parse(window.render_game_to_text()).power.sources.some((source) => source.duty !== 0),
    undefined,
    { label: `${label}: command observed` },
  );
  const start = await page.evaluate(() => JSON.parse(window.render_game_to_text()).tick);
  await liveWait(page, (t) => JSON.parse(window.render_game_to_text()).tick >= t, start + ticks, {
    label: `${label}: ${ticks} driven ticks`,
  });
  return start;
}
