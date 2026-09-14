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
  { sliceMs = 2000, maxMs = 30000, label = 'predicate' } = {},
) {
  const ticks = () =>
    page.evaluate(() => window.workshopProbe.readInteractionState().rendering.loopTicks);
  const first = await ticks();
  let before = first;
  for (let slices = 1; slices * sliceMs <= maxMs; slices++) {
    try {
      return await page.waitForFunction(predicate, argument, { timeout: sliceMs });
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
    }
    const after = await ticks();
    if (after <= before) {
      const starved = Error(
        `renderer starved: no animation frame in a ${sliceMs} ms wait slice (slice ${slices}); the wait proves nothing`,
      );
      starved.failureKind = 'renderer-starved';
      throw starved;
    }
    before = after;
  }
  throw Error(
    `${label} stayed false for ${maxMs} ms (${Math.floor(maxMs / sliceMs)} slices) while the presentation loop ticked ${before - first} times`,
  );
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
