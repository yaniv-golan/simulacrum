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
    sha256: "4b84316e500da8e0ba9a1b8208560a6d7b90d783da5c17ff34d028d9ee0b4dd2",
    bytes: 152_622,
  },
  "demo:cart": {
    sha256: "f706f8fd648b621c81f9b9f8d8e972309b64a44dd851d12eedbfe9fd1e74cde3",
    bytes: 286_383,
  },
  "covariance:transformed-cart": {
    sha256: "e8c1c84423624dd5ffa416be016deeea39d73457d7dfb1a6e364fa48ea02bc3a",
    bytes: 294_704,
  },
  "demo:humanoid": {
    sha256: "09f968515b917da9a390ba3c0a0069d9bdf13843e33c1ca9dfc246676c44fb44",
    bytes: 229_371,
  },
  "demo:drone": {
    sha256: "f9ec5ce42b131ad44708af4e69d760dd84dbdc04708b654fffdb26d0be6d82a0",
    bytes: 246_769,
  },
  "demo:mission": {
    sha256: "77874be79ba1dade80938120e4da9dcf5bddcbc275ce442a7fba993eb63dd4f1",
    bytes: 788_496,
  },
  "mechanism:Rigid axle suspension": {
    sha256: "b5a2311906c63c13b0a6d8a312bd4e478b1dd6e77159c45b17da68d56fe26e2f",
    bytes: 67_207,
  },
  "mechanism:Trailing arm suspension": {
    sha256: "ba316b6c99f912715ae5cad9a1c761e8df7889b3308496a1d45ddc3237ea7778",
    bytes: 50_883,
  },
  "mechanism:Double wishbone corner": {
    sha256: "d97c8341de45ababd6c634d6443eb828802c1407e49817b196773e0755b3591d",
    bytes: 88_775,
  },
  "mechanism:Rocker-bogie suspension": {
    sha256: "d5f20788c2b73f8ed19ed2fd9bd3edbd64750749de340ff5b0da64fb9b0e6bcc",
    bytes: 116_871,
  },
  "mechanism:Active leveling suspension": {
    sha256: "aa827fad2c3676ff2cc56449a235f10f837abd41a6774bcaa58b1355a9fd84ae",
    bytes: 156_158,
  },
  "mechanism:Four-wheel central tire inflation system": {
    sha256: "edf2e52cd257f2d936af4861817486ae7d6e50378a9b03084fe962b1fe9c5d74",
    bytes: 322_019,
  },
  "hybrid:wheeled-rocket": {
    sha256: "1a11ce3667135ad520ec93330486b17013d605a37fa87bb761fdb9aeef8c0514",
    bytes: 298_875,
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
