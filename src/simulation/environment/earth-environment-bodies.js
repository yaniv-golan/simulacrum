import { KARMAN_LINE_M } from "./earth.js";
import { EnvironmentBodyRegistry } from "./environment-body-registry.js";

export const NEAR_SPACE_BODY_ID = "environment:near-space-body:001";

/** Creates the ordinary physical bodies authored into the default Earth world. */
export function createEarthEnvironmentBodyRegistry({
  karmanLineM = KARMAN_LINE_M,
} = {}) {
  return new EnvironmentBodyRegistry([
    {
      id: NEAR_SPACE_BODY_ID,
      frame: "earth-tangent-global-v1",
      geometry: { kind: "sphere-v1", radiusM: 12 },
      queryKinds: ["sensing"],
      pose: {
        positionM: [-100, karmanLineM, 0],
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
      velocityMps: [0, 0, 0],
    },
  ]);
}
