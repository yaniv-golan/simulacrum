import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { TensionOnlyDistanceConstraint } from "../src/simulation/tension-only-distance-constraint.js";

const DT = 1 / 120;

function world(gravity = new CANNON.Vec3(0, -9.81, 0)) {
  const value = new CANNON.World({ gravity });
  value.solver.iterations = 30;
  value.solver.tolerance = 1e-10;
  return value;
}

function body({ mass = 1, position = [0, 0, 0] } = {}) {
  return new CANNON.Body({
    mass,
    position: new CANNON.Vec3(...position),
    shape: new CANNON.Sphere(0.025),
    linearDamping: 0,
    angularDamping: 0,
  });
}

function segment(left, right, restLengthM = 1) {
  return new TensionOnlyDistanceConstraint(left, right, {
    restLengthM,
    maximumTensionN: 100_000,
    stiffnessNPerM: 2e6,
    relaxation: 3,
    timeStepS: DT,
  });
}

function catenaryParameter(spanM, lengthM) {
  let low = 0.01,
    high = 100;
  for (let iteration = 0; iteration < 100; iteration++) {
    const middle = (low + high) / 2,
      predicted = 2 * middle * Math.sinh(spanM / (2 * middle));
    if (predicted > lengthM) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function settledSpan(elementCount) {
  const simulation = world(),
    spanM = 4,
    lengthM = 5,
    restLengthM = lengthM / elementCount,
    nodes = Array.from({ length: elementCount + 1 }, (_, index) => {
      const fraction = index / elementCount,
        node = body({
          mass: index === 0 || index === elementCount ? 0 : 0.05,
          position: [
            -spanM / 2 + spanM * fraction,
            -0.15 * Math.sin(Math.PI * fraction),
            0,
          ],
        });
      node.linearDamping = 0.08;
      return node;
    }),
    constraints = nodes
      .slice(1)
      .map((node, index) => segment(nodes[index], node, restLengthM));
  for (const node of nodes) simulation.addBody(node);
  for (const constraint of constraints) simulation.addConstraint(constraint);
  for (let tick = 0; tick < 3_600; tick++) simulation.step(DT);
  return {
    centerSagM: -nodes[Math.floor(nodes.length / 2)].position.y,
    arcLengthM: nodes
      .slice(1)
      .reduce(
        (sum, node, index) =>
          sum + node.position.distanceTo(nodes[index].position),
        0,
      ),
    symmetryErrorM: Math.max(
      ...nodes.map((node, index) =>
        Math.abs(node.position.y - nodes.at(-index - 1).position.y),
      ),
    ),
  };
}

{
  const simulation = world(new CANNON.Vec3(0, 0, 0)),
    left = body({ position: [0, 0, 0] }),
    right = body({ position: [0.5, 0, 0] }),
    constraint = segment(left, right);
  simulation.addBody(left);
  simulation.addBody(right);
  simulation.addConstraint(constraint);
  simulation.step(DT);
  assert.ok(constraint.tensionN() < 1e-9, "slack segment generated tension");
  assert.ok(
    Math.abs(left.velocity.x) < 1e-12 && Math.abs(right.velocity.x) < 1e-12,
    "slack segment pushed its endpoints apart",
  );
}

{
  const simulation = world(new CANNON.Vec3(0, 0, 0)),
    left = body({ position: [0, 0, 0] }),
    right = body({ position: [1.1, 0, 0] }),
    constraint = segment(left, right);
  simulation.addBody(left);
  simulation.addBody(right);
  simulation.addConstraint(constraint);
  simulation.step(DT);
  assert.ok(constraint.tensionN() > 0, "extended segment generated no tension");
  assert.ok(
    left.velocity.x > 0 && right.velocity.x < 0,
    "extended segment did not apply equal inward reactions",
  );
  assert.ok(
    Math.abs(left.velocity.x + right.velocity.x) < 1e-12,
    "segment violated linear momentum conservation",
  );
}

{
  const simulation = world(),
    nodes = Array.from({ length: 6 }, (_, index) =>
      body({ position: [0, 8 - index * 0.8, 0] }),
    ),
    constraints = nodes
      .slice(1)
      .map((node, index) => segment(nodes[index], node, 1));
  for (const node of nodes) simulation.addBody(node);
  for (const constraint of constraints) simulation.addConstraint(constraint);
  simulation.step(DT);
  assert.ok(
    constraints.every((constraint) => constraint.tensionN() < 1e-8),
    "freely falling slack line developed gravity-induced tension",
  );
  assert.ok(
    nodes.every((node) => Math.abs(node.velocity.y + 9.81 * DT) < 1e-9),
    "free line nodes did not share gravitational acceleration",
  );
}

{
  const simulation = world(),
    nodes = Array.from({ length: 7 }, (_, index) =>
      body({ mass: index === 0 ? 0 : 0.25, position: [0, 6 - index * 0.5, 0] }),
    ),
    constraints = nodes
      .slice(1)
      .map((node, index) => segment(nodes[index], node, 0.5));
  for (const node of nodes) simulation.addBody(node);
  for (const constraint of constraints) simulation.addConstraint(constraint);
  for (let tick = 0; tick < 1_200; tick++) simulation.step(DT);
  const tensions = constraints.map((constraint) => constraint.tensionN());
  assert.ok(tensions[0] > tensions.at(-1), "hanging tension did not decrease");
  assert.ok(
    tensions.every(
      (value, index) => index === 0 || value <= tensions[index - 1],
    ),
    `hanging tension was not monotonic: ${JSON.stringify(tensions)}`,
  );
  assert.ok(
    Math.abs(tensions[0] - 6 * 0.25 * 9.81) < 0.8,
    `top reaction ${tensions[0]} N did not carry distributed weight`,
  );
}

const coarseCatenary = settledSpan(10),
  fineCatenary = settledSpan(20),
  a = catenaryParameter(4, 5),
  analyticSagM = a * (Math.cosh(2 / a) - 1);
assert.ok(
  Math.abs(fineCatenary.centerSagM - analyticSagM) < 0.18,
  `settled span sag ${fineCatenary.centerSagM} m missed analytic ${analyticSagM} m`,
);
assert.ok(fineCatenary.symmetryErrorM < 0.015, "settled span lost symmetry");
assert.ok(
  Math.abs(fineCatenary.arcLengthM - 5) < 0.08,
  `settled span arc ${fineCatenary.arcLengthM} m lost authored length`,
);
assert.ok(
  Math.abs(coarseCatenary.centerSagM - fineCatenary.centerSagM) < 0.12,
  "catenary result did not converge under element refinement",
);

function shockPeak() {
  const simulation = world(new CANNON.Vec3(0, 0, 0)),
    anchor = body({ mass: 0, position: [0, 0, 0] }),
    payload = body({ mass: 2, position: [0.75, 0, 0] }),
    constraint = segment(anchor, payload, 1);
  payload.velocity.set(4, 0, 0);
  simulation.addBody(anchor);
  simulation.addBody(payload);
  simulation.addConstraint(constraint);
  let peakN = 0,
    firstTautTick = null;
  for (let tick = 1; tick <= 180; tick++) {
    simulation.step(DT);
    const tensionN = constraint.tensionN();
    peakN = Math.max(peakN, tensionN);
    if (firstTautTick == null && tensionN > 1e-6) firstTautTick = tick;
  }
  return { peakN, firstTautTick };
}

const shockA = shockPeak(),
  shockB = shockPeak();
assert.ok(shockA.peakN > 0 && shockA.peakN < 100_000);
assert.ok(shockA.firstTautTick > 1, "slack shock fixture started taut");
assert.deepEqual(shockA, shockB, "shock response was not deterministic");

{
  const simulation = world(),
    lengthM = 2,
    angleRad = 0.12,
    anchor = body({ mass: 0, position: [0, 0, 0] }),
    payload = body({
      mass: 5,
      position: [
        lengthM * Math.sin(angleRad),
        -lengthM * Math.cos(angleRad),
        0,
      ],
    }),
    constraint = segment(anchor, payload, lengthM),
    crossings = [];
  simulation.addBody(anchor);
  simulation.addBody(payload);
  simulation.addConstraint(constraint);
  let previousX = payload.position.x,
    minimumEnergyJ = Infinity,
    maximumEnergyJ = -Infinity;
  for (let tick = 1; tick <= 1_200; tick++) {
    simulation.step(DT);
    if (Math.sign(payload.position.x) !== Math.sign(previousX))
      crossings.push(tick * DT);
    previousX = payload.position.x;
    const energyJ =
      0.5 * payload.mass * payload.velocity.lengthSquared() +
      payload.mass * 9.81 * (payload.position.y + lengthM);
    minimumEnergyJ = Math.min(minimumEnergyJ, energyJ);
    maximumEnergyJ = Math.max(maximumEnergyJ, energyJ);
  }
  const measuredPeriodS = 2 * (crossings[1] - crossings[0]),
    analyticPeriodS = 2 * Math.PI * Math.sqrt(lengthM / 9.81);
  assert.ok(
    Math.abs(measuredPeriodS - analyticPeriodS) / analyticPeriodS < 0.04,
    `pendulum period ${measuredPeriodS} s missed ${analyticPeriodS} s`,
  );
  assert.ok(
    maximumEnergyJ - minimumEnergyJ < 0.08,
    `pendulum energy drifted by ${maximumEnergyJ - minimumEnergyJ} J`,
  );
}

console.log(
  `flexible-line solver prototype passed (catenary ${fineCatenary.centerSagM.toFixed(3)} m vs ${analyticSagM.toFixed(3)} m, shock ${shockA.peakN.toFixed(1)} N at tick ${shockA.firstTautTick})`,
);
