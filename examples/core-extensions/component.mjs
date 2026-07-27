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
        geometryContract: {
          schemaVersion: 1,
          kind: "primitive-component-geometry-v1",
          geometryClass: "rigid-static-v1",
          dimensionalScalingPolicy: "axis-aligned-affine-v1",
          portFrames: {
            MOUNT: {
              position: { kind: "constant-v1", value: [0, 0, 0] },
              orientation: [0, 0, 0, 1],
            },
          },
          collisionPrimitives: [
            {
              id: "collision",
              frame: {
                position: { kind: "constant-v1", value: [0, 0, 0] },
                orientation: [0, 0, 0, 1],
              },
              geometry: {
                kind: "box-v1",
                fullSize: { kind: "config-vector-v1", field: "size" },
              },
              semanticKey: "collision",
              materialKey: "component-body",
              contactRole: "structure",
              approximationOf: null,
            },
          ],
          bodyPrimitives: [
            {
              id: "body",
              frame: {
                position: { kind: "constant-v1", value: [0, 0, 0] },
                orientation: [0, 0, 0, 1],
              },
              geometry: {
                kind: "box-v1",
                fullSize: { kind: "config-vector-v1", field: "size" },
              },
              semanticKey: "body",
              materialKey: "component-body",
              contactRole: "structure",
              approximationOf: null,
            },
          ],
          physicalFeatures: [],
        },
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
