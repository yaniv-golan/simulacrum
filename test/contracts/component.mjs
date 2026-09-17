import assert from 'node:assert/strict';
import { CATALOG, MATERIALS } from '../../src/model/catalog.mjs';
import { partPrimitives, shaftSegments } from '../../src/model/geometry.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createPart, loadSave } from '../../src/model/blueprint.mjs';
import { createPhysicsWorld } from '../../src/simulation/physics/world.mjs';

const near = (actual, expected, label, tolerance = 2e-5) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${label}: ${actual} != ${expected}`,
  );

/** The catalog supplies fixture membership; optional dimensions exercise authored geometry.
 * Independent volume/inertia formulae are the oracle, not compiler output.
 * `compile` injection permits plausible wrong implementations to challenge this suite.
 */
export async function assertComponentContract({
  type,
  parameters = {},
  material,
  expectedHalfExtents,
  compile = compileAssembly,
}) {
  const part = createPart(type, 'component', [0, 2, 0]);
  Object.assign(part.parameters, parameters);
  if (material) part.authoredMaterial.body = material;
  const bp = { version: 4, id: 'ordinary', name: 'Ordinary', parts: [part], connections: [] };
  const loaded = loadSave(JSON.stringify(bp));
  assert.equal(loaded.ok, true, `${type}: save admits the authored fixture`);
  assert.deepEqual(
    loaded.blueprint.parts[0].authoredMaterial,
    part.authoredMaterial,
    'save preserves selected material',
  );
  const primitive = partPrimitives(part)[0],
    definition = CATALOG[type];
  const half = expectedHalfExtents ?? definition.primitives[0].halfExtents;
  assert.deepEqual(primitive.halfExtents, half, 'authored geometry matches expected dimensions');
  const compiled = compile(loaded.blueprint, { ground: null, gravity: [0, 0, 0] });
  const body = compiled.configuration.bodies[0];
  assert.deepEqual(body.halfExtents, half, 'compiler preserves geometry');
  assert.deepEqual(body.position, part.position, 'compiler preserves placement');
  assert.deepEqual(body.rotation, part.rotation, 'compiler preserves orientation');
  const chosen = MATERIALS[material ?? primitive.materialKey];
  const [x, y, z] = half;
  const mass =
    chosen.density *
    (primitive.kind === 'sphere'
      ? (4 * Math.PI * x ** 3) / 3
      : primitive.kind === 'cylinder'
        ? Math.PI * y * y * 2 * x
        : 8 * x * y * z);
  near(body.mass, mass, 'material and volume determine mass');
  assert.equal(body.friction, chosen.friction, 'selected material determines friction');
  assert.equal(body.restitution, chosen.restitution, 'selected material determines restitution');
  assert.equal(
    compiled.mapping[0].materialHandle,
    chosen.handle,
    'selected material reaches renderer mapping',
  );
  assert.equal(
    new Set(definition.ports.map((port) => port.id)).size,
    definition.ports.length,
    'endpoint ids unique',
  );
  for (const port of definition.ports) {
    assert.equal(port.position.length, 3);
    assert.ok(port.position.every(Number.isFinite));
    near(Math.hypot(...port.rotation), 1, 'endpoint unit orientation', 1e-12);
  }
  for (const segment of shaftSegments(part)) {
    const socket = definition.ports.find((port) => port.id === segment.port);
    near(
      Math.hypot(...segment.position.map((v, i) => v - socket.position[i])),
      segment.length / 2,
      'shaft meets socket',
    );
    const ends = [-1, 1].map((sign) =>
      segment.position.map((v, i) => v + (sign * segment.axis[i] * segment.length) / 2),
    );
    assert.ok(
      ends.some((end) => end.every((v, i) => Math.abs(v) <= half[i] + 1e-10)),
      'shaft reaches canonical solid',
    );
  }
  const inertia =
    primitive.kind === 'sphere'
      ? [(2 * mass * x * x) / 5, (2 * mass * x * x) / 5, (2 * mass * x * x) / 5]
      : primitive.kind === 'cylinder'
        ? [
            (mass * y * y) / 2,
            (mass * (3 * y * y + 4 * x * x)) / 12,
            (mass * (3 * y * y + 4 * x * x)) / 12,
          ]
        : [
            (mass * (y * y + z * z)) / 3,
            (mass * (x * x + z * z)) / 3,
            (mass * (x * x + y * y)) / 3,
          ];
  const { gravity, bodies, joints } = compiled.configuration;
  const world = await createPhysicsWorld({ gravity, bodies, joints });
  try {
    for (let axis = 0; axis < 3; axis++)
      near(
        world.getAxisInverseInertia(
          0,
          [0, 1, 2].map((i) => Number(i === axis)),
        ),
        1 / inertia[axis],
        'analytical inverse inertia',
        1e-4,
      );
    assert.deepEqual(world.read()[0].position, part.position, 'simulation placement agrees');
  } finally {
    world.dispose();
  }
}
