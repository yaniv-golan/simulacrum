// Numeric stress apparatus: nine supported rotors on a shared carrier. A small
// eccentric output mass supplies ordinary gravity load; optional rigid ballast
// expands native response size without changing the authored mesh topology.
export function gearCapacityFixture({ meshes = 8, bodies = 12 } = {}) {
  const body = (
    position,
    mass,
    shape = 'box',
    halfExtents = [0.01, 0.01, 0.01],
    fixed = false,
  ) => ({
    shape,
    position,
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mass,
    halfExtents,
    fixed,
    friction: 0.5,
    restitution: 0,
  });
  const config = {
    gravity: [0, -9.81, 0],
    bodies: [body([-0.1, 1, 0.72], 20, 'box', [0.04, 0.08, 0.8], true)],
    joints: [],
    power: {
      cells: [
        { node: 10, voltage: 2, capacityJ: 1000, initialJ: 1000, resistance: 0.1, currentLimit: 1 },
      ],
      motors: [
        {
          node: 0,
          body: 0,
          rotor: 1,
          joint: 0,
          defaultDuty: 1,
          axis: [1, 0, 0],
          torqueConstant: 0.4,
          resistance: 1,
          currentLimit: 0.05,
        },
      ],
      wires: [[10, 0]],
      signalWires: [],
      receivers: [],
      controllers: [],
      sensors: [],
    },
  };
  for (let i = 0; i < 9; i++) {
    const radius = i % 2 ? 0.12 : 0.06;
    config.bodies.push(
      body([0, 1, i * 0.18], 0.1, 'cylinder', [0.01, radius - 0.01, radius - 0.01]),
    );
    config.joints.push({
      kind: 'revolute',
      a: 0,
      b: i + 1,
      anchorA: [0.1, 0, i * 0.18 - 0.72],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
    });
  }
  config.bodies.push(body([-0.2, 1, 0.72], 1));
  config.joints.push({
    kind: 'fixed',
    a: 0,
    b: 10,
    anchorA: [-0.1, 0, 0],
    anchorB: [0, 0, 0],
    rotationA: [0, 0, 0, 1],
    rotationB: [0, 0, 0, 1],
  });
  config.bodies.push(body([0.03, 1, 1.48], 0.02));
  config.joints.push({
    kind: 'fixed',
    a: 9,
    b: 11,
    anchorA: [0.03, 0, 0.04],
    anchorB: [0, 0, 0],
    rotationA: [0, 0, 0, 1],
    rotationB: [0, 0, 0, 1],
  });
  for (let i = 0; i < meshes; i++)
    config.joints.push({
      kind: 'gear',
      a: i + 1,
      b: i + 2,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
      radiusA: i % 2 ? 0.12 : 0.06,
      radiusB: i % 2 ? 0.06 : 0.12,
      stiffness: 20000,
      damping: 20,
    });
  while (config.bodies.length < bodies) {
    const i = config.bodies.length,
      rotor = 1 + (i % 9),
      x = 0.06 + 0.03 * Math.floor(i / 9);
    config.bodies.push(body([x, 1, (rotor - 1) * 0.18], 0.015));
    config.joints.push({
      kind: 'fixed',
      a: rotor,
      b: i,
      anchorA: [x, 0, 0],
      anchorB: [0, 0, 0],
      rotationA: [0, 0, 0, 1],
      rotationB: [0, 0, 0, 1],
    });
  }
  return config;
}
