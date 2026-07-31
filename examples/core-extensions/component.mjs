import {
  TYPES,
  compileAssembly,
  geometryDescriptorForType,
} from "@yaniv-golan/simulacrum-core";

/** Minimal data-only orthographic renderer; no DOM, Three.js, or game runtime. */
function renderDescriptorToSvg(descriptor) {
  const shapes = descriptor.bodyPrimitives.map((primitive) => {
    if (primitive.geometry.kind !== "rounded-box-v1")
      throw new Error(`Unsupported SVG primitive ${primitive.geometry.kind}`);
    const [widthM, heightM] = primitive.geometry.fullSizeM,
      [xM, yM] = primitive.framePart.positionM,
      scale = 100;
    return `<rect data-primitive="${primitive.id}" x="${(xM - widthM / 2) * scale}" y="${(-yM - heightM / 2) * scale}" width="${widthM * scale}" height="${heightM * scale}" rx="${primitive.geometry.radiusM * scale}" />`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">${shapes.join("")}</svg>`;
}

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
                kind: "rounded-box-v1",
                fullSize: { kind: "config-vector-v1", field: "size" },
                radiusM: 0.06,
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
    ),
    nonGameSvg = renderDescriptorToSvg(descriptor);
  return { catalog, descriptor, topology, nonGameSvg };
}
