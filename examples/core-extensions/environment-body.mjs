import {
  EnvironmentBodyRegistry,
  measureEnvironmentProximity,
} from "@yaniv-golan/simulacrum-core";

export function environmentBodyExample() {
  const registry = new EnvironmentBodyRegistry([
    {
      id: "environment:inspection-target",
      frame: "local-world-v1",
      geometry: { kind: "sphere-v1", radiusM: 2 },
      queryKinds: ["sensing"],
      pose: {
        positionM: [0, 50, 0],
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
      velocityMps: [0, -1, 0],
    },
  ]);
  return measureEnvironmentProximity({
    sensorPose: { position: { x: 0, y: 0, z: 0 } },
    sensorVelocity: { x: 0, y: 1, z: 0 },
    axis: { x: 0, y: 1, z: 0 },
    fieldOfViewDeg: 10,
    maximumRangeM: 100,
    rangeResolutionM: 0.25,
    environmentBodies: registry.snapshot(),
  });
}
