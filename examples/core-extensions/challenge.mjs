import { ChallengeRun, componentDefaults } from "@yaniv-golan/simulacrum-core";

export function challengeExample() {
  const machine = {
      parts: [
        {
          id: 0,
          type: "motor",
          pos: [0, 0, -0.92],
          orientation: [0, 0, 0, 1],
          scale: { x: 1, y: 1, z: 1 },
          config: { ...componentDefaults("motor"), mass: 3 },
        },
        {
          id: 1,
          type: "gear12",
          pos: [0, 0, 0],
          orientation: [0, 0, 0, 1],
          scale: { x: 1, y: 1, z: 1 },
          config: { ...componentDefaults("gear12"), mass: 2 },
        },
        {
          id: 2,
          type: "gear24",
          pos: [1.355, 0, 0],
          orientation: [0, 0, 0, 1],
          scale: { x: 1, y: 1, z: 1 },
          config: { ...componentDefaults("gear24"), mass: 4 },
        },
      ],
      connections: [
        {
          id: "drive",
          a: 0,
          b: 1,
          portA: "SHAFT",
          portB: "AXLE",
          kind: "mechanical",
          capacity: { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 },
        },
        {
          id: "mesh",
          a: 1,
          b: 2,
          portA: "MESH",
          portB: "MESH",
          kind: "mesh",
          capacity: { ultimateForceN: 12_000, ultimateTorqueNm: 3_000 },
        },
      ],
    },
    run = new ChallengeRun(
      {
        id: "two-to-one-reduction",
        objective: { kind: "gear-ratio", ratio: 2, holdS: 1 },
        constraints: {},
      },
      machine,
    ),
    frame = {
      time: 1,
      systems: {
        mechanisms: {
          poses: [
            { id: 1, phase: 4 },
            { id: 2, phase: -2 },
          ],
        },
      },
    },
    binding = run.resolveBinding(frame);
  return run.step(
    {
      ...frame,
      systems: { ...frame.systems, challengeBinding: binding },
    },
    1,
  );
}
