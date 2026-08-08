import assert from "node:assert/strict";
import { compileAssembly } from "./lib/compile-assembly.mjs";

const port = (id, behavior, multiplicity = "one") => ({
  id,
  kind: "mechanical",
  behavior,
  direction: "bidirectional",
  multiplicity,
});

const originFrame = {
    position: { kind: "constant-v1", value: [0, 0, 0] },
    orientation: [0, 0, 0, 1],
  },
  boxPrimitive = (id) => ({
    id,
    frame: originFrame,
    geometry: {
      kind: "box-v1",
      fullSize: { kind: "config-vector-v1", field: "size" },
    },
    semanticKey: id,
    materialKey: "test-anchor",
    contactRole: "structure",
    approximationOf: null,
  });

const catalog = {
  anchor: {
    mass: 10,
    size: [1, 1, 1],
    ports: [port("MOUNT", "structural-surface", "many")],
    geometryContract: {
      schemaVersion: 1,
      kind: "primitive-component-geometry-v1",
      geometryClass: "rigid-static-v1",
      dimensionalScalingPolicy: "axis-aligned-affine-v1",
      portFrames: { MOUNT: originFrame },
      collisionPrimitives: [boxPrimitive("collision")],
      bodyPrimitives: [boxPrimitive("body")],
      physicalFeatures: [],
    },
  },
  line: {
    ports: [
      port("END_A", "flexible-termination"),
      port("END_B", "flexible-termination"),
    ],
    flexibleLine: {
      kind: "flexible-line-v1",
      endpointPortA: "END_A",
      endpointPortB: "END_B",
      initialAxisPart: [0, -1, 0],
      maximumElementCount: 64,
    },
    geometryContract: {
      schemaVersion: 1,
      kind: "flexible-line-component-geometry-v1",
      geometryClass: "runtime-flexible-v1",
      dimensionalScalingPolicy: "fixed-authored-size-v1",
      portFrames: {
        END_A: {
          position: { kind: "flexible-endpoint-v1", endpoint: "a" },
          orientation: [0, 1, 0, 0],
        },
        END_B: {
          position: { kind: "flexible-endpoint-v1", endpoint: "b" },
          orientation: [0, 0, 0, 1],
        },
      },
      collisionPrimitives: [],
      bodyPrimitives: [],
      physicalFeatures: [],
    },
  },
};

const lineConfig = {
  lengthM: 4,
  diameterM: 0.04,
  linearDensityKgPerM: 0.3,
  axialStiffnessNPerM: 20_000,
  axialDampingNsPerM: 80,
  ultimateTensionN: 12_000,
  targetElementLengthM: 0.5,
  materialKey: "test-rope",
};

const part = (id, type, pos, config = {}, orientation = [0, 0, 0, 1]) => ({
  id,
  type,
  pos,
  orientation,
  scale: [1, 1, 1],
  config,
});

const capacity = { ultimateForceN: 20_000, ultimateTorqueNm: 5_000 };
const connection = (id, lineId, linePort, anchorId) => ({
  id,
  kind: "mechanical",
  a: lineId,
  b: anchorId,
  portA: linePort,
  portB: "MOUNT",
  anchorA: null,
  anchorB: [0, 0, 0],
  capacity,
  failed: false,
});

{
  const compiled = compileAssembly(
    {
      revision: 1,
      parts: [part("line-1", "line", [0, 3, 0], lineConfig)],
      connections: [],
    },
    catalog,
  );
  assert.equal(compiled.flexibleLines.length, 1);
  assert.equal(compiled.bodies.length, 0, "flexible source got a rigid proxy");
  assert.equal(compiled.flexibleLines[0].entities.length, 9);
  assert.equal(compiled.flexibleLines[0].internalEdges.length, 8);
  assert.equal(compiled.flexibleLines[0].totalMassKg, 1.2);
  assert.equal(compiled.stats.totalMass, 1.2);
  assert.deepEqual(
    compiled.flexibleLines[0].attachments.map(({ kind }) => kind),
    ["free-v1", "free-v1"],
  );
}

{
  const parts = [
      part("line-1", "line", [0, 3, 0], lineConfig),
      part("top", "anchor", [0, 5, 0], { mass: 10, size: [1, 1, 1] }),
      part("bottom", "anchor", [0, 1, 0], {
        mass: 10,
        size: [1, 1, 1],
      }),
    ],
    connections = [
      connection("attach-a", "line-1", "END_A", "top"),
      connection("attach-b", "line-1", "END_B", "bottom"),
    ],
    compiled = compileAssembly({ revision: 2, parts, connections }, catalog),
    line = compiled.flexibleLines[0];
  assert.equal(compiled.diagnostics.length, 0);
  assert.deepEqual(
    line.attachments.map(({ targetPartId }) => targetPartId),
    ["top", "bottom"],
  );
  assert.deepEqual(line.entities[0].positionWorldM, [0, 5, 0]);
  assert.deepEqual(line.entities.at(-1).positionWorldM, [0, 1, 0]);
  assert.equal(
    compiled.constraints.length,
    0,
    "flexible endpoint connections leaked into rigid constraints",
  );
  assert.equal(compiled.stats.totalMass, 21.2);
}

{
  const rope = part("line-1", "line", [2, 2, 0], lineConfig, [
      0,
      0,
      Math.SQRT1_2,
      Math.SQRT1_2,
    ]),
    support = part("support", "anchor", [0, 2, 0], {
      mass: 10,
      size: [1, 1, 1],
    }),
    compiled = compileAssembly(
      {
        parts: [rope, support],
        connections: [connection("attach-a", rope.id, "END_A", support.id)],
      },
      catalog,
    ),
    line = compiled.flexibleLines[0];
  assert.deepEqual(line.entities[0].positionWorldM, [0, 2, 0]);
  assert.deepEqual(
    line.entities.at(-1).positionWorldM,
    [4, 2, 0],
    "a one-ended line ignored its authored center and spawned through its target",
  );
}

{
  const invalid = compileAssembly(
    {
      parts: [
        part("line-1", "line", [0, 0, 0], {
          ...lineConfig,
          lengthM: 0,
        }),
      ],
      connections: [],
    },
    catalog,
  );
  assert.equal(invalid.diagnostics[0].code, "INVALID_FLEXIBLE_LINE_CONFIG");
  assert.equal(invalid.flexibleLines, undefined);
}

{
  const rope = part("line-1", "line", [0, 3, 0], lineConfig),
    support = part("support", "anchor", [0, 3, 0], {
      mass: 10,
      size: [1, 1, 1],
    }),
    first = connection("attach-a", rope.id, "END_A", support.id),
    second = connection("attach-b", rope.id, "END_B", support.id);
  first.anchorB = [0, 2, 0];
  second.anchorB = [0, -2, 0];
  const compiled = compileAssembly(
    { parts: [rope, support], connections: [first, second] },
    catalog,
  );
  assert.equal(compiled.diagnostics.length, 0);
  assert.deepEqual(
    compiled.flexibleLines[0].entities[0].positionWorldM,
    [0, 5, 0],
  );
  assert.deepEqual(
    compiled.flexibleLines[0].entities.at(-1).positionWorldM,
    [0, 1, 0],
  );
}

console.log("flexible-line compiler contract passed");
