import { browserArtifactPath } from './browser-artifacts.mjs';
import assert from 'node:assert/strict';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { createSpringStrut } from '../src/model/fixtures/spring-playground.mjs';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const assertMinimumPixels = ({
  pixelRatio,
  devicePixelRatio,
  width,
  height,
  cssWidth,
  cssHeight,
}) => {
  const expected = Math.min(devicePixelRatio, 2) * 0.4;
  assert.equal(pixelRatio, expected);
  assert.equal(width, Math.floor(cssWidth * expected));
  assert.equal(height, Math.floor(cssHeight * expected));
};
// Advertised minimum quality cannot excuse an unchanged full-resolution renderer.
const pixelControl = {
  pixelRatio: 0.4,
  devicePixelRatio: 1,
  width: 320,
  height: 240,
  cssWidth: 800,
  cssHeight: 600,
};
assertMinimumPixels(pixelControl);
assert.throws(() =>
  assertMinimumPixels({ ...pixelControl, pixelRatio: 1, width: 800, height: 600 }),
);
assert.throws(() => assertMinimumPixels({ ...pixelControl, width: 800, height: 600 }));
function assertPresentationOnlyOrbit(before, after) {
  assert.deepEqual(
    after.frame.metadata.blueprint,
    before.frame.metadata.blueprint,
    'slow orbit preserves the authored blueprint',
  );
  assert.deepEqual(
    after.frame.physics,
    before.frame.physics,
    'slow orbit preserves completed physical poses',
  );
  assert.deepEqual(
    after.cursor,
    before.cursor,
    'slow orbit does not advance the simulation cursor',
  );
  assert.notDeepEqual(
    after.camera.position,
    before.camera.position,
    'ordinary pointer orbit must actually move the camera',
  );
}
// Plausible wrong traces: a no-op pointer path or an accidental part drag cannot
// stand in for presentation-only work, even if the quality indicator changes.
const orbitControl = {
  frame: { metadata: { blueprint: { parts: [] } }, physics: [] },
  cursor: { tick: 0 },
  camera: { position: [1, 1, 1] },
};
const orbitMoved = { ...orbitControl, camera: { position: [2, 1, 1] } };
assertPresentationOnlyOrbit(orbitControl, orbitMoved);
assert.throws(() => assertPresentationOnlyOrbit(orbitControl, orbitControl));
assert.throws(() =>
  assertPresentationOnlyOrbit(orbitControl, {
    ...orbitMoved,
    frame: { ...orbitMoved.frame, physics: [{ position: [1, 0, 0] }] },
  }),
);
assert.throws(() =>
  assertPresentationOnlyOrbit(orbitControl, { ...orbitMoved, cursor: { tick: 1 } }),
);
assert.throws(() =>
  assertPresentationOnlyOrbit(orbitControl, {
    ...orbitMoved,
    frame: { ...orbitMoved.frame, metadata: { blueprint: { parts: ['moved'] } } },
  }),
);
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/spring-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'focus' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
try {
  await page.addInitScript(() => {
    // Deliberate global rAF delay exercises the real adaptive controller.
    // Enable it only in Build, while the simulation clock is stopped; disable it
    // before the measured launcher journey. No quality or physical state is written.
    window.springSlowFrames = false;
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      requestFrame((now) => {
        if (window.springSlowFrames) setTimeout(() => callback(performance.now()), 45);
        else callback(now);
      });
    window.springFocusEvents = [];
    window.addEventListener('blur', () => window.springFocusEvents.push('blur'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) window.springFocusEvents.push('hidden');
    });
  });
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  const lifecycle = await context.newCDPSession(page);
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const environmentFixture = createEmptyBlueprint('environment-check', 'Environment check');
  environmentFixture.parts.push(createPart('beam', 'environment-beam', [0, 2, 0]));
  writeFileSync(`${out}/environment.json`, JSON.stringify(environmentFixture));
  await evidence.loadAndWait(page, `${out}/environment.json`);
  const environment = page.getByRole('combobox', { name: 'Environment', exact: true });
  await environment.selectOption('rounded-bump');
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.environment === 'rounded-bump',
  );
  const terrain = await page.evaluate(
    () => window.workshopProbe.readInteractionState().environment,
  );
  evidence.assert('equal', [terrain.obstacles.length, 1]);
  evidence.assert('deepEqual', [terrain.obstacles[0].position, [0.14, -0.02, -0.6]]);
  evidence.assert('deepEqual', [terrain.obstacles[0].rotation, [0, 0, 0, 1]]);
  for (const [i, size] of [2, 0.06, 0.06].entries())
    evidence.assert('ok', [Math.abs(terrain.obstacles[0].bounds[i] - size) < 1e-7]);
  evidence.assert('deepEqual', [
    (await read()).physics.at(-1).position,
    terrain.obstacles[0].position,
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('equal', [await environment.inputValue(), 'flat']);
  evidence.assert('equal', [
    await page.evaluate(
      () => window.workshopProbe.readInteractionState().environment.obstacles.length,
    ),
    0,
  ]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  evidence.assert('equal', [await environment.inputValue(), 'rounded-bump']);
  const savedEnvironment = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await savedEnvironment).saveAs(`${out}/environment-saved.json`);
  await environment.selectOption('flat');
  await evidence.loadAndWait(page, `${out}/environment-saved.json`);
  evidence.assert('equal', [await environment.inputValue(), 'rounded-bump']);
  await page.locator('[data-command=run]').click();
  evidence.assert('equal', [await environment.isDisabled(), true]);
  await page.locator('[data-command=pause]').click();
  evidence.assert('equal', [await environment.isDisabled(), true]);
  await page.locator('[data-command=build]').click();
  environmentFixture.environment = 'rounded-bump';
  environmentFixture.parts[0].position = [0.14, 0, -0.6];
  writeFileSync(`${out}/environment-overlap.json`, JSON.stringify(environmentFixture));
  // File validation rejects overlap before a core command is dispatched.
  // Wait for that visible result and assert no authored/physical/receipt mutation.
  const beforeRejectedFile = await page.evaluate(() => {
    const frame = JSON.parse(window.render_game_to_text());
    return {
      metadata: frame.metadata,
      physics: frame.physics,
      receipt: window.workshopProbe.readLastCommandResult(),
    };
  });
  await page.locator('input[type=file]').setInputFiles(`${out}/environment-overlap.json`);
  await page.waitForFunction(() =>
    document.querySelector('.status-message')?.textContent.includes('overlaps'),
  );
  evidence.assert('deepEqual', [
    await page.evaluate(() => {
      const frame = JSON.parse(window.render_game_to_text());
      return {
        metadata: frame.metadata,
        physics: frame.physics,
        receipt: window.workshopProbe.readLastCommandResult(),
      };
    }),
    beforeRejectedFile,
  ]);
  for (const width of [1280, 960, 780]) {
    await page.setViewportSize({ width, height: 720 });
    const envBounds = await environment.boundingBox();
    evidence.assert('ok', [
      envBounds && envBounds.x >= 0 && envBounds.x + envBounds.width <= width && envBounds.y >= 0,
    ]);
    evidence.assert('equal', [
      await page.getByRole('button', { name: 'Help', exact: true }).isVisible(),
      true,
    ]);
    for (const control of await page.locator('.workshop-header button:visible').all()) {
      const bounds = await control.boundingBox();
      evidence.assert(
        'ok',
        [
          bounds &&
            bounds.x >= 0 &&
            bounds.y >= 0 &&
            bounds.x + bounds.width <= width &&
            bounds.y + bounds.height <= 720,
        ],
        { control: await control.textContent(), bounds, width },
      );
    }
    await page.screenshot({ path: `${out}/rounded-environment-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  writeFileSync(
    `${out}/empty-environment.json`,
    JSON.stringify(createEmptyBlueprint('empty', 'Empty workshop')),
  );
  await evidence.loadAndWait(page, `${out}/empty-environment.json`);
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=spring-example]').click();
  let f = await read();
  evidence.assert('equal', [f.metadata.blueprint.parts.length, 6]);
  const stiffness = page.getByRole('spinbutton', { name: 'Stiffness · Soft / Firm', exact: true });
  evidence.assert('equal', [await stiffness.inputValue(), '200']);
  await stiffness.fill('999');
  await stiffness.press('Tab');
  evidence.assert('equal', [await stiffness.inputValue(), '200']);
  evidence.assert('ok', [
    (await page.locator('.spring-setting [role=status]').allTextContents()).some((t) =>
      t.includes('Kept 200'),
    ),
  ]);
  const minimum = page.getByRole('spinbutton', { name: 'Minimum length', exact: true });
  await minimum.fill('0.35');
  evidence.assert('ok', [
    (await page.locator('.spring-setting [role=status]').allTextContents()).some((t) =>
      t.includes('zero-force length within travel'),
    ),
  ]);
  await minimum.press('Tab');
  evidence.assert('equal', [await minimum.inputValue(), '0.08']);
  await stiffness.fill('250');
  await stiffness.press('Tab');
  f = await read();
  evidence.assert('equal', [
    f.metadata.blueprint.parts.find((p) => p.id === 'guide').parameters.stiffness,
    250,
  ]);
  await page
    .getByRole('spinbutton', { name: 'Damping · More bounce / Less bounce', exact: true })
    .fill('12');
  await page
    .getByRole('spinbutton', { name: 'Damping · More bounce / Less bounce', exact: true })
    .press('Tab');
  f = await read();
  evidence.assert('equal', [
    f.metadata.blueprint.parts.find((p) => p.id === 'guide').parameters.damping,
    12,
  ]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 120);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  f = await read();
  evidence.assert('ok', [f.springs[0].length < 0.29], { frame: f });
  evidence.assert('ok', [Math.abs(f.energy.balanceResidualJ) < 1e-5], { frame: f });
  const rendered = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (let i = 0; i < f.metadata.blueprint.parts.length; i++)
    evidence.assert(
      'deepEqual',
      [
        rendered.find((r) => r.id === f.metadata.blueprint.parts[i].id).position,
        f.physics[i].position,
      ],
      { frame: f },
    );
  await page.screenshot({ path: `${out}/loaded.png` });
  // Author ordinary signal wiring through the normal file-load boundary. No
  // fixture identity or probe mutation supplies regulator authority.
  const controlled = createSpringStrut();
  controlled.parts.push(
    createPart('travelSensor', 'sensor', [1, 1, 0]),
    createPart('powerCell', 'sensor-cell', [1, 1.2, 0]),
    createPart('positionRegulator', 'regulator', [1.2, 1, 0]),
    createPart('commandReceiver', 'receiver', [1.4, 1, 0]),
  );
  controlled.connections.push(
    {
      id: 'sensor-power',
      kind: 'power',
      a: { part: 'sensor-cell', port: 'power' },
      b: { part: 'sensor', port: 'power' },
    },
    {
      id: 'measurement',
      kind: 'signal',
      a: { part: 'sensor', port: 'signal' },
      b: { part: 'regulator', port: 'signal' },
    },
    {
      id: 'regulation',
      kind: 'signal',
      a: { part: 'regulator', port: 'out' },
      b: { part: 'receiver', port: 'command' },
    },
  );
  writeFileSync(`${out}/controlled.json`, JSON.stringify(controlled));
  await page.locator('[data-command=build]').click();
  await evidence.loadAndWait(page, `${out}/controlled.json`);
  const select = async (id) => {
    if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator(`.part-list [data-part-id="${id}"]`).click();
  };
  const expectMode = async (mode, reason = null) => {
    await page.waitForFunction(
      ({ mode, reason }) => {
        const f = JSON.parse(window.render_game_to_text());
        const receiver = f.receiverControl.receivers[0];
        return receiver.mode === mode && (!reason || receiver.reason === reason);
      },
      { mode, reason },
    );
    const f = await read();
    evidence.assert('equal', [f.power.sources[0].enabled !== false, mode !== 'off']);
    if (mode === 'off') evidence.assert('equal', [f.power.sources[0].duty, 0]);
    return f;
  };
  await select('receiver');
  await page.locator('[data-command=run]').click();
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expectMode('off', 'INVALID_SENSOR'); // Deliberately unbound negative control.
  await page.locator('[data-command=build]').click();
  await select('sensor');
  const springId = controlled.connections.find((c) => c.kind === 'spring').id;
  await page.getByRole('combobox', { name: 'Measured spring', exact: true }).selectOption(springId);
  await page.waitForFunction(
    (id) =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.find(
        (p) => p.id === 'sensor',
      ).springBinding === id,
    springId,
  );
  await select('receiver');
  await page.locator('[data-command=run]').click();
  await expectMode('manual');
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expectMode('automatic');
  const target = page.getByRole('spinbutton', { name: 'Target spring length', exact: true });
  await target.fill('0.27');
  await target.press('Tab');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).receiverControl.receivers[0].target === 0.27,
  );
  await expectMode('automatic'); // Reading/editing inspector input does not seize ownership.
  await page.getByRole('button', { name: 'Zero', exact: true }).click();
  await expectMode('manual');
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expectMode('automatic');
  await page.keyboard.down('w');
  try {
    await expectMode('manual');
  } finally {
    await page.keyboard.up('w');
  }
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).power.sources[0].duty === 0,
  );
  await page.getByRole('button', { name: 'Off', exact: true }).click();
  await expectMode('off', 'OPERATOR_OFF');
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expectMode('automatic');
  await page.locator('[data-command=pause]').click();
  await page.locator('[data-command=run]').click();
  await expectMode('off', 'SUSPENDED');
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expectMode('automatic');
  // Ordinary UI journeys use Playwright's default focus emulation. This
  // bounded segment disables it to prove real browser lifecycle behavior.
  await lifecycle.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus(), undefined, { polling: 50 });
  const priorBlur = await page.evaluate(() => window.springFocusEvents.length);
  const other = await context.newPage();
  try {
    await (
      await context.newCDPSession(other)
    ).send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await other.goto('about:blank');
    await other.bringToFront();
    await page.waitForFunction((count) => window.springFocusEvents.length > count, priorBlur, {
      polling: 50,
    });
    await page.bringToFront();
  } finally {
    await other.close();
  }
  await expectMode('off', 'SUSPENDED');
  const realFocusEvents = await page.evaluate(
    (count) => window.springFocusEvents.slice(count),
    priorBlur,
  );
  evidence.assert('ok', [realFocusEvents.some((event) => event === 'blur' || event === 'hidden')]);
  await lifecycle.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const lifecycleFrame = await read();
  await page.screenshot({ path: `${out}/automatic-suspended.png` });

  const openExamples = async () => {
    await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
    if (!(await page.locator('.spring-experiments').evaluate((el) => el.open)))
      await page.locator('.spring-experiments > summary').click();
  };
  const openExample = async (name, id) => {
    await page.locator('[data-command=build]').click();
    const prior = (await read()).metadata.blueprint;
    await openExamples();
    await page.getByRole('button', { name, exact: true }).click();
    evidence.assert('deepEqual', [(await read()).metadata.blueprint, prior]);
    await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
    await page.waitForFunction(
      (id) => JSON.parse(window.render_game_to_text()).metadata.blueprint.id === id,
      id,
    );
  };
  const renderedAgreement = async () => {
    const frame = await read();
    const transforms = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
    for (const [i, part] of frame.metadata.blueprint.parts.entries()) {
      const rendered = transforms.find((r) => r.id === part.id);
      evidence.assert('deepEqual', [rendered.position, frame.physics[i].position], { frame });
      evidence.assert(
        'ok',
        [rendered.rotation.every((value, axis) => value === frame.physics[i].rotation[axis])],
        { frame },
      );
    }
    const coils = await page.evaluate(() => window.workshopProbe.readRenderedSpringEndpoints());
    const connections = frame.metadata.blueprint.connections.filter((c) => c.kind === 'spring');
    evidence.assert('equal', [coils.length, frame.springs.length]);
    for (const [index, spring] of frame.springs.entries()) {
      const coil = coils.find((c) => c.id === connections[index].id);
      evidence.assert('ok', [coil?.visible === true]);
      for (const [end, point] of [
        ['a', spring.pointA],
        ['b', spring.pointB],
      ])
        evidence.assert('ok', [Math.hypot(...coil[end].map((v, axis) => v - point[axis])) < 1e-6]);
    }
    return frame;
  };
  await openExample('Try suspension cart', 'guided-suspension-cart');
  const cartInitial = await read();
  evidence.assert('equal', [cartInitial.springs.length, 4]);
  const measuredChassis = cartInitial.metadata.blueprint.parts.find((p) => p.type === 'chassis');
  await select(measuredChassis.id);
  const measurementsButton = page.getByRole('button', { name: 'Measurements', exact: true });
  if ((await measurementsButton.getAttribute('aria-pressed')) !== 'true')
    await measurementsButton.click();
  await page.locator('[data-command=run]').click();
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 240);
  } finally {
    await page.keyboard.up('w');
  }
  await page.locator('[data-command=pause]').click();
  const cart = await renderedAgreement();
  evidence.assert('equal', [cart.status, 'ready']);
  evidence.assert(
    'ok',
    [
      Math.hypot(
        cart.physics[0].position[0] - cartInitial.physics[0].position[0],
        cart.physics[0].position[2] - cartInitial.physics[0].position[2],
      ) > 0.01,
    ],
    { frame: cart },
  );
  evidence.assert('ok', [cart.power.cells[0].energyJ < cartInitial.power.cells[0].energyJ]);
  const measured = await page.evaluate(
    () => window.workshopProbe.readInteractionState().bodyMeasurement,
  );
  evidence.assert('equal', [measured.selectedId, measuredChassis.id]);
  evidence.assert('equal', [measured.status, 'ready']);
  evidence.assert('equal', [
    measured.accelerationSamples,
    measured.endTick - measured.startTick - 11,
  ]);
  const chassisIndex = cart.metadata.blueprint.parts.findIndex((p) => p.id === measuredChassis.id);
  evidence.assert('ok', [
    Math.abs(
      measured.displacement -
        (cart.physics[chassisIndex].position[1] - cartInitial.physics[chassisIndex].position[1]),
    ) < 1e-9,
  ]);
  evidence.assert('ok', [
    Number.isFinite(measured.accelerationRms) && measured.accelerationRms > 0,
  ]);
  evidence.assert('ok', [
    (await page.locator('.selected-motion-values').textContent()).includes('100 ms-average'),
  ]);
  evidence.assert('ok', [
    (await page.locator('.selected-motion-window').textContent()).includes('origin tick'),
  ]);
  await page.screenshot({ path: `${out}/guided-cart.png` });
  await measurementsButton.click();
  evidence.assert('equal', [await page.locator('.motion-values').isVisible(), false]);

  await openExample('Try rigid cart', 'rigid-suspension-cart');
  const rigidInitial = await read();
  evidence.assert('equal', [
    rigidInitial.metadata.blueprint.parts.length,
    cartInitial.metadata.blueprint.parts.length,
  ]);
  evidence.assert('equal', [
    rigidInitial.metadata.blueprint.connections.length,
    cartInitial.metadata.blueprint.connections.length + 4,
  ]);
  evidence.assert('equal', [rigidInitial.metadata.blueprint.environment, 'rounded-bump']);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 120);
  await page.locator('[data-command=pause]').click();
  const rigid = await renderedAgreement();
  evidence.assert('ok', [
    rigid.springs.every(
      (spring, index) => Math.abs(spring.length - rigidInitial.springs[index].length) < 1e-5,
    ),
  ]);
  await page.screenshot({ path: `${out}/rigid-cart.png` });

  await openExample('Try articulated strut', 'articulated-suspension');
  const articulatedInitial = await read();
  evidence.assert('ok', [
    articulatedInitial.metadata.blueprint.parts.filter((p) => p.type === 'passiveBearing').length >=
      2,
  ]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 120);
  await page.locator('[data-command=pause]').click();
  const articulated = await renderedAgreement();
  evidence.assert('equal', [articulated.status, 'ready']);
  evidence.assert('ok', [
    articulated.springs[0].length > 0.08 && articulated.springs[0].length < 0.4,
  ]);
  await page.screenshot({ path: `${out}/articulated-strut.png` });

  await openExample('Try active suspension', 'active-suspension');
  await select('rocker-receiver');
  evidence.assert('equal', [(await read()).metadata.mode, 'build']);
  await page.locator('[data-command=run]').click();
  await expectMode('manual');
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expectMode('automatic');
  const activeTarget = page.getByRole('spinbutton', { name: 'Target spring length', exact: true });
  await activeTarget.fill('0.26');
  await activeTarget.press('Tab');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).receiverControl.receivers[0].target === 0.26,
  );
  await evidence.assertRejectedEdit({
    snapshot: async () => {
      const frame = await read(),
        control = frame.receiverControl.receivers[0];
      return { target: control.target, mode: control.mode, blueprint: frame.metadata.blueprint };
    },
    action: async () => {
      const prior = await page.evaluate(
        () => window.workshopProbe.readLastCommandResult().sequence,
      );
      await activeTarget.fill('0.34');
      await activeTarget.press('Tab');
      const handle = await page.waitForFunction((sequence) => {
        const receipt = window.workshopProbe.readLastCommandResult();
        return (
          receipt.sequence > sequence &&
          receipt.input.type === 'regulator-target' &&
          receipt.input.target === 0.34 &&
          receipt
        );
      }, prior);
      const receipt = await handle.jsonValue();
      await handle.dispose();
      return receipt;
    },
  });
  evidence.assert('equal', [await activeTarget.inputValue(), '0.26']);
  evidence.assert('ok', [
    (await page.locator('[role=status]').allTextContents()).some((text) =>
      text.includes('Kept 0.26 m. Choose 0.26–0.33 m.'),
    ),
  ]);
  const targetStart = (await read()).tick;
  await page.waitForFunction(
    (tick) => JSON.parse(window.render_game_to_text()).tick >= tick + 400,
    targetStart,
  );
  const active = await expectMode('automatic');
  evidence.assert('ok', [Math.abs(active.springs[0].length - 0.26) <= 0.005], { frame: active });
  evidence.assert('equal', [active.sensors.tick, active.tick - 1]);
  const measurement = await page.evaluate(() => {
    const frame = JSON.parse(window.render_game_to_text());
    const sensor = frame.metadata.blueprint.parts.findIndex((p) => p.type === 'travelSensor');
    const reading = frame.sensors.readings.find((r) => r.node === sensor);
    return {
      shown: document.querySelector('.suspension-reading')?.textContent,
      expected: `Measured spring length ${reading.channels.length.value.toFixed(3)} m · ${reading.channels.speed.value.toFixed(3)} m/s`,
    };
  });
  evidence.assert('equal', [measurement.shown, measurement.expected]);

  await page.getByRole('button', { name: 'Off', exact: true }).click();
  const activeOff = await expectMode('off');
  evidence.assert('equal', [activeOff.power.motors[0].current, 0]);
  await page.locator('[data-command=pause]').click();
  await renderedAgreement();
  evidence.assert('ok', [
    (await page.locator('[data-live-part]').innerText()).includes('Paused · off · drive disabled'),
  ]);
  await page.screenshot({ path: `${out}/active-suspension-off.png` });

  await page.locator('[data-command=build]').click();
  const beforeModules = (await read()).metadata.blueprint;
  for (const driven of [false, true]) {
    await openExamples();
    await page
      .getByRole('button', {
        name: driven ? 'Add driven suspension module' : 'Add passive suspension module',
        exact: true,
      })
      .click();
    await page.waitForFunction(
      (count) =>
        (JSON.parse(window.render_game_to_text()).metadata.blueprint.assemblies?.length ?? 0) >
        count,
      (beforeModules.assemblies ?? []).length + Number(driven),
    );
    const frame = await read(),
      group = frame.metadata.blueprint.assemblies.at(-1);
    evidence.assert('deepEqual', [
      group.ports.map((p) => p.name),
      driven
        ? ['Chassis mount', 'Wheel axle', 'Drive power', 'Drive command']
        : ['Chassis mount', 'Wheel axle'],
    ]);
    evidence.assert('ok', [group.ids.every((id) => !beforeModules.parts.some((p) => p.id === id))]);
  }
  await openExamples();
  await page.getByRole('button', { name: 'Add pin-ended strut', exact: true }).click();
  await page.waitForFunction(
    (count) =>
      (JSON.parse(window.render_game_to_text()).metadata.blueprint.assemblies?.length ?? 0) ===
      count + 3,
    (beforeModules.assemblies ?? []).length,
  );
  evidence.assert('deepEqual', [
    (await read()).metadata.blueprint.assemblies.at(-1).ports.map((p) => p.name),
    ['Upper pin mount', 'Lower pin mount'],
  ]);
  const modules = (await read()).metadata.blueprint;
  await page.locator('[data-command=undo]').click();
  evidence.assert('equal', [
    (await read()).metadata.blueprint.assemblies.length,
    (beforeModules.assemblies ?? []).length + 2,
  ]);
  await page.locator('[data-command=redo]').click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, modules]);
  await renderedAgreement();
  await page.screenshot({ path: `${out}/reusable-modules.png` });

  evidence.assert('equal', [(await read()).metadata.mode, 'build']);
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  if (!(await page.locator('.spring-experiments').evaluate((el) => el.open)))
    await page.locator('.spring-experiments > summary').click();
  await page.getByRole('button', { name: 'Try spring launcher', exact: true }).click();
  evidence.assert('equal', [(await read()).metadata.blueprint.id, modules.id]);
  await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).metadata.blueprint.id === 'spring-launcher',
  );
  const orbitSnapshot = () =>
    page.evaluate(() => {
      const interaction = window.workshopProbe.readInteractionState();
      return {
        frame: JSON.parse(window.render_game_to_text()),
        cursor: window.workshopProbe.observe().cursor,
        camera: interaction.camera,
      };
    });
  const beforeSlowOrbit = await orbitSnapshot();
  evidence.assert('equal', [beforeSlowOrbit.frame.metadata.mode, 'build']);
  const viewport = await page.locator('canvas[aria-label="Machine view"]').boundingBox();
  evidence.assert('ok', [viewport, 'orbit requires the visible workshop canvas']);
  const orbitTrace = [];
  await page.evaluate(() => {
    window.springSlowFrames = true;
  });
  const orbitStarted = performance.now();
  await page.mouse.move(viewport.x + viewport.width * 0.5, viewport.y + viewport.height * 0.6);
  // Shift + right drag is the existing OrbitControls rotate gesture and cannot
  // enter the primary-button part-drag authoring path.
  await page.keyboard.down('Shift');
  await page.mouse.down({ button: 'right' });
  try {
    // Prior journeys may already have reached Minimum; still exercise a real orbit.
    await page.mouse.move(
      viewport.x + viewport.width * 0.5 + 35,
      viewport.y + viewport.height * 0.6 + 12,
    );
    while (performance.now() - orbitStarted < 45000) {
      const rendering = await page.evaluate(
        () => window.workshopProbe.readInteractionState().rendering,
      );
      orbitTrace.push({
        elapsedMs: performance.now() - orbitStarted,
        level: rendering.quality.level,
        frames: rendering.frames,
      });
      if (rendering.quality.level === 5) break;
      const angle = orbitTrace.length * 0.3;
      await page.mouse.move(
        viewport.x + viewport.width * 0.5 + 35 * Math.sin(angle),
        viewport.y + viewport.height * 0.6 + 12 * Math.cos(angle),
      );
      await page.waitForTimeout(50);
    }
    evidence.assert('ok', [
      orbitTrace.at(-1).elapsedMs <= 45000,
      'minimum-quality observation stays within the original 45000 ms deadline',
    ]);
    evidence.assert('equal', [
      orbitTrace.at(-1).level,
      5,
      'active slow orbit reaches minimum quality within the original 45000 ms deadline',
    ]);
  } finally {
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Shift');
    await page.evaluate(() => {
      window.springSlowFrames = false;
    });
  }
  const afterSlowOrbit = await orbitSnapshot();
  assertPresentationOnlyOrbit(beforeSlowOrbit, afterSlowOrbit);
  const minimumRendering = await page.evaluate(
    () => window.workshopProbe.readInteractionState().rendering,
  );
  const minimumPixels = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="Machine view"]');
    return {
      pixelRatio: window.workshopProbe.readInteractionState().rendering.pixelRatio,
      devicePixelRatio: window.devicePixelRatio,
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    };
  });
  assertMinimumPixels(minimumPixels);
  evidence.assert('equal', [minimumRendering.quality.level, 5]);
  evidence.assert('equal', [minimumRendering.quality.scale, 0.4]);
  evidence.assert('equal', [minimumRendering.quality.shadowSize, 0]);
  const launcherInitial = await renderedAgreement();
  const projectile = launcherInitial.metadata.blueprint.parts.findIndex(
    (p) => p.id === 'projectile',
  );
  evidence.assert('ok', [projectile >= 0]);
  evidence.assert('ok', [
    !launcherInitial.metadata.blueprint.connections.some(
      (c) => c.a.part === 'projectile' || c.b.part === 'projectile',
    ),
  ]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 240);
  const held = await read();
  evidence.assert(
    'ok',
    [
      Math.abs(
        held.physics[projectile].position[0] - launcherInitial.physics[projectile].position[0],
      ) < 0.01,
    ],
    { frame: held },
  );
  await page.keyboard.down('l');
  try {
    await page.waitForFunction(
      (start) => JSON.parse(window.render_game_to_text()).tick >= start + 240,
      held.tick,
    );
  } finally {
    await page.keyboard.up('l');
  }
  await page.locator('[data-command=pause]').click();
  const launched = await renderedAgreement();
  evidence.assert('equal', [
    await page.evaluate(() => window.workshopProbe.readInteractionState().rendering.quality.level),
    5,
  ]);
  evidence.assert(
    'ok',
    [held.physics[projectile].position[0] - launched.physics[projectile].position[0] > 0.3],
    { frame: launched },
  );
  await page.screenshot({ path: `${out}/launcher-released.png` });
  writeFileSync(
    `${out}/journeys.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        lifecycleFrame,
        focusEvidence: {
          realFocusEvents,
          realBlurEmulation: false,
          ordinaryJourneyEmulation: true,
        },
        cart,
        articulated,
        active,
        activeOff,
        modules,
        minimumRendering,
        minimumPixels,
        slowOrbit: { before: beforeSlowOrbit, after: afterSlowOrbit, trace: orbitTrace },
        cadenceInjection: {
          delayMs: 45,
          disabledBeforeMeasuredJourney: true,
          performanceQualification: false,
        },
        launcherInitial,
        held,
        launched,
      },
      null,
      2,
    ),
  );
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, frame: f, errors: evidence.errors }, null, 2),
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
