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
    sha256: "87e6467a59bfe8d678f2ed6eb24bcd1407c046c5ec0bd0b08b33033a1ee97ccb",
    bytes: 48_351,
  },
  "demo:cart": {
    sha256: "e35f14857fad8ca73377c4153fcb067d42ba6675b55bf667c04b1d92de7ec666",
    bytes: 276_534,
  },
  "covariance:transformed-cart": {
    sha256: "6ac37630aab0b51377efbe8dcec2e9a91675d9f913af6e35df35b6f756b79577",
    bytes: 282_799,
  },
  "demo:humanoid": {
    sha256: "6d01e42eb0b9dac6d413dbf4c17e2227fa179290de44d43f46c0e0d91669a5de",
    bytes: 218_018,
  },
  "demo:drone": {
    sha256: "528bc479f87ec783bd3ecc06e2e31e73b16fd107d440112a64a84955c2bafbbb",
    bytes: 234_779,
  },
  "demo:mission": {
    sha256: "ae07833971118a2b5e12a0d0877c291e0e38b0238214dd8078ecb4a5648f95be",
    bytes: 768_978,
  },
  "mechanism:Rigid axle suspension": {
    sha256: "5bebb900e975f03cc1f2af744fa3ba3a6867bbc8ca02597c76111599993aa4b6",
    bytes: 64_771,
  },
  "mechanism:Trailing arm suspension": {
    sha256: "569f419e2e24dfeb2e32ec1523621b5e3b1d5a3e21576be441b0550a4a32a96b",
    bytes: 48_944,
  },
  "mechanism:Double wishbone corner": {
    sha256: "384c6a1e238f68b564c847be96c32feefa1b58644a012802e9a3d74cf8601da7",
    bytes: 85_230,
  },
  "mechanism:Rocker-bogie suspension": {
    sha256: "7ecc8db9bdd3f798a4590a7c3c7e56b193f3eba67efba732a86c3507e7bbd131",
    bytes: 111_507,
  },
  "mechanism:Active leveling suspension": {
    sha256: "3d352cfbe845cedbc404ed1882269720094fd890a22b0644c018f292ea9001cf",
    bytes: 151_629,
  },
  "mechanism:Four-wheel central tire inflation system": {
    sha256: "05a396f9df014fa8729318aa1f3bb2cd73f623d88b205895086d4773157d31a3",
    bytes: 305_496,
  },
  "hybrid:wheeled-rocket": {
    sha256: "5313037884df05a8d3880587f4d16515d84e4577c1b0580c42167e05f81b87aa",
    bytes: 289_020,
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
