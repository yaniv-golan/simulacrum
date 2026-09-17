import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createSensorWorkshop } from '../src/model/fixtures/sensor-workshop.mjs';
import { normalizeQuaternion } from '../src/model/transforms.mjs';
import { sceneLayout } from '../src/model/environment.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { machineMotion } from '../src/model/motion-readout.mjs';
import { createCaptureEncoder, decodeCaptureEvents } from '../src/application/capture-stream.mjs';
import { sceneParts } from '../src/presentation/capture-review-model.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';

test('authored scene capture, continuation, machine metrics and shared sensing retain their boundaries', async () => {
  const blueprint = createSensorWorkshop('tilt');
  const scene = sceneLayout('hill');
  scene.objects[0].position[0] = 5;
  scene.objects[0].material = 'rubber';
  scene.objects[0].friction = 1.2;
  const plain = await createWorkshop(blueprint),
    authored = await createWorkshop({ ...blueprint, environment: scene });
  try {
    assert.deepEqual(
      compileAssembly(plain.save()).mapping,
      compileAssembly(authored.save()).mapping,
    );
    await plain.act({ type: 'run' });
    await authored.act({ type: 'run' });
    const encoder = createCaptureEncoder(),
      records = [],
      expected = [];
    for (let i = 1; i <= 12; i++) {
      plain.step();
      authored.step();
      const a = plain.observe().frames[0],
        b = authored.observe().frames[0];
      assert.deepEqual(machineMotion(b), machineMotion(a));
      assert.deepEqual(b.sensors.readings, a.sensors.readings);
      assert.equal(
        b.sensors.bodies.length,
        a.sensors.bodies.length + 1,
        'scene remains visible to physically scoped sensors',
      );
      assert.deepEqual(b.receiverControl, a.receiverControl);
      assert.deepEqual(
        b.physics.slice(0, blueprint.parts.length),
        a.physics.slice(0, blueprint.parts.length),
      );
      const context = { observation: b };
      expected.push(JSON.parse(JSON.stringify(context))); // JSON canonicalizes negative zero.
      records.push(
        encoder.encode({
          id: `scene-${i}`,
          seq: i,
          timeMs: (i * 1000) / 120,
          kind: i === 12 ? 'session-end' : i === 1 ? 'session-start' : 'sample',
          context,
        }),
      );
    }
    const decoded = decodeCaptureEvents(records);
    assert.equal(decoded.status, 'complete');
    assert.deepEqual(
      decoded.events.map((e) => e.context),
      expected,
    );
    const reviewed = sceneParts(decoded.events.at(-1).context.observation).at(-1);
    assert.deepEqual(reviewed.position, scene.objects[0].position);
    assert.deepEqual(reviewed.rotation, normalizeQuaternion(scene.objects[0].rotation));
    assert.deepEqual(
      decoded.events.at(-1).context.observation.metadata.blueprint.environment,
      scene,
    );
    const checkpoint = authored.checkpoint();
    authored.step(5);
    const future = deterministicProjection(authored.observe().frames[0]);
    authored.restore(checkpoint);
    authored.step(5);
    assert.deepEqual(deterministicProjection(authored.observe().frames[0]), future);
    const invalid = structuredClone(checkpoint);
    invalid.metadata.blueprint.environment.objects[0].material = 'steel';
    const before = authored.observe();
    assert.throws(() => authored.restore(invalid));
    assert.deepEqual(authored.observe(), before);
    const definition = captureAssembly(blueprint, {
      name: 'Whole machine',
      ids: blueprint.parts.map((p) => p.id),
      ports: [],
    }).definition;
    const target = { ...blueprint, parts: [], connections: [], environment: scene };
    const inserted = insertAssembly(target, definition, [0, 2, 0], [0, 0, 0, 1]);
    assert.deepEqual(inserted.blueprint.environment, scene);
  } finally {
    plain.dispose();
    authored.dispose();
  }
});

test('legacy visual events preserve frozen bump descriptors without executable checkpoint conversion', () => {
  // Frozen legacy observation fields, not regenerated from the current preset function.
  const events = [
    {
      id: 'legacy-1',
      seq: 1,
      timeMs: 0,
      kind: 'session-start',
      context: {
        observation: {
          metadata: {
            blueprint: {
              version: 4,
              id: 'old',
              name: 'Old bump',
              parts: [],
              connections: [],
              environment: 'rounded-bump',
            },
          },
        },
      },
    },
    { id: 'legacy-2', seq: 2, timeMs: 1, kind: 'session-end', context: {} },
  ];
  const decoded = decodeCaptureEvents(events);
  assert.equal(decoded.status, 'complete');
  const obstacle = sceneParts(decoded.events[0].context.observation)[0];
  assert.deepEqual(obstacle, {
    id: 'environment-0',
    position: [0.14, -0.02, -0.6],
    rotation: [0, 0, 0, 1],
    primitives: [{ kind: 'cylinder', halfExtents: [1, 0.03, 0.03] }],
  });
  const wrong = structuredClone(obstacle);
  wrong.position[1] = 0;
  assert.notDeepEqual(wrong, obstacle);
});
