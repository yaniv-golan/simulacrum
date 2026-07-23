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
    sha256: "c441eb560e7469ac04f28b25cebceab9b443e7944343bca044c7f322f245c3f5",
    bytes: 39_102,
  },
  "demo:cart": {
    sha256: "a39b92c123885ae675c864f00f3aa71149398e9814e62e372256cdbfb11b9ca2",
    bytes: 266_644,
  },
  "covariance:transformed-cart": {
    sha256: "2eb6f0276528160ea7b6989f730d48a1d61506dd332265dc54cfd91a7ce5bb97",
    bytes: 273_896,
  },
  "demo:humanoid": {
    sha256: "554568e0714c07becddd81013bc1859cb0e9c334cbe097c10cc0f1997fe5147d",
    bytes: 194_905,
  },
  "demo:drone": {
    sha256: "84d019b7ed1a1c997dd543b8ca70e8ea5cf15501808be53b373a90c7d062787d",
    bytes: 238_073,
  },
  "demo:mission": {
    sha256: "72506dd44c86648a1ebf19c777bd25d209e177f462689713430972a02fda2d6e",
    bytes: 711_271,
  },
  "mechanism:Rigid axle suspension": {
    sha256: "d9ed1610a8b391f33f3a46ee68755802468aac3c3709cc6ba0140de5b83a4840",
    bytes: 67_061,
  },
  "mechanism:Trailing arm suspension": {
    sha256: "db701e1b3737c6e4faf699775b60cf1aa7f169632d7138be55578e1f9b092c54",
    bytes: 49_959,
  },
  "mechanism:Double wishbone corner": {
    sha256: "7ba5109c1cd252f7f9eb4f05779d8157488c323785a7a9d5ca6fe9649f7b7711",
    bytes: 84_862,
  },
  "mechanism:Rocker-bogie suspension": {
    sha256: "5dfa17fbcf2a1d02f76dac470e9ac36aef2cdba5abe7d77ce191b5e0d485670a",
    bytes: 118_775,
  },
  "mechanism:Active leveling suspension": {
    sha256: "9714b3b5fb7a19627d2a194ef6c339e5082e24700a9934da1b949ddcb15b0ff9",
    bytes: 142_222,
  },
  "hybrid:wheeled-rocket": {
    sha256: "b1d67af2a9615f6742ac30d4f142979f6da301b32f233ad15d6d4fcee3fc8127",
    bytes: 311_327,
  },
  "diagnostic:dangling-connection": {
    sha256: "5d4b06c761532366be24fee6af43330fee9525e4bff894d4deb04e72ee9b3118",
    bytes: 3_072,
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
