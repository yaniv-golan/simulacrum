import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { createServer } from 'vite';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBallDrop } from '../src/model/fixtures/ball-drop.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/mechanical-audio');
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await evidence.launch({ profile: 'ui' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await evidence.goto(page, `http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => !!window.workshopProbe);
  const deniedPage = await browser.newPage();
  await deniedPage.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  const deniedProtocol = await deniedPage.context().newCDPSession(deniedPage);
  // Playwright evaluate grants a gesture; this negative control must explicitly omit one.
  const denyWithoutGesture = async () => {
    const { createMechanicalAudio } = await import('/src/presentation/mechanical-audio.mjs');
    const engine = createMechanicalAudio();
    window.audioPolicyProbe = engine;
    const enabled = await engine.enable(true);
    const button = document.createElement('button');
    button.textContent = 'Resume test sound';
    button.onclick = () => engine.enable(true);
    document.body.prepend(button);
    return { enabled, ...engine.read(), activated: navigator.userActivation.hasBeenActive };
  };
  const deniedResult = await deniedProtocol.send('Runtime.evaluate', {
    expression: `(${denyWithoutGesture.toString()})()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  assert.equal(deniedResult.exceptionDetails, undefined);
  const denial = deniedResult.result.value;
  assert.equal(denial.activated, false, 'denial page has never received a gesture');
  await evidence.assertServed(deniedPage);
  assert.equal(
    denial.enabled,
    false,
    'a fresh browser without a gesture cannot claim enabled audio',
  );
  await deniedPage.getByRole('button', { name: 'Resume test sound', exact: true }).click();
  await deniedPage.waitForFunction(() => window.audioPolicyProbe.enabled());
  await deniedPage.evaluate(() => window.audioPolicyProbe.dispose());
  await deniedProtocol.detach();
  await deniedPage.close();
  const waveforms = await page.evaluate(async () => {
    const { createMechanicalAudio } = await import('/src/presentation/mechanical-audio.mjs');
    const { driveVoice, contactVoice, AUDIO_POLICY } = await import(
      '/src/presentation/mechanical-audio-model.mjs'
    );
    // Spectral centroid of a slice (Hz): a radix-2 FFT over its first 4096 samples.
    const centroid = (slice, rate) => {
      const n = 4096,
        re = Float64Array.from(slice.subarray(0, n)),
        im = new Float64Array(n);
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) [re[i], re[j], im[i], im[j]] = [re[j], re[i], im[j], im[i]];
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        for (let i = 0; i < n; i += len)
          for (let k = 0; k < len / 2; k++) {
            const wr = Math.cos(ang * k),
              wi = Math.sin(ang * k),
              a = i + k,
              b = a + len / 2,
              tr = re[b] * wr - im[b] * wi,
              ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
      }
      let weighted = 0,
        total = 0;
      for (let k = 1; k < n / 2; k++) {
        const power = re[k] * re[k] + im[k] * im[k];
        weighted += ((k * rate) / n) * power;
        total += power;
      }
      return total > 0 ? weighted / total : 0;
    };
    const drive = (speed, current = 0, coordinate = 'rotation') =>
      driveVoice({
        emitterKey: '0',
        position: [0, 0, 0],
        coordinate,
        ...(coordinate === 'rotation'
          ? { speedRadS: speed, torqueNm: current }
          : { speedMS: speed, forceN: current }),
        currentA: current,
        currentScaleA: 2,
      });
    const contact = (slip, roll, friction = 'positive') =>
      contactVoice({
        pairKey: '0:1',
        position: [0, 0, 0],
        valid: true,
        normalImpulseNs: 1,
        normalLoadN: 120,
        slipSpeedMS: slip,
        rollingSpeedMS: roll,
        geometryClass: 'curved',
        frictionEligibility: friction,
      });
    const results = { policy: { nominalRms: AUDIO_POLICY.nominalRms } };
    for (const [name, d, c, impact, mute] of [
      // A 0.1 sine pushed into the master bus measures the output chain (compressor, ceiling)
      // and the meter itself; the level bands below are read against it, not against a
      // hand-copied chain gain.
      ['calibration', null, null, false, false],
      ['idle', drive(0), null, false, false],
      // The driving example's motors: ~10 rad/s, half the nominal rate, ~150 Hz.
      ['slow', drive(10), null, false, false],
      ['coast', drive(100), null, false, false],
      ['retarget', drive(100), null, false, false],
      ['fast', drive(200), null, false, false],
      ['reverse', drive(-100), null, false, false],
      ['stall', drive(0, 2), null, false, false],
      ['missing', drive(null), null, false, false],
      ['linear', drive(0.2, 0, 'linear'), null, false, false],
      ['scrape', null, contact(1, 0), false, false],
      ['frictionless', null, contact(1, 0, 'zero'), false, false],
      ['unknown', null, contact(1, 0, 'unknown'), false, false],
      ['roll', null, contact(0, 1), false, false],
      ['rest', null, contact(0, 0), false, false],
      ['impact', null, null, true, false],
      ['mixed', drive(200, 2), contact(1, 1), true, false],
      // Plausible-wrong trace for the level band: the nominal drive at a tenth of the volume.
      ['attenuated', drive(200), null, false, false],
      ['mute', drive(100), contact(1, 1), true, true],
    ]) {
      const raw = new OfflineAudioContext(2, 24000, 48000);
      let master = null;
      const context = new Proxy(raw, {
        get(target, key) {
          if (key === 'resume') return async () => {};
          if (key === 'state') return 'running';
          const value = Reflect.get(target, key, target);
          if (key === 'createGain')
            return (...args) => {
              const node = value.apply(target, args);
              master ??= node; // graph() creates the master bus before any voice
              return node;
            };
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const engine = createMechanicalAudio({ createContext: () => context });
      await engine.enable(true);
      engine.setVolume(mute ? 0 : name === 'attenuated' ? 0.1 : 1);
      if (name === 'calibration') {
        engine.play({ tick: 10, interval: 1 / 120, drives: [], contacts: [], impacts: [] });
        const osc = raw.createOscillator(),
          gain = raw.createGain();
        osc.frequency.value = 440;
        gain.gain.value = 0.1;
        osc.connect(gain);
        gain.connect(master);
        osc.start(0);
        osc.stop(0.25);
      }
      const batch = {
        tick: 10,
        interval: 1 / 120,
        drives:
          name === 'retarget'
            ? Array.from({ length: 8 }, (_, i) => ({
                ...d,
                emitterKey: String(i),
                key: `drive:${i}`,
              }))
            : d
              ? [d]
              : [],
        contacts: c ? [c] : [],
        impacts: impact
          ? [{ tick: 10, impulse: 10, position: [0, 0, 0], materials: ['steel', 'rubber'] }]
          : [],
      };
      engine.play(batch);
      const middle = name === 'retarget' ? raw.suspend(0.1) : null;
      const paused = raw.suspend(0.25);
      const rendered = raw.startRendering();
      if (middle) {
        await middle;
        engine.play({
          ...batch,
          drives: Array.from({ length: 8 }, (_, i) => ({
            ...drive(0.2, 0, 'linear'),
            emitterKey: `new-${i}`,
            key: `drive:new-${i}`,
          })),
        });
        await raw.resume();
      }
      await paused;
      engine.stop();
      await raw.resume();
      const buffer = await rendered;
      const samples = buffer.getChannelData(0),
        slice = samples.slice(2400, 9600),
        tail = samples.slice(16800);
      const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
      let crossings = 0;
      for (let i = 1; i < slice.length; i++) if (slice[i] >= 0 && slice[i - 1] < 0) crossings++;
      results[name] = {
        level: d?.level ?? c?.level ?? null,
        rms: rms(slice),
        retargetRms: rms(samples.slice(7680, 9600)),
        tailRms: rms(tail),
        peak: Math.max(...samples.map(Math.abs)),
        finite: [...samples].every(Number.isFinite),
        frequency: crossings / (slice.length / 48000),
        centroid: centroid(slice, 48000),
        voices: engine.read(),
      };
    }
    return results;
  });
  for (const name of [
    'slow',
    'coast',
    'fast',
    'reverse',
    'stall',
    'linear',
    'scrape',
    'roll',
    'impact',
    'mixed',
  ])
    assert.ok(waveforms[name].rms > 1e-5, `${name}: real output must be nonzero`);
  // Audibility: one nominal voice lands at the registered level at the destination. The
  // chain gain comes from the calibration render (a 0.1 sine into the master bus), so the
  // bands track the compressor/ceiling as built, not a copied constant. Weights are the
  // model's level weights; the band is −8/+4 dB around the expectation.
  const { policy, calibration } = waveforms,
    chainGain = calibration.rms / (0.1 / Math.SQRT2),
    dB = (v) => 20 * Math.log10(v);
  assert.ok(
    Number.isFinite(policy.nominalRms) && policy.nominalRms > 0,
    'the model registers a nominal level',
  );
  assert.ok(
    chainGain > 1.5 && chainGain < 2.2,
    `output chain gain ${chainGain.toFixed(2)} (waveshaper 0.9·tanh(2x) ≈ 1.8, compressor idle)`,
  );
  // Each row carries its rendered level in nominal units (the model's weights); the band is
  // read from that, never from a copied list.
  const level = (weight) => dB(policy.nominalRms * weight * chainGain);
  for (const name of ['slow', 'coast', 'fast', 'reverse', 'linear', 'stall', 'scrape', 'roll']) {
    assert.ok(
      Number.isFinite(waveforms[name].level) && waveforms[name].level > 0,
      `${name}: the voice row carries a rendered level`,
    );
    const measured = dB(waveforms[name].rms),
      expected = level(waveforms[name].level);
    assert.ok(
      measured >= expected - 8 && measured <= expected + 4,
      `${name}: ${measured.toFixed(1)} dBFS is not within −8/+4 dB of ${expected.toFixed(1)} dBFS at the registered level`,
    );
  }
  assert.ok(
    dB(waveforms.attenuated.rms) < level(1) - 8,
    'the level band rejects a nominal voice rendered 20 dB down',
  );
  // Impacts are held at four times the original gain until the rolling episode classifier is
  // judged; a single impact's windowed RMS sits about 12 dB under a continuous nominal voice.
  assert.ok(
    dB(waveforms.impact.rms) >= level(0.25) - 8,
    `impact: ${dB(waveforms.impact.rms).toFixed(1)} dBFS is under the held level`,
  );
  assert.ok(dB(waveforms.mixed.rms) <= -6, 'a full mix stays under −6 dBFS RMS');
  // Spectral placement: a slow motor's fundamental and a rolling texture's energy stay above
  // the region small speakers do not reproduce (the deployed 60 Hz floor put the driving
  // example at ~100 Hz through a 100–200 Hz lowpass).
  assert.ok(
    waveforms.slow.frequency >= 140,
    `slow: fundamental ${waveforms.slow.frequency.toFixed(0)} Hz sits under 140 Hz`,
  );
  assert.ok(
    waveforms.roll.centroid >= 200,
    `roll: spectral centroid ${waveforms.roll.centroid.toFixed(0)} Hz sits under 200 Hz`,
  );
  for (const name of ['idle', 'missing', 'frictionless', 'unknown', 'rest', 'mute'])
    assert.equal(waveforms[name].rms, 0, `${name}: forbidden waveform must be silent`);
  assert.ok(
    waveforms.retarget.retargetRms > 1e-5,
    'saturated slot retargets without a silent allocation gap',
  );
  assert.ok(
    waveforms.fast.frequency > waveforms.coast.frequency * 1.5,
    'measured speed raises actual waveform pitch',
  );
  assert.ok(Math.abs(waveforms.reverse.frequency - waveforms.coast.frequency) < 10);
  for (const [name, wave] of Object.entries(waveforms)) {
    if (name === 'policy') continue;
    assert.ok(wave.finite && wave.peak <= 0.95, `${name}: bounded finite waveform`);
    assert.equal(wave.tailRms, 0, `${name}: release terminates actual output`);
  }
  // Ordinary workshop journey, real user gesture and actual output graph.
  writeFileSync(`${out}/ball.json`, JSON.stringify(createBallDrop()));
  await evidence.loadAndWait(page, `${out}/ball.json`);
  await page.getByRole('button', { name: 'Sound off', exact: true }).click();
  await page.waitForFunction(() => window.workshopProbe.readAudio().enabled);
  await page.locator('[data-command=run]').click();
  await page.evaluate(() => window.advanceTime(150));
  await page.getByRole('button', { name: 'Sound volume', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Sound volume', exact: true });
  await slider.fill('0');
  assert.equal((await page.evaluate(() => window.workshopProbe.readAudio())).volume, 0);
  await slider.press('Escape');
  assert.equal(
    await page
      .getByRole('button', { name: 'Sound volume', exact: true })
      .getAttribute('aria-expanded'),
    'false',
  );
  await page.getByRole('button', { name: 'Sound volume', exact: true }).click();
  await slider.fill('35');
  await page.screenshot({ path: `${out}/volume-wide.png` });
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: `${out}/volume-narrow.png` });
  assert.equal(
    await page.locator('.sound-volume').evaluate((el) => el.matches(':popover-open')),
    true,
  );
  const controlsBox = await page.locator('.attempt-controls').boundingBox();
  assert.ok(controlsBox.height < 50, 'comfort controls stay in one compact row');
  const bounds = await slider.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 640);
  await slider.press('Escape');
  await page.locator('[data-command=pause]').click();
  await page.waitForFunction(() => {
    const a = window.workshopProbe.readAudio();
    return a.drives + a.contacts + a.impacts === 0;
  });
  await page.getByRole('button', { name: 'Sound on', exact: true }).click();
  assert.equal((await page.evaluate(() => window.workshopProbe.readAudio())).enabled, false);
  // Real context saturation, mute, release, reset pressure and current-state fallback.
  const resources = await page.evaluate(async () => {
    const { createMechanicalAudio } = await import('/src/presentation/mechanical-audio.mjs');
    const { driveVoice, contactVoice } = await import(
      '/src/presentation/mechanical-audio-model.mjs'
    );
    const context = new AudioContext(),
      connected = new Set();
    let peakConnected = 0;
    for (const factory of [
      'createGain',
      'createDynamicsCompressor',
      'createWaveShaper',
      'createStereoPanner',
      'createBufferSource',
      'createOscillator',
      'createBiquadFilter',
    ]) {
      const create = context[factory].bind(context);
      context[factory] = (...args) => {
        const node = create(...args),
          connect = node.connect.bind(node),
          disconnect = node.disconnect.bind(node);
        node.connect = (...targets) => {
          const result = connect(...targets);
          connected.add(node);
          peakConnected = Math.max(peakConnected, connected.size);
          return result;
        };
        node.disconnect = (...targets) => {
          const result = disconnect(...targets);
          if (!targets.length) connected.delete(node);
          return result;
        };
        return node;
      };
    }
    // A deliberately retained connection is observable independently of voice counters.
    const leakControl = context.createGain();
    leakControl.connect(context.destination);
    const detectedConnection = connected.size;
    leakControl.disconnect();
    const controlBaseline = connected.size,
      engine = createMechanicalAudio({ createContext: () => context });
    await engine.enable(true);
    const drives = Array.from({ length: 20 }, (_, i) =>
      driveVoice({
        coordinate: 'rotation',
        emitterKey: String(i),
        position: [0, 0, 0],
        speedRadS: 100,
        currentA: 1,
        currentScaleA: 2,
        torqueNm: 1,
      }),
    );
    const contacts = Array.from({ length: 20 }, (_, i) =>
      contactVoice({
        pairKey: String(i),
        position: [0, 0, 0],
        normalImpulseNs: 1,
        normalLoadN: 120,
        slipSpeedMS: 1,
        rollingSpeedMS: 0,
        geometryClass: 'curved',
        frictionEligibility: 'positive',
        valid: true,
      }),
    );
    const batch = {
      tick: 1,
      interval: 1 / 120,
      drives,
      contacts,
      impacts: Array.from({ length: 20 }, () => ({
        tick: 1,
        impulse: 3,
        position: [0, 0, 0],
        materials: ['steel'],
      })),
    };
    engine.play(batch);
    engine.play(batch);
    const maximum = { ...engine.read(), connectedNodes: connected.size };
    for (let i = 0; i < 100; i++) {
      engine.stop();
      await new Promise((r) => setTimeout(r, 40));
      engine.play({ ...batch, impacts: [] });
    }
    engine.stop();
    await new Promise((r) => setTimeout(r, 60));
    const baseline = { ...engine.read(), connectedNodes: connected.size };
    await context.suspend();
    await new Promise((r) => setTimeout(r, 20));
    const interrupted = engine.read();
    engine.dispose();
    return {
      maximum,
      baseline,
      interrupted,
      detectedConnection,
      controlBaseline,
      peakConnected,
      disposedNodes: connected.size,
    };
  });
  assert.equal(resources.detectedConnection, 1, 'a retained connection is detected');
  assert.equal(
    resources.controlBaseline,
    0,
    'disconnect clears the independent connection control',
  );
  assert.ok(resources.peakConnected <= 187, 'the real connected graph stays bounded at saturation');
  assert.equal(
    resources.baseline.connectedNodes,
    3,
    'only the three master nodes remain after 100 resets',
  );
  assert.equal(resources.disposedNodes, 0, 'disposal disconnects the entire graph');
  assert.equal(resources.maximum.drives, 8);
  assert.equal(resources.maximum.contacts, 4);
  assert.equal(resources.maximum.impacts, 8);
  assert.equal(
    resources.baseline.drives + resources.baseline.contacts + resources.baseline.impacts,
    0,
  );
  assert.equal(resources.interrupted.enabled, false);
  const timings = await page.evaluate(async () => {
    const { createMechanicalAudio } = await import('/src/presentation/mechanical-audio.mjs');
    const { driveVoice, contactVoice, createMechanicalEvents } = await import(
      '/src/presentation/mechanical-audio-model.mjs'
    );
    const { createMechanicalAudioAdapter } = await import(
      '/src/application/mechanical-audio-adapter.mjs'
    );
    const engine = createMechanicalAudio();
    await engine.enable(true);
    const adapter = createMechanicalAudioAdapter(),
      events = createMechanicalEvents();
    const observed = window.workshopProbe.observe(),
      frame = structuredClone(observed.frames[0]);
    const trials = [];
    for (const motorCount of [0, 1, 8])
      for (let trial = 0; trial < 3; trial++)
        for (const enabled of trial % 2 ? [true, false] : [false, true]) {
          const samples = [];
          let tick = 0;
          const drives = Array.from({ length: motorCount }, (_, i) =>
            driveVoice({
              coordinate: 'rotation',
              emitterKey: String(i),
              position: [0, 0, 0],
              speedRadS: 100,
              currentA: 1,
              currentScaleA: 2,
              torqueNm: 1,
            }),
          );
          const contacts = Array.from({ length: 4 }, (_, i) =>
            contactVoice({
              pairKey: String(i),
              position: [0, 0, 0],
              normalImpulseNs: 1,
              normalLoadN: 120,
              slipSpeedMS: 1,
              rollingSpeedMS: 0,
              geometryClass: 'curved',
              frictionEligibility: 'positive',
              valid: true,
            }),
          );
          for (let i = 0; i < 240; i++) {
            frame.tick = ++tick;
            events.read(adapter.read(frame, observed.cursor.epoch));
          }
          for (let i = 0; i < 180; i++) {
            await new Promise(requestAnimationFrame);
            const start = performance.now();
            if (enabled) {
              frame.tick = ++tick;
              const packet = adapter.read(frame, observed.cursor.epoch);
              events.read(packet);
              engine.play({ tick, interval: 1 / 120, drives, contacts, impacts: [] });
            }
            const elapsed = performance.now() - start;
            if (i >= 60) samples.push(elapsed);
          }
          engine.stop();
          trials.push({
            motorCount,
            trial,
            enabled,
            samples,
            p95: [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)],
          });
        }
    engine.dispose();
    return {
      trials,
      userAgent: navigator.userAgent,
      gpu: (() => {
        const gl = document.querySelector('canvas')?.getContext('webgl2'),
          debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable';
      })(),
    };
  });
  // Retain the synthetic timings before the first gate reads them, so a failure
  // leaves the measured numbers on disk; the messages name them as well.
  writeFileSync(`${out}/synthetic-timings.json`, JSON.stringify(timings, null, 2));
  for (const trial of timings.trials)
    if (trial.enabled) {
      const baseline = timings.trials.find(
        (t) => t.motorCount === trial.motorCount && t.trial === trial.trial && !t.enabled,
      );
      const where = `synthetic trial ${trial.trial} motors ${trial.motorCount}`;
      assert.ok(
        trial.p95 <= 1,
        `${where}: adapter and scheduler p95 ${trial.p95.toFixed(3)} ms <=1 ms`,
      );
      assert.ok(
        trial.p95 - baseline.p95 <= 2,
        `${where}: added measured callback CPU ${(trial.p95 - baseline.p95).toFixed(3)} ms <=2 ms (baseline p95 ${baseline.p95.toFixed(3)})`,
      );
    }
  const frameTrials = [];
  for (let trial = 0; trial < 3; trial++)
    for (const enabled of trial % 2 ? [true, false] : [false, true]) {
      await evidence.loadAndWait(page, `${out}/ball.json`);
      const current = await page.evaluate(() => window.workshopProbe.readAudio().enabled);
      if (current !== enabled)
        await page
          .getByRole('button', { name: current ? 'Sound on' : 'Sound off', exact: true })
          .click();
      await page.locator('[data-command=run]').click();
      const samples = await page.evaluate(() => {
        window.advanceTime(2000);
        const values = [];
        // Player frames are 60 Hz (two ticks each); the per-frame budget below is
        // charged per frame, so batch by frame, not by 1000/30 four-tick chunks.
        for (let i = 0; i < 360; i++) {
          window.advanceTime(1000 / 60);
          if (i >= 120) {
            values.push(window.workshopProbe.readAudio());
          }
        }
        return values;
      });
      const p95 = (key) =>
        samples.map((s) => s[key]).sort((a, b) => a - b)[Math.floor(samples.length * 0.95)];
      frameTrials.push({
        trial,
        enabled,
        samples,
        frameP95: p95('frameCpuMs'),
        audioP95: p95('audioCpuMs'),
      });
      await page.locator('[data-command=pause]').click();
    }
  writeFileSync(`${out}/frame-timings.json`, JSON.stringify(frameTrials, null, 2));
  for (const trial of frameTrials)
    if (trial.enabled) {
      const baseline = frameTrials.find((t) => t.trial === trial.trial && !t.enabled);
      const where = `real trial ${trial.trial} enabled`;
      assert.ok(
        trial.audioP95 <= 1,
        `${where}: completed-frame adapter and scheduler p95 ${trial.audioP95.toFixed(3)} ms <=1 ms (${trial.samples.length} samples, ${trial.samples.filter((s) => s.audioCpuMs > 1).length} above 1 ms)`,
      );
      assert.ok(
        trial.frameP95 - baseline.frameP95 <= 2,
        `${where}: added render CPU p95 ${(trial.frameP95 - baseline.frameP95).toFixed(3)} ms <=2 ms (baseline frame p95 ${baseline.frameP95.toFixed(3)})`,
      );
    }
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/results.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        hardware: { cpu: cpus()[0].model, platform: platform(), release: release() },
        frameTrials,
        waveforms,
        resources,
        timings,
        listening: 'pending',
        ok: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Mechanical audio: real waveforms, pitch, silence/release, UI, resource ceilings and timing probes passed; listening pending.',
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
