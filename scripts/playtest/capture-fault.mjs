// Faults alter transport only, never controller/physics or production clock behavior.
export async function installCaptureFault(page, name, expectedErrors) {
  if (!['withheld-ack', 'stalled-request', 'periodic-loss', 'reload-recovery'].includes(name))
    throw Error('Unknown capture fault');
  const state = { name, injected: 0, recovered: false, aborted: 0, requests: [] };
  const started = Date.now();
  state.startedAt = started;
  const pattern = '**/api/playtest/v2/**';
  const handler = async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!/\/(media|event)$/.test(url.pathname)) return route.continue();
    const at = Date.now();
    const elapsed = at - started;
    const inject =
      name === 'reload-recovery' ||
      (name === 'periodic-loss' ? elapsed < 90000 && elapsed % 30000 < 5000 : state.injected === 0);
    if (!inject) return route.continue();
    state.injected++;
    // Only exact injected endpoints/errors are expected; unrelated failures remain fatal.
    const exact = '^' + request.url().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
    expectedErrors.push(
      { type: 'http', status: 503, url: exact },
      { type: 'console', message: 'Failed to load resource', url: exact },
    );
    state.requests.push({ path: url.pathname, at, fault: name });
    if (name === 'withheld-ack') {
      const committed = await route.fetch();
      if (!committed.ok()) throw Error('Acknowledgement fault must follow real server commit');
    }
    if (name === 'stalled-request') {
      expectedErrors.push({ type: 'request', url: exact, message: 'net::ERR_ABORTED' });
      await new Promise((resolve) => setTimeout(resolve, 46000));
      if (request.failure()?.errorText !== 'net::ERR_ABORTED')
        throw Error('Stalled request did not exercise the real abort deadline');
      state.aborted++;
    }
    await route
      .fulfill({
        status: 503,
        headers: { 'retry-after': '1' },
        json: { error: 'synthetic transport fault' },
      })
      .catch((error) => {
        if (name !== 'stalled-request' || request.failure()?.errorText !== 'net::ERR_ABORTED')
          throw error;
      });
  };
  await page.route(pattern, handler);
  return {
    state,
    async stop() {
      await page.unroute(pattern, handler);
      state.endedAt = Date.now();
      if (!state.injected) throw Error('Fault was never exercised');
    },
  };
}
