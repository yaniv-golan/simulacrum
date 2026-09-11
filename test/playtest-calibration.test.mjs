import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as calibration from '../scripts/playtest/calibrate.mjs';
const capture = (bytes = () => 0) => ({
  captureSeconds: 1800,
  finalOutbox: { bytes: 0, pending: 0 },
  outboxSamples: Array.from({ length: 600 }, (_, i) => ({ at: (i + 1) * 3000, bytes: bytes(i) })),
});
test('comparison retains failing long and short windows without granting profile approval', () => {
  const jittered = {
    ...capture(),
    outboxSamples: Array.from({ length: 598 }, (_, i) => ({ at: 3000 + i * 3011, bytes: 0 })),
  };
  assert.equal(calibration.compareCaptureWindows(jittered)[2].growth, 'not detected');
  const bounded = calibration.compareCaptureWindows(capture());
  assert.deepEqual(
    bounded.map((x) => x.growth),
    ['not detected', 'not detected', 'not detected'],
  );
  assert.deepEqual(
    bounded.map((x) => x.independentDrain),
    [false, false, true],
  );
  const late = calibration.compareCaptureWindows(
    capture((i) => (i < 220 ? 0 : (i - 220) * 100000)),
  );
  assert.equal(late[0].growth, 'not detected');
  assert.equal(late[1].growth, 'not detected');
  assert.match(late[2].growth, /growth/);
  const fast = calibration.compareCaptureWindows(capture((i) => i * 100000));
  assert.ok(fast.every((x) => /growth/.test(x.growth)));
  assert.throws(
    () => calibration.compareCaptureWindows({ ...capture(), outboxSamples: [] }),
    /samples/,
  );
});
test('calibration ownership excludes concurrent publisher and retains owner after uncertain work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'calibration-owner-'));
  const config = {
    environment: 'staging',
    artifact: 'a'.repeat(64),
    expectedPredecessor: 'version-one',
    coordinator: 'https://coordinator.test',
  };
  const calls = [];
  let busy = true;
  let ran = 0;
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === '/current') return Response.json({ version: 'version-one' });
    const body = JSON.parse(options.body);
    assert.ok(body.token.length >= 32);
    assert.equal(body.artifact, config.artifact);
    if (path === '/acquire' && busy) return new Response('', { status: 409 });
    return Response.json({ owned: true });
  };
  try {
    await assert.rejects(
      calibration.withCalibrationOwner(config, directory, async () => ran++, {
        request,
        token: 't'.repeat(32),
      }),
      /409/,
    );
    assert.equal(ran, 0);
    assert.ok(!calls.includes('/release'));
    busy = false;
    calls.length = 0;
    await assert.rejects(
      calibration.withCalibrationOwner(
        config,
        directory,
        async () => {
          throw Error('cleanup failed');
        },
        { request, token: 't'.repeat(32) },
      ),
      /cleanup failed/,
    );
    assert.ok(!calls.includes('/release'));
    assert.ok(
      JSON.parse(await readFile(join(directory, (await readdir(directory))[0]), 'utf8')).token,
    );
    await assert.rejects(
      calibration.withCalibrationOwner(
        { ...config, environment: 'production' },
        directory,
        async () => ran++,
        { request, token: 't'.repeat(32) },
      ),
      /staging/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('successful characterization releases ownership without changing deployed version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'calibration-success-'));
  const calls = [];
  try {
    const result = await calibration.withCalibrationOwner(
      {
        environment: 'staging',
        artifact: 'b'.repeat(64),
        expectedPredecessor: 'v1',
        coordinator: 'https://coordinator.test',
      },
      directory,
      async (check) => {
        await check();
        return 42;
      },
      {
        token: 't'.repeat(32),
        request: async (url, options) => {
          calls.push([new URL(url).pathname, JSON.parse(options.body)]);
          return Response.json(
            new URL(url).pathname === '/current' ? { version: 'v1' } : { owned: true },
          );
        },
      },
    );
    assert.equal(result, 42);
    assert.equal(calls.at(-1)[0], '/release');
    assert.equal(calls[0][0], '/current');
    assert.ok(!calls.some(([, body]) => body.phase === 'complete'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('characterization controls distinguish imbalance, bursts, late growth and undrained queues', () => {
  const result = calibration.characterizationControls();
  assert.equal(result.fastDetected, true);
  assert.equal(result.slowDetected, true);
  assert.equal(result.burstAccepted, true);
  assert.equal(result.undrainedRejected, true);
  assert.equal(result.lateOnlyLongDetected, true);
  assert.match(result.limitation, /resource/);
});

test('calibration measurement failure is persisted before owner can release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'calibration-failure-'));
  const directory = join(root, 'calibration');
  await mkdir(directory);
  const calls = [];
  let lostAck = false;
  const config = {
    environment: 'staging',
    artifact: 'a'.repeat(64),
    expectedPredecessor: 'v',
    coordinator: 'https://coordinator.test',
  };
  const options = {
    token: 't'.repeat(32),
    request: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, body: JSON.parse(init.body) });
      if (path === '/experiment-failed') {
        const history = JSON.parse(
          await readFile(join(root, 'experiment-history-staging.json'), 'utf8'),
        );
        assert.equal(history.at(-1).id, calls.at(-1).body.failure.id);
        if (lostAck) return new Response('unavailable', { status: 503 });
      }
      return Response.json(path === '/current' ? { version: 'v' } : { owned: true });
    },
  };
  try {
    await assert.rejects(
      calibration.withCalibrationOwner(
        config,
        directory,
        async (check) => {
          await check.measure('endurance', 'long', async () => {
            throw Error('sustained growth');
          });
        },
        options,
      ),
      /sustained growth/,
    );
    assert.equal(calls.filter((c) => c.path === '/experiment-failed').length, 1);
    assert.ok(!calls.some((c) => c.path === '/release'));
    const failure = calls.find((c) => c.path === '/experiment-failed').body.failure;
    assert.equal(failure.family, 'endurance');
    assert.equal(failure.artifact, config.artifact);
    const saved = JSON.parse(
      await readFile(join(directory, `experiment-failure-${failure.id}.json`), 'utf8'),
    );
    assert.deepEqual(saved.failure, failure);
    assert.equal(
      JSON.parse(await readFile(join(root, 'experiment-history-staging.json'), 'utf8'))[0].id,
      failure.id,
    );
    lostAck = true;
    calls.length = 0;
    await assert.rejects(
      calibration.withCalibrationOwner(
        config,
        directory,
        async (check) => {
          await check.measure('capacity', 'capacity', async () => {
            throw Error('load failure');
          });
        },
        options,
      ),
      /persistence uncertain/,
    );
    assert.ok(!calls.some((c) => c.path === '/release'));
    const history = JSON.parse(
      await readFile(join(root, 'experiment-history-staging.json'), 'utf8'),
    );
    assert.equal(history.length, 2);
    assert.equal(history[1].family, 'capacity');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
