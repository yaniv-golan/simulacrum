import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyBlueprint,
  createPart,
  validateBlueprint,
  loadSave,
} from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { CORD_LIMITS, CORD_MATERIALS, admitCordBudget } from '../src/model/cord.mjs';
import { DT } from '../src/model/tick.mjs';
const fixture = () => {
  const bp = createEmptyBlueprint('cord-test', 'Cord test');
  bp.parts = [createPart('beam', 'a', [0, 1, 0]), createPart('plate', 'b', [0.69, 1, 0])];
  bp.connections = [
    {
      id: 'line',
      kind: 'cord',
      a: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
      cord: {
        restLength: 0.3,
        stiffness: 120,
        damping: 8,
        diameter: 0.008,
        segments: 4,
        material: 'rubber',
      },
    },
  ];
  return bp;
};
/** Two short beams are light enough that the shared elastic budget is reachable
 * inside the authored 1-300 N/m range. */
const lightFixture = (stiffness) => {
  const bp = fixture();
  bp.parts = [createPart('beam', 'a', [0, 1, 0]), createPart('beam', 'b', [0.3, 1, 0])];
  bp.parts.forEach((p) => (p.parameters.length = 0.1));
  bp.connections[0].cord.stiffness = stiffness;
  return bp;
};
const body = (mass, fixed = false) => ({
  shape: 'box',
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass,
  halfExtents: [0.1, 0.1, 0.1],
  fixed,
  friction: 0.5,
  restitution: 0.1,
});
test('ordinary cord descriptor saves and compiles distributed mass with authored series compliance', () => {
  const bp = fixture();
  assert.equal(validateBlueprint(bp).ok, true);
  assert.deepEqual(loadSave(JSON.stringify(bp)).blueprint, bp);
  for (const n of [2, 4, 8]) {
    bp.connections[0].cord.segments = n;
    const c = compileAssembly(bp, { ground: null });
    const nodes = c.connections[0].cord.nodes;
    assert.equal(nodes.length, n + 1);
    assert.equal(c.configuration.joints.filter((j) => j.kind === 'spherical').length, 2);
    // Mass is owned by material, diameter and rest length, exactly as the rope's is.
    const mass = nodes.reduce((s, i) => s + c.configuration.bodies[i].mass, 0);
    const analytic = 1100 * ((Math.PI * 0.008 ** 2) / 4) * 0.3;
    assert.ok(Math.abs(mass - analytic) < 1e-15, `${mass} vs ${analytic}`);
    const rows = c.configuration.joints.filter((j) => j.kind === 'cord');
    assert.equal(rows.length, n);
    // n rows in series restore the authored end-to-end pair; nothing stores it twice.
    assert.ok(Math.abs(rows.reduce((s, j) => s + 1 / j.stiffness, 0) - 1 / 120) < 1e-14);
    assert.ok(Math.abs(rows.reduce((s, j) => s + 1 / j.damping, 0) - 1 / 8) < 1e-14);
    assert.ok(rows.every((j) => j.maxStrain === CORD_LIMITS.maxStrain));
    assert.ok(rows.every((j) => !Object.hasOwn(j, 'strength')));
    assert.ok(
      Math.abs(rows.reduce((s, j) => s + j.restLength, 0) - 0.3) < 1e-15,
      'rest length is subdivided, not restated',
    );
  }
  // Material owns mass: a denser sheath is heavier at the same authored stiffness.
  bp.connections[0].cord.segments = 4;
  const rubber = compileAssembly(bp, { ground: null });
  bp.connections[0].cord.material = 'bungee';
  const bungee = compileAssembly(bp, { ground: null });
  const total = (c) => c.connections[0].cord.nodes.reduce((s, i) => s + c.configuration.bodies[i].mass, 0);
  assert.ok(total(bungee) < total(rubber));
  // Every material row is player-selectable and complete.
  for (const row of Object.values(CORD_MATERIALS)) {
    assert.equal(typeof row.name, 'string');
    assert.ok(row.density > 0 && row.packing > 0 && row.packing <= 1);
  }
});
test('cord domain, capacity and shared elastic budget reject while ordinary controls admit', () => {
  assert.equal(validateBlueprint(fixture()).ok, true);
  for (const [key, value] of [
    ['restLength', 0.07],
    ['restLength', 0.41],
    ['stiffness', 0],
    ['stiffness', 301],
    ['damping', -1],
    ['damping', 101],
    ['segments', 1],
    ['segments', 9],
    ['diameter', 0.003],
    ['diameter', 0.021],
    ['material', 'steel'],
  ]) {
    const bp = fixture();
    bp.connections[0].cord[key] = value;
    assert.equal(validateBlueprint(bp).ok, false, `${key}=${value} must reject`);
  }
  // A cord payload on another kind, and a missing payload on a cord, both reject.
  const wrongKind = fixture();
  wrongKind.connections[0].kind = 'rope';
  assert.equal(validateBlueprint(wrongKind).ok, false);
  const missing = fixture();
  delete missing.connections[0].cord;
  assert.equal(validateBlueprint(missing).ok, false);
  // Authored separation beyond the linear elastic domain rejects at compile time.
  const stretched = fixture();
  stretched.parts[1].position = [1.5, 1, 0];
  assert.throws(() => compileAssembly(stretched, { ground: null }), {
    reasonCode: 'CORD_DOMAIN_LIMIT',
  });
  const capacity = fixture();
  capacity.parts.push(createPart('plate', 'c', [1.2, 1, 0]), createPart('plate', 'd', [1.7, 1, 0]));
  capacity.connections = [0, 1, 2].map((i) => ({
    ...structuredClone(capacity.connections[0]),
    id: `cord-${i}`,
    a: { part: capacity.parts[i].id, surface: { region: 'right', u: 0, v: 0, twist: 0 } },
    b: { part: capacity.parts[i + 1].id, surface: { region: 'left', u: 0, v: 0, twist: 0 } },
  }));
  assert.throws(() => compileAssembly(capacity, { ground: null }), {
    reasonCode: 'CORD_DOMAIN_LIMIT',
  });
  capacity.connections.length = CORD_LIMITS.maxCords;
  assert.doesNotThrow(() => compileAssembly(capacity, { ground: null }));
  // The budget boundary, derived from the compiled authored masses, not restated.
  const probe = compileAssembly(lightFixture(1), { ground: null }).configuration;
  const mobility = 1 / probe.bodies[0].mass + 1 / probe.bodies[1].mass;
  const ceiling = Math.floor(CORD_LIMITS.elasticBudget / (DT * DT * mobility));
  assert.ok(ceiling > CORD_LIMITS.minStiffness && ceiling < CORD_LIMITS.maxStiffness, `${ceiling}`);
  assert.doesNotThrow(() => compileAssembly(lightFixture(ceiling), { ground: null }));
  assert.throws(() => compileAssembly(lightFixture(ceiling + 1), { ground: null }), {
    reasonCode: 'CORD_ELASTIC_BUDGET',
  });
});
test('the elastic budget counts guided springs with cords and exempts an immobile pair', () => {
  const bodies = [body(0.2), body(0.2), body(0.2), body(0.2)];
  const cord = [{ a: 0, b: 1, stiffness: 120 }];
  assert.doesNotThrow(() => admitCordBudget(bodies, [], cord));
  const spring = {
    kind: 'spring',
    a: 0,
    b: 2,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    axisA: [1, 0, 0],
    axisB: [1, 0, 0],
    limits: [0.08, 0.4],
    stiffness: 120,
    damping: 2,
    restLength: 0.3,
  };
  // The guided spring alone admits and the cord alone admits; sharing one machine
  // they do not. The wrong trace is a per-element clamp, which would accept this.
  assert.doesNotThrow(() => admitCordBudget(bodies, [spring], []));
  assert.throws(() => admitCordBudget(bodies, [spring], cord), {
    reasonCode: 'CORD_ELASTIC_BUDGET',
  });
  // A separate machine keeps its own budget: the same two elements on disjoint
  // bodies admit together.
  assert.doesNotThrow(() =>
    admitCordBudget(bodies, [{ ...spring, a: 2, b: 3 }], [{ a: 0, b: 1, stiffness: 120 }]),
  );
  // A zero-stiffness guided guide (a powered linear guide or passive rail) spends
  // nothing, and two rigidly bolted ends have no relative mobility to spend.
  assert.doesNotThrow(() => admitCordBudget(bodies, [{ ...spring, stiffness: 0 }], cord));
  const bolted = [{ kind: 'fixed', a: 0, b: 1, anchorA: [0, 0, 0], anchorB: [0, 0, 0] }];
  assert.doesNotThrow(() => admitCordBudget(bodies, bolted, [{ a: 0, b: 1, stiffness: 300 }]));
  // Ground never contributes mobility.
  assert.doesNotThrow(() =>
    admitCordBudget([body(0.01), body(1, true)], [], [{ a: 0, b: 1, stiffness: 1 }]),
  );
});
test('cord identity and copied reusable graphs preserve authored material and numeric plant', async () => {
  const { captureAssembly, insertAssembly } = await import('../src/model/reusable-assemblies.mjs');
  const bp = fixture(),
    renamed = structuredClone(bp);
  renamed.id = 'different';
  renamed.name = 'different';
  renamed.parts.forEach((p, i) => ((p.id = 'renamed-' + i), (p.name = 'Renamed ' + i)));
  renamed.connections[0].id = 'another';
  renamed.connections[0].a.part = 'renamed-0';
  renamed.connections[0].b.part = 'renamed-1';
  assert.deepEqual(compileAssembly(renamed).configuration, compileAssembly(bp).configuration);
  const { definition } = captureAssembly(bp, { name: 'Cord rig', ids: ['a', 'b'], ports: [] });
  const result = insertAssembly(bp, definition, [0, 3, 0], [0, 0, 0, 1]),
    copy = result.blueprint.connections.find((c) => c.id !== bp.connections[0].id);
  assert.deepEqual(copy.cord, bp.connections[0].cord);
  assert.equal(copy.a.part, result.idMap.a);
  assert.equal(loadSave(result.blueprint).ok, true);
  const plant = compileAssembly(result.blueprint);
  assert.equal(plant.configuration.joints.filter((j) => j.kind === 'cord').length, 8);
});
test('cord joins mechanical authoring and mirrored reference attachments remain explicit', async () => {
  const { mechanicalGroup } = await import('../src/model/connection-graph.mjs'),
    { proposeMirroredAssembly } = await import('../src/model/mirror-assembly.mjs');
  const bp = fixture();
  assert.deepEqual(mechanicalGroup(bp, 'a'), ['a', 'b']);
  const result = proposeMirroredAssembly(bp, { ids: ['b'], referenceId: 'a', axis: 'x' });
  assert.equal(result.copiedConnectionIds.length, 1);
  const edge = result.blueprint.connections.find((c) => c.id === result.copiedConnectionIds[0]);
  assert.deepEqual(edge.cord, bp.connections[0].cord);
  assert.equal(edge.a.part, 'a');
  assert.equal(edge.b.part, result.idMap.b);
  assert.doesNotThrow(() => compileAssembly(result.blueprint));
});
