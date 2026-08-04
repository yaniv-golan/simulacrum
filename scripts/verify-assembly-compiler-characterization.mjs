import assert from "node:assert/strict";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { builtInMechanismSubassemblies } from "../src/model/built-in-mechanism-subassemblies.js";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import {
  DEFAULT_WAT_SOURCE,
  DRONE_TS_SOURCE,
  MISSION_TS_SOURCE,
} from "../src/application/content.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import {
  quaternionFromEulerXYZ,
  rotateVectorByQuaternion,
} from "../src/model/primitives.js";
import { sha256Hex } from "../src/model/sha256.js";
import { instantiateSubassembly } from "../src/model/subassemblies.js";

const GOLDEN_DIGESTS = Object.freeze({
  "demo:gearbox": {
    sha256: "d775c991aeb53c0e8cdf00ab35cdf38c89ae61c54e5b4b82cfaf269bf64fcadf",
    bytes: 143_459,
  },
  "demo:cart": {
    sha256: "0fc947d16f2077a7dda9129d5d790b0ce044e33486474ae8689ebf1d46f29fe9",
    bytes: 278_149,
  },
  "covariance:transformed-cart": {
    sha256: "2b83b7fac6850d094477a8eb55ed005714695a82f9d36a4e7f899dc1b69e25c0",
    bytes: 284_414,
  },
  "demo:humanoid": {
    sha256: "8385ddfa2b7250377e93e2563c18599717cd1bef1ce8c83258dd86b603c2167e",
    bytes: 219_003,
  },
  "demo:drone": {
    sha256: "a0291bfece7d1b39490650abcf99060530fdc5b36ee9e99a1015a6be0ad3e1a6",
    bytes: 236_394,
  },
  "demo:mission": {
    sha256: "5b74d35e71b58a0abe60d5b3fb198fa3dbd95d7bee2eec2a1c3b62bc07bf509a",
    bytes: 769_649,
  },
  "mechanism:Rigid axle suspension": {
    sha256: "2e99102baf2292c5b36cef79d706b01a969ffa82c5868f0c69cd256acfed8c74",
    bytes: 65_130,
  },
  "mechanism:Trailing arm suspension": {
    sha256: "949db10b97f32726f9297ce3c8a096cf425288bbcaa2cda363df4e85355e7962",
    bytes: 49_303,
  },
  "mechanism:Double wishbone corner": {
    sha256: "246389329fdecdbfd953758f64710ae7a8abbb28207bcbc4dfe1f88982313d29",
    bytes: 85_589,
  },
  "mechanism:Rocker-bogie suspension": {
    sha256: "c2887f6d72cbcd881efe438f915228c2bef35922b685fe44a7a8fef954f2b39a",
    bytes: 112_584,
  },
  "mechanism:Active leveling suspension": {
    sha256: "14a3ae39bb09daacadb0628a74abef6470a4ea69e420e4834bc2eb52f9a53212",
    bytes: 153_738,
  },
  "mechanism:Four-wheel central tire inflation system": {
    sha256: "a12c44ce6f18f2e8c0e58b61462cd06e3c1b28e9a5057a7422784ffa09bd2260",
    bytes: 310_303,
  },
  "hybrid:wheeled-rocket": {
    sha256: "9a0a64311e70c968942cb5ccaa2492528c2c7308e0407d9aa4b9b620be73524f",
    bytes: 290_641,
  },
  "diagnostic:dangling-connection": {
    sha256: "57e0e3ce2d98210f5badbdfdf08ce69602edc96dddc5fc66154f9ae17dfa9fb0",
    bytes: 4_601,
  },
});

const DEMO_SOURCES = Object.freeze({
  wat: DEFAULT_WAT_SOURCE,
  typescript: MISSION_TS_SOURCE,
  droneTypescript: DRONE_TS_SOURCE,
});

function exactCompiledEncoding(value) {
  return JSON.stringify(value, (_key, item) =>
    item === undefined ? { __simulacrum_compiler_undefined__: true } : item,
  );
}

function multiplyQuaternion(left, right) {
  const [ax, ay, az, aw] = left,
    [bx, by, bz, bw] = right;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function transformed(snapshot) {
  const orientation = quaternionFromEulerXYZ([0.31, -0.47, 0.68]),
    translation = [4.2, -1.7, 2.3];
  return {
    ...structuredClone(snapshot),
    parts: snapshot.parts.map((part) => ({
      ...structuredClone(part),
      pos: rotateVectorByQuaternion(part.pos, orientation).map(
        (value, axis) => value + translation[axis],
      ),
      orientation: multiplyQuaternion(orientation, part.orientation),
    })),
  };
}

function wheeledRocketFixture() {
  const cart = decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly,
    mission = decodeBlueprintOrThrow(
      builtInDemo("mission", DEMO_SOURCES).blueprint,
    ).assembly,
    missionCompiled = compileAssembly(mission, TYPES),
    snapshot = structuredClone(cart),
    chassis = snapshot.parts[0],
    controller = snapshot.parts.find((part) => part.scriptSources),
    axialBody = missionCompiled.bodies.find(
      (body) => body.capabilities?.propulsion?.kind === "pressure-nozzle-v1",
    ),
    sourceThruster = mission.parts.find(
      (part) => part.id === axialBody?.partId,
    ),
    sourceTank = mission.parts.find((part) => part.type === "propellanttank"),
    nextId = Math.max(...snapshot.parts.map((part) => part.id)) + 1,
    thruster = {
      ...structuredClone(sourceThruster),
      id: nextId,
      pos: [0, 1.8, 1],
    },
    tank = {
      ...structuredClone(sourceTank),
      id: nextId + 1,
      pos: [0, 1.8, -1],
    },
    capacity = structuredClone(
      snapshot.connections.find((connection) => connection.capacity).capacity,
    );
  snapshot.parts.push(thruster, tank);
  snapshot.connections.push(
    {
      id: "characterization-hybrid-mount",
      a: chassis.id,
      b: thruster.id,
      kind: "mechanical",
      portA: "TOP",
      portB: "MOUNT",
      capacity,
    },
    {
      id: "characterization-hybrid-signal",
      a: controller.id,
      b: thruster.id,
      kind: "signal",
      portA: "OUT",
      portB: "SIGNAL",
    },
    {
      id: "characterization-hybrid-tank-mount",
      a: chassis.id,
      b: tank.id,
      kind: "mechanical",
      portA: "TOP",
      portB: "MOUNT",
      capacity,
    },
    {
      id: "characterization-hybrid-resource",
      a: tank.id,
      b: thruster.id,
      kind: "resource",
      portA: "OUTLET",
      portB: "PROPELLANT",
      transport: { kind: "finite-allocation-v1" },
    },
  );
  return snapshot;
}

function diagnosticFixture() {
  const plate = structuredClone(
    decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly.parts[0],
  );
  return {
    revision: 4,
    parts: [{ ...plate, id: 1, pos: [0, 1, 0] }],
    connections: [
      {
        id: "dangling-characterization",
        a: 1,
        b: 999,
        kind: "mechanical",
        portA: "TOP",
        portB: "MOUNT",
        capacity: {
          ultimateForceN: 24_000,
          ultimateTorqueNm: 6_000,
        },
      },
    ],
  };
}

const fixtures = new Map();
for (const kind of ["gearbox", "cart", "humanoid", "drone", "mission"]) {
  const snapshot = decodeBlueprintOrThrow(
    builtInDemo(kind, DEMO_SOURCES).blueprint,
  ).assembly;
  fixtures.set(`demo:${kind}`, snapshot);
  if (kind === "cart")
    fixtures.set("covariance:transformed-cart", transformed(snapshot));
}
for (const record of builtInMechanismSubassemblies()) {
  const instance = instantiateSubassembly(record.asset);
  fixtures.set(`mechanism:${record.asset.name}`, {
    revision: 4,
    parts: instance.parts,
    connections: instance.connections,
  });
}
fixtures.set("hybrid:wheeled-rocket", wheeledRocketFixture());
fixtures.set("diagnostic:dangling-connection", diagnosticFixture());

const observed = Object.fromEntries(
  [...fixtures].map(([name, snapshot]) => {
    const encoded = exactCompiledEncoding(compileAssembly(snapshot, TYPES));
    return [
      name,
      Object.freeze({
        sha256: sha256Hex(encoded),
        bytes: Buffer.byteLength(encoded),
      }),
    ];
  }),
);

assert.deepEqual(
  observed,
  GOLDEN_DIGESTS,
  "assembly compiler canonical output changed; inspect the semantic diff before updating the golden manifest",
);

console.log(
  `assembly compiler characterization passed (${fixtures.size} exact fixtures)`,
);
