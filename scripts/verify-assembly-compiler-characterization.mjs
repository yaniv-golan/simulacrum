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
    sha256: "64db156805677fbb14ff847b7ddf8feb12995588ffc496851012549007f1cd9d",
    bytes: 45_929,
  },
  "demo:cart": {
    sha256: "da641080cf469926086548ff59c00c29fe201961201ecefcd62205418c9c05fb",
    bytes: 266_701,
  },
  "covariance:transformed-cart": {
    sha256: "7622d653dd0276d5a56d19133f07841ec7492a5a146ec92e106c6f91440e962d",
    bytes: 272_966,
  },
  "demo:humanoid": {
    sha256: "4285c1ed40f2b955d083d2763436707606b05661bb7fb626d31fd250cb84f313",
    bytes: 207_232,
  },
  "demo:drone": {
    sha256: "d524b87bb6c9f77c747fff56769d7e96b054877082cc2270de78a25c3cc4d951",
    bytes: 228_317,
  },
  "demo:mission": {
    sha256: "681775a4ff3e9feea0fd90b799427167bb9b0d8d4d92bd5c1f60248b5e69da2a",
    bytes: 754_358,
  },
  "mechanism:Rigid axle suspension": {
    sha256: "509dc66523ac427638f73a210cf22ebbfe27bf1d49997ba6ef35ee7a3bc9e6fe",
    bytes: 63_493,
  },
  "mechanism:Trailing arm suspension": {
    sha256: "0aa6b437a6b9255225001c444f6b692d8d2aab9b3b36fc07bcefd4bbfa58d0f3",
    bytes: 47_998,
  },
  "mechanism:Double wishbone corner": {
    sha256: "6989832dd1db4e2dc11f4e8662d6dac172379a43d2a310f7b1f4e135e845aed2",
    bytes: 81_704,
  },
  "mechanism:Rocker-bogie suspension": {
    sha256: "24d74ded7f82d030707a3e1f295ee4de4acc59c3c97fb677814cf3393c117a20",
    bytes: 109_690,
  },
  "mechanism:Active leveling suspension": {
    sha256: "21aaacb0768f434540d0922811f4599169ba7c75ab1fc1b3d2890c088c66dbe5",
    bytes: 153_018,
  },
  "mechanism:Four-wheel central tire inflation system": {
    sha256: "45aea247088bca5c34e35acb7ebc0b0b9391401053b7d22bab5e74ba4116d6af",
    bytes: 294_624,
  },
  "hybrid:wheeled-rocket": {
    sha256: "8d34162261ca7faddcc37654d1f5d394164183b15a856479a30f2cdf00f064b7",
    bytes: 277_943,
  },
  "diagnostic:dangling-connection": {
    sha256: "f19c571d658cc2faebaa0dec3e6fde6b9e881bb5005a6f78abd7f7bc1b0cd70c",
    bytes: 4_532,
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
