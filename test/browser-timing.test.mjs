import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBrowserSession } from '../scripts/browser-session.mjs';
for (const phase of ['browser-launch', 'context-setup']) {
  test(`${phase} evidence failure closes successfully acquired resources`, async () => {
    const context = {
      closed: false,
      async close() {
        this.closed = true;
      },
    };
    const browser = {
      closed: false,
      async close() {
        this.closed = true;
      },
      async newContext() {
        return context;
      },
    };
    const evidence = attachBrowserSession(
      { assertUnchanged() {} },
      {
        launchBrowser: async () => browser,
        writeArtifact(name, value) {
          if (
            name === 'timing.json' &&
            value.intervals.some((r) => r.name === phase && r.status === 'passed')
          )
            throw Error('timing write failed');
        },
      },
    );
    if (phase === 'browser-launch') await assert.rejects(evidence.launch({ profile: 'ui' }));
    else {
      const b = await evidence.launch({ profile: 'ui' });
      await assert.rejects(b.newContext());
      assert.equal(context.closed, true);
    }
    assert.equal(browser.closed, true);
  });
}
