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
    sha256: "7cd1530cf347c04dd9fb1de0d89f45b513cdf1fee48392c76a21d8b0e1e1baf4",
    bytes: 47_367,
  },
  "demo:cart": {
    sha256: "8817ded0907493f14464c82ad216de81bb53da2cd936b01453a0c38a343f8b7c",
    bytes: 271_181,
  },
  "covariance:transformed-cart": {
    sha256: "7d0534c504d11057165babc99acd1be19f3018bccd32eed852f8edd0d19f4ec8",
    bytes: 277_446,
  },
  "demo:humanoid": {
    sha256: "22efec587ec4e9739905805c4b1d3b4212d75721088aa2e8172bebbfd8d54962",
    bytes: 216_395,
  },
  "demo:drone": {
    sha256: "6749cd197fa8cdf071db1cd1338bc1093127b036f517520c82682da304c3f309",
    bytes: 232_019,
  },
  "demo:mission": {
    sha256: "c71847384fed3261dd9858943613b15926a87fa78c3949cb54ffb78c0ea1f00a",
    bytes: 763_621,
  },
  "mechanism:Rigid axle suspension": {
    sha256: "2bb8d8bce0fc8bda18efe1bfd3cd2f595b3e71499d43895e039da61d74419f13",
    bytes: 63_839,
  },
  "mechanism:Trailing arm suspension": {
    sha256: "b25d2900c5806b5105565f03ddd4a41e8e7774f3d3992d066fbdbe478e0eee88",
    bytes: 48_854,
  },
  "mechanism:Double wishbone corner": {
    sha256: "3e1fa7a16967461867180fc8159eaaaa3da188c164d7a3e03edb45cc75c1defb",
    bytes: 85_050,
  },
  "mechanism:Rocker-bogie suspension": {
    sha256: "67a306fd23a391bb3c1b3eb6b15e577149f5bfba8b9fdc8e4929bd39e6db5d1d",
    bytes: 111_372,
  },
  "mechanism:Active leveling suspension": {
    sha256: "3ed814a669b338ecdb7d08f6b3d603d9204d2ad0e7fb4af9dbfad52ffb18fd51",
    bytes: 151_666,
  },
  "mechanism:Four-wheel central tire inflation system": {
    sha256: "89abd093c3a865935f647af32de553c04a7d9b5a085c7641b0e501225f20ca11",
    bytes: 295_517,
  },
  "hybrid:wheeled-rocket": {
    sha256: "ae2ef94a6b1de0c76e35094de6029c73c14dab63b48c48e32760f8106005b141",
    bytes: 283_667,
  },
  "diagnostic:dangling-connection": {
    sha256: "2fe85161a222a495c7ed32b603195666291a4e2c25ed9ac7984814cf0489615f",
    bytes: 4_556,
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
