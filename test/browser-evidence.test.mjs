import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserEvidence, createFixtureEvidence } from '../scripts/browser-evidence.mjs';

const page = (build) => ({
  async goto() {},
  locator: () => ({
    async getAttribute() {
      return build;
    },
  }),
});

test('browser evidence refuses a stale or missing served build and accepts the matching build', async () => {
  const evidence = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ workingTreeDigest: 'current' }),
  });
  await assert.rejects(evidence.goto(page('app-stale'), 'http://fixture/'), /served build/);
  await assert.rejects(evidence.goto(page(null), 'http://fixture/'), /served build/);
  assert.equal(await evidence.goto(page('app-current'), 'http://fixture/'), 'app-current');
  assert.doesNotThrow(() => evidence.assertUnchanged());
});

test('verification cannot finish after app or verifier source changes', async () => {
  let build = 'app-current';
  const source = { workingTreeDigest: 'original' };
  const evidence = createBrowserEvidence({ readBuild: () => build, readSource: () => source });
  await evidence.goto(page(build), 'http://fixture/');
  build = 'app-edited';
  assert.throws(() => evidence.assertUnchanged(), /app source changed/);
  build = 'app-current';
  source.workingTreeDigest = 'edited-test';
  assert.throws(() => evidence.assertUnchanged(), /verification source changed/);
});

test('receipt fixture records the actual input bytes and refuses changed fixture input', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'browser-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'capture.mjs');
  writeFileSync(path, 'first');
  const evidence = createFixtureEvidence({
    name: 'feedback-receipts',
    build: 'receipt-test',
    files: [path],
  });
  assert.equal(await evidence.goto(page('receipt-test'), 'http://fixture/'), 'receipt-test');
  assert.equal(evidence.identity.source.fixture, 'feedback-receipts');
  assert.match(evidence.identity.source.files[0].sha256, /^[a-f0-9]{64}$/);
  writeFileSync(path, 'changed');
  assert.throws(() => evidence.assertUnchanged(), /verification source changed/);
});
import { EventEmitter } from 'node:events';
function fakeBrowser() {
  const page = new EventEmitter();
  Object.assign(page, {
    locator: () => ({ getAttribute: async () => 'app-current' }),
    goto: async () => {},
    evaluate: async (fn) =>
      fn?.name === 'readLiveStatus'
        ? ['Powered Motor → Right support wheel · Right: the base extends beyond this surface.']
        : {
            frame: { tick: 2, physics: [], metadata: {} },
            interaction: { kind: 'idle' },
            cursor: { tick: 2 },
          },
    screenshot: async () => Buffer.from('image'),
    url: () => 'http://fixture/',
    isClosed: () => false,
  });
  const context = {
    newPage: async () => page,
    close: async () => {
      context.closed = true;
    },
  };
  const browser = {
    newContext: async () => context,
    version: () => 'browser-test',
    close: async () => {
      browser.closed = true;
    },
  };
  return { browser, page, context };
}
test('shared browser lifecycle captures request/page failures and closes owned context on failure', async () => {
  const f = fakeBrowser(),
    records = [];
  const evidence = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => f.browser,
    writeArtifact: (name, value) => records.push({ name, value }),
  });
  assert.equal(typeof evidence.launch, 'function');
  const browser = await evidence.launch({ profile: 'ui' }),
    p = await browser.newPage();
  await evidence.goto(p, 'http://fixture/');
  p.emit('pageerror', new Error('injected page failure'));
  p.emit('requestfailed', {
    url: () => 'http://fixture/missing.js',
    failure: () => ({ errorText: 'injected request failure' }),
  });
  await assert.rejects(browser.close(), /browser errors/);
  assert.ok(f.context.closed && f.browser.closed);
  const report = records.find((r) => r.name === 'failure.json').value;
  assert.equal(report.errors.length, 2);
  assert.equal(report.profile, 'ui');
  assert.ok(report.pages[0].state.cursor);
  assert.ok(records.some((r) => r.name.endsWith('.png')));
  // The app's own announcement travels with the failure, in the artifact and a sidecar.
  assert.deepEqual(report.pages[0].state.status, [
    'Powered Motor → Right support wheel · Right: the base extends beyond this surface.',
  ]);
  assert.deepEqual(records.find((r) => r.name === 'failure-status.json').value, [
    'Powered Motor → Right support wheel · Right: the base extends beyond this surface.',
  ]);
});
test('readLiveStatus keeps visible, unique, polite announcements only, whitespace collapsed and bounded', async () => {
  const { readLiveStatus } = await import('../scripts/browser-session.mjs');
  const el = (text, visible = true) => ({ textContent: text, checkVisibility: () => visible });
  const nodes = [
    el('  '),
    el('hidden text', false),
    el('Machine · 12'),
    el('Machine · 12'),
    el('Not placed\n  ·   Powered Motor'),
    el('x'.repeat(300)),
    el('y'.repeat(3000)),
    ...Array.from({ length: 12 }, (_, i) => el(String(i).repeat(240))),
  ];
  const saved = globalThis.document;
  globalThis.document = {
    querySelectorAll: (selector) => {
      assert.equal(selector, '[role="status"],[aria-live="polite"],[aria-live="assertive"]');
      return nodes;
    },
  };
  try {
    const status = readLiveStatus();
    assert.deepEqual(status.slice(0, 3), [
      'Machine · 12',
      'Not placed · Powered Motor',
      'x'.repeat(240),
    ]);
    assert.ok(status.join('|').length <= 2048 + 240);
    assert.ok(status.length < nodes.length - 2, 'the byte cap stops before every node is copied');
  } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
});
test('browser profiles reject fake focus mode and cleanup context setup failure', async () => {
  const f = fakeBrowser();
  const evidence = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => f.browser,
    writeArtifact: () => {},
  });
  await assert.rejects(evidence.launch({ profile: 'focus', headless: true }), /focus/);
  f.browser.newContext = async () => {
    throw Error('context setup failure');
  };
  const b = await evidence.launch({ profile: 'recording' });
  await assert.rejects(b.newPage(), /context setup failure/);
  assert.ok(f.browser.closed);
});
test('assertion evidence retains exact actual/expected values and matching build is a positive control', async () => {
  const f = fakeBrowser(),
    records = [];
  const e = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => f.browser,
    writeArtifact: (name, value) => records.push({ name, value }),
  });
  const b = await e.launch({ profile: 'performance' }),
    p = await b.newPage();
  await e.goto(p, 'http://fixture/');
  assert.throws(() =>
    e.assert('deepEqual', [{ tick: 2 }, { tick: 3 }], {
      action: 'observe tick',
      expected: 'next completed frame',
    }),
  );
  await e.captureFailure(Error('wrong tick'));
  await b.close();
  const r = records.find((r) => r.name === 'failure.json').value;
  assert.deepEqual(r.assertions[0].actual, { tick: 2 });
  assert.deepEqual(r.assertions[0].expected, { tick: 3 });
});
test('driver action and exact observed frame accompany an assertion; new-page failure closes ownership', async () => {
  const f = fakeBrowser(),
    records = [];
  f.page.mouse = { click: async () => {} };
  const e = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => f.browser,
    writeArtifact: (name, value) => records.push({ name, value }),
  });
  const b = await e.launch(),
    p = await b.newPage();
  await p.mouse.click(4, 5);
  await p.evaluate(() => null);
  e.assert('equal', [2, 2], { expectation: 'completed cursor' });
  await e.captureFailure(Error('negative control'));
  await b.close();
  const report = records.find((r) => r.name === 'failure.json').value;
  assert.equal(report.assertions[0].action.method, 'mouse.click');
  assert.deepEqual(report.assertions[0].action.args, [4, 5]);
  assert.equal(report.assertions[0].lastObservedFrame.tick, 2);
  const g = fakeBrowser();
  g.context.newPage = async () => {
    throw Error('page setup failure');
  };
  const e2 = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => g.browser,
    writeArtifact: () => {},
  });
  const b2 = await e2.launch();
  await assert.rejects(b2.newPage(), /page setup failure/);
  assert.ok(g.context.closed && g.browser.closed);
});
test('context close failure is reported while browser still closes', async () => {
  const f = fakeBrowser();
  f.context.close = async () => {
    throw Error('close failed');
  };
  const e = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => f.browser,
    writeArtifact: () => {},
  });
  const b = await e.launch();
  await b.newPage();
  await assert.rejects(b.close(), /close failed/);
  assert.ok(f.browser.closed);
});
test('failure artifact writer cannot prevent owned context and browser cleanup', async () => {
  const f = fakeBrowser();
  let failWrites = false;
  const e = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => f.browser,
    writeArtifact: () => {
      if (failWrites) throw Error('artifact writer failure');
    },
  });
  const b = await e.launch();
  await b.newPage();
  failWrites = true;
  f.page.emit('pageerror', Error('page failed'));
  await assert.rejects(b.close());
  assert.ok(
    f.context.closed && f.browser.closed,
    'evidence write failure must not prevent cleanup',
  );
});
test('asserted frames bind explicit context or full arguments, never an unrelated last observation', async () => {
  const f = fakeBrowser(),
    records = [],
    actual = { tick: 3, metadata: {}, physics: [] },
    explicit = { tick: 4, metadata: {}, physics: [] };
  const e = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => f.browser,
    writeArtifact: (name, value) => records.push({ name, value }),
  });
  const b = await e.launch(),
    p = await b.newPage();
  await p.evaluate(() => null);
  e.assert('deepEqual', [actual, actual]);
  e.assert('equal', [1, 1]);
  assert.throws(() => e.assert('equal', [1, 2], { frame: explicit }));
  await e.captureFailure(Error('controlled failure'));
  await b.close();
  const report = records.find((r) => r.name === 'failure.json').value;
  assert.deepEqual(
    report.assertions.map((row) => row.assertedFrame?.tick ?? null),
    [3, null, 4],
  );
  assert.deepEqual(
    report.assertions.map((row) => row.assertedFrameSource),
    ['actual', null, 'explicit'],
  );
  assert.equal(report.lastObservedFrame.tick, 2);
});
test('assertion evidence records the live caller and message while preserving custom descriptions', async () => {
  const f = fakeBrowser(),
    records = [];
  const e = createBrowserEvidence({
    readBuild: () => 'app-current',
    readSource: () => ({ digest: 'source' }),
    launchBrowser: async () => f.browser,
    writeArtifact: (name, value) => records.push({ name, value }),
  });
  const b = await e.launch();
  await b.newPage();
  function liveAssertion() {
    e.assert('equal', [1, 1, 'reached expected state']);
  }
  liveAssertion();
  assert.throws(() =>
    e.assert('equal', [1, 2, 'wrong state'], { expectation: 'custom transition' }),
  );
  assert.throws(() => e.assert('equal', [4, 5]));
  await e.captureFailure(Error('controlled evidence capture'));
  await b.close();
  const rows = records.find((row) => row.name === 'failure.json').value.assertions;
  assert.match(rows[0].location, /liveAssertion.*browser-evidence\.test\.mjs:\d+:\d+/);
  assert.doesNotMatch(rows[0].location, /browser-session/);
  assert.equal(rows[0].expectation, 'reached expected state');
  assert.equal(rows[1].expectation, 'custom transition');
  assert.match(rows[1].failureMessage, /wrong state/);
  assert.match(rows[2].failureMessage, /4 !== 5/);
  assert.deepEqual([rows[1].actual, rows[1].expected], [1, 2]);
});

test('part clicks derive from current canvas projection and reject missing or off-screen centers', async () => {
  const evidence = createBrowserEvidence({ readBuild: () => 'app', readSource: () => ({}) });
  const clicks = [];
  let center = { id: 7, x: 0.5, y: -0.5 };
  const p = {
    evaluate: async () => center,
    locator: () => ({
      first: () => ({ boundingBox: async () => ({ x: 100, y: 50, width: 800, height: 400 }) }),
    }),
    mouse: { click: async (x, y) => clicks.push([x, y]) },
  };
  await evidence.clickPart(p, 7);
  assert.deepEqual(clicks, [[700, 350]]);
  for (center of [null, { x: 2, y: 0 }, { x: NaN, y: 0 }])
    await assert.rejects(evidence.clickPart(p, 7), /visible projected center/);
  assert.equal(clicks.length, 1);
});

test('parallel admission checks resolved launch options, including variable profiles', async (t) => {
  const previous = process.env.SIMULACRUM_BROWSER_EXECUTION;
  process.env.SIMULACRUM_BROWSER_EXECUTION = 'parallel';
  t.after(() => {
    if (previous === undefined) delete process.env.SIMULACRUM_BROWSER_EXECUTION;
    else process.env.SIMULACRUM_BROWSER_EXECUTION = previous;
  });
  let launches = 0;
  const make = () =>
    createBrowserEvidence({
      readBuild: () => 'app-test',
      readSource: () => ({}),
      launchBrowser: async () => {
        launches++;
        return fakeBrowser().browser;
      },
      writeArtifact: () => {},
    });
  for (const profile of ['recording', 'performance', 'focus'])
    await assert.rejects(make().launch({ profile }), /exclusive/);
  await assert.rejects(make().launch({ headless: false }), /exclusive/);
  assert.equal(launches, 0);
  await (await make().launch({ profile: 'ui' })).close();
  assert.equal(launches, 1);
});

test('load helper waits for a fresh matching receipt, including repeated rejected input', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'load-helper-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'save.json'),
    save = { parts: [] };
  writeFileSync(file, JSON.stringify(save));
  const evidence = createBrowserEvidence({ readBuild: () => 'x', readSource: () => ({}) });
  let receipt = { sequence: 4, input: { type: 'load', save }, result: { ok: false } };
  const calls = [];
  let blueprint = { parts: [], environment: 'rounded-bump' };
  const fake = {
    evaluate: async (callback) => {
      globalThis.window = {
        workshopProbe: { readLastCommandResult: () => receipt },
        render_game_to_text: () => JSON.stringify({ metadata: { blueprint } }),
      };
      try {
        return structuredClone(callback());
      } finally {
        delete globalThis.window;
      }
    },
    locator: (selector) => {
      assert.equal(selector, 'input[type=file]');
      return {
        first: () => ({
          setInputFiles: async (path) => {
            assert.equal(path, file);
            calls.push('upload');
          },
        }),
      };
    },
    getByRole: (role, options) => {
      assert.equal(role, 'button');
      assert.deepEqual(options, { name: 'Replace without saving', exact: true });
      return { click: async () => calls.push('confirm') };
    },
    waitForFunction: async (predicate, args) => {
      globalThis.window = { workshopProbe: { readLastCommandResult: () => receipt } };
      try {
        if (args === undefined) {
          assert.equal(predicate(), true);
          return { dispose: async () => {} };
        }
        assert.equal(predicate(args), false, 'stale identical rejection cannot complete a load');
        receipt = { ...receipt, sequence: 5, input: { type: 'load', save: { parts: [1] } } };
        assert.equal(predicate(args), false, 'another input cannot complete this load');
        receipt = { ...receipt, input: { type: 'load', save } };
        assert.deepEqual(predicate(args), receipt);
        return { jsonValue: async () => structuredClone(receipt), dispose: async () => {} };
      } finally {
        delete globalThis.window;
      }
    },
  };
  assert.equal((await evidence.loadAndWait(fake, file, { ok: false })).sequence, 5);
  assert.deepEqual(calls, ['upload', 'confirm'], 'scene-only authored work needs confirmation');
  blueprint = { parts: [], environment: 'flat' };
  receipt = { ...receipt, sequence: 4 };
  assert.equal((await evidence.loadAndWait(fake, file, { ok: false })).sequence, 5);
  assert.deepEqual(calls, ['upload', 'confirm', 'upload'], 'empty flat work needs no confirmation');
});

test('rejected edit helper catches mutation; real pointer drag scrolls and releases even on failure', async () => {
  const evidence = createBrowserEvidence({ readBuild: () => 'x', readSource: () => ({}) });
  let state = { x: 1 };
  const snapshot = async () => structuredClone(state);
  await evidence.assertRejectedEdit({ snapshot, action: async () => ({ result: { ok: false } }) });
  await assert.rejects(
    evidence.assertRejectedEdit({
      snapshot,
      action: async () => {
        state.x++;
        return { result: { ok: false } };
      },
    }),
    /rejected edit changed/,
  );
  await assert.rejects(
    evidence.assertRejectedEdit({ snapshot, action: async () => ({ result: { ok: true } }) }),
    /expected a rejected/,
  );
  const calls = [],
    source = {
      scrollIntoViewIfNeeded: async () => calls.push('scroll'),
      boundingBox: async () => {
        assert.equal(calls[0], 'scroll');
        return { x: 0, y: 0, width: 20, height: 20 };
      },
    };
  let fail = false;
  const fake = {
    mouse: {
      move: async (x) => {
        calls.push('move');
        if (fail && x === 50) throw Error('interrupted');
      },
      down: async () => calls.push('down'),
      up: async () => calls.push('up'),
    },
  };
  await evidence.dragFrom(fake, source, async () => ({ x: 50, y: 50 }));
  assert.deepEqual(calls, ['scroll', 'move', 'down', 'move', 'up']);
  calls.length = 0;
  fail = true;
  await assert.rejects(
    evidence.dragFrom(fake, source, async () => ({ x: 50, y: 50 })),
    /interrupted/,
  );
  assert.equal(calls.at(-1), 'up');
});

test('browser artifacts preserve standalone paths and isolate repeated checks under their run roots', async (t) => {
  const { browserArtifactPath } = await import('../scripts/browser-artifacts.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'browser-artifact-roots-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const previous = process.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT;
    else process.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT = previous;
  });
  delete process.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT;
  assert.equal(browserArtifactPath('artifacts/check/result.json'), 'artifacts/check/result.json');
  assert.equal(browserArtifactPath('artifacts/check', '/custom/output'), '/custom/output');
  for (const run of ['first', 'second']) {
    process.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT = join(dir, run);
    assert.equal(browserArtifactPath('artifacts/check', '/custom/output'), join(dir, run, 'check'));
    const evidence = createBrowserEvidence({
      name: 'same-check',
      readBuild: () => run,
      readSource: () => ({ run }),
    });
    await evidence.captureFailure(new Error(run));
  }
  const first = join(dir, 'first/browser-evidence/same-check/failure.json');
  const second = join(dir, 'second/browser-evidence/same-check/failure.json');
  assert.equal(JSON.parse(readFileSync(first)).build, 'first');
  assert.equal(JSON.parse(readFileSync(second)).build, 'second');
  assert.equal(existsSync(join(dir, 'check')), false);
  assert.throws(() => browserArtifactPath('artifacts/../../escape'), /artifact path/);
  assert.throws(() => browserArtifactPath('/outside'), /artifact path/);
  symlinkSync(dir, join(dir, 'second', 'escape'));
  assert.throws(() => browserArtifactPath('artifacts/escape/result.json'), /symlink/);
  process.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT = 'relative/root';
  assert.throws(() => browserArtifactPath('artifacts/check'), /absolute/);
});

test('load helper waits for the command probe before reading or submitting a save', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'load-readiness-'));
  const previousWindow = globalThis.window;
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    rmSync(dir, { recursive: true, force: true });
  });
  const file = join(dir, 'save.json'),
    save = { parts: [] };
  writeFileSync(file, JSON.stringify(save));
  const evidence = createBrowserEvidence({ readBuild: () => 'x', readSource: () => ({}) });
  let receipt = { sequence: 7, input: { type: 'load', save }, result: { ok: false } };
  let disposed = 0,
    submitted = false;
  globalThis.window = {};
  const fake = {
    evaluate: async (read) => read(),
    locator: () => ({
      first: () => ({
        setInputFiles: async (path) => {
          assert.equal(path, file);
          assert.equal(disposed, 1, 'readiness handle is released before submitting the save');
          submitted = true;
        },
      }),
    }),
    waitForFunction: async (predicate, args, options) => {
      assert.equal(options, undefined, 'inherit the existing page deadline');
      if (args === undefined) {
        assert.equal(predicate(), false, 'missing probe is not ready');
        globalThis.window = { workshopProbe: {} };
        assert.equal(predicate(), false, 'partial probe is not ready');
        globalThis.window.workshopProbe.readLastCommandResult = true;
        assert.equal(predicate(), false, 'only a callable command probe is ready');
        globalThis.window.workshopProbe.readLastCommandResult = () => receipt;
        globalThis.window.render_game_to_text = () =>
          JSON.stringify({ metadata: { blueprint: { parts: [], environment: 'flat' } } });
        assert.equal(predicate(), true);
        assert.equal(submitted, false);
        return {
          dispose: async () => {
            disposed++;
          },
        };
      }
      assert.equal(submitted, true);
      assert.equal(args.sequence, 7);
      assert.equal(predicate(args), false, 'an old rejected load cannot complete the new load');
      receipt = {
        sequence: 8,
        input: { type: 'load', save: { parts: [1] } },
        result: { ok: true },
      };
      assert.equal(predicate(args), false, 'another save cannot complete the new load');
      receipt.input.save = save;
      assert.deepEqual(predicate(args), receipt);
      return {
        jsonValue: async () => structuredClone(receipt),
        dispose: async () => {
          disposed++;
        },
      };
    },
  };
  assert.equal((await evidence.loadAndWait(fake, file)).sequence, 8);
  assert.equal(disposed, 2);
});

test('load helper propagates startup timeout without reading or submitting a save', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'load-readiness-timeout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'save.json');
  writeFileSync(file, JSON.stringify({ parts: [] }));
  const evidence = createBrowserEvidence({ readBuild: () => 'x', readSource: () => ({}) });
  const timeout = Error('command probe readiness deadline exceeded');
  const fake = {
    waitForFunction: async () => {
      throw timeout;
    },
    evaluate: async () => assert.fail('cannot read before startup readiness'),
    locator: () => assert.fail('cannot submit before startup readiness'),
  };
  await assert.rejects(evidence.loadAndWait(fake, file), (error) => error === timeout);
});
