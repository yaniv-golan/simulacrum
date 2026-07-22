import {
  TYPES,
  compileAssembly,
  geometryDescriptorForType,
} from "@yaniv-golan/simulacrum-core";

export function componentExample() {
  const catalog = {
      ...TYPES,
      ballastPod: {
        name: "Ballast Pod",
        mass: 12,
        size: [0.8, 0.5, 0.8],
        ports: [
          {
            id: "MOUNT",
            kind: "mechanical",
            behavior: "fixed",
            direction: "bidirectional",
            multiplicity: "one",
          },
        ],
      },
    },
    descriptor = geometryDescriptorForType("ballastPod", catalog),
    topology = compileAssembly(
      {
        revision: 1,
        parts: [
          {
            id: 1,
            type: "ballastPod",
            pos: [0, 1, 0],
            orientation: [0, 0, 0, 1],
            scale: { x: 1, y: 1, z: 1 },
            config: {},
          },
        ],
        connections: [],
      },
      catalog,
    );
  return { catalog, descriptor, topology };
}
