import assert from "node:assert/strict";
import { compileAssembly } from "./lib/compile-assembly.mjs";
import { builtInMechanismSubassemblies } from "../src/model/built-in-mechanism-subassemblies.js";
import { TYPES } from "../src/model/component-catalog.js";
import { componentDefaults } from "../src/model/component-resolver.js";
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

const NON_RIGID_CANONICAL_GOLDEN_DIGESTS = Object.freeze({
  "demo:gearbox": {
    sha256: "fdb6778d034712ba4319f5e93de710ad59742ce477c33cc0aa6c8aead28cc47a",
    bytes: 153_462,
  },
  "demo:cart": {
    sha256: "deaa37c46a34bc790b7e22f7f1f26e5c3a8b7587db2aa7e50b599068e0dbd9a2",
    bytes: 288_255,
  },
  "covariance:transformed-cart": {
    sha256: "5069c20e268f29d25b3effd15e6e2a39f23efd4fb8653d522e8c8da49fb959c6",
    bytes: 296_576,
  },
  "demo:humanoid": {
    sha256: "d0d64f84a89a2557d38d5b72c12cb8add4792aa467dd73c089329752d09cf51b",
    bytes: 230_505,
  },
  "demo:drone": {
    sha256: "d901fa435a06c16c50ca43408b53f6e41e014e4775f8d4995b946418624adc0d",
    bytes: 248_482,
  },
  "demo:mission": {
    sha256: "32f77067b8191621b260ed66c59ce7074f36afc6c5a6e169fb191b8c7795e6b6",
    bytes: 789_885,
  },
  "mechanism:Rigid axle suspension": {
    sha256: "c407d9fc586b141f3566e3495b4cb3e03fcb98817009003f35d40aa7cc9e7d80",
    bytes: 67_675,
  },
  "mechanism:Trailing arm suspension": {
    sha256: "c34e60875b500933ebfacf3d09c6acbb67e975b3a1ed4edba3f78ae103834a05",
    bytes: 51_309,
  },
  "mechanism:Double wishbone corner": {
    sha256: "2600df4036fc83617773307778c906ee93eeaad48345679d516bd915334da56e",
    bytes: 89_453,
  },
  "mechanism:Rocker-bogie suspension": {
    sha256: "86ff5f5b65cbbbb863e99c0b815a4014a69488e6f3affebdeade218412ebc4e7",
    bytes: 117_417,
  },
  "mechanism:Active leveling suspension": {
    sha256: "897d3e05f8228a09e23b48c52b008c1523672c0e55fc3c8eebd05333e6f33e75",
    bytes: 158_042,
  },
  "mechanism:Four-wheel central tire inflation system": {
    sha256: "f7f2dcb4b2d5c44a42243799a29975eaf172fa9f7610cf17b2062a9983f03521",
    bytes: 323_027,
  },
  "hybrid:wheeled-rocket": {
    sha256: "1bd09f1ac2e87a2c81d9702c2f9b142e34b71470f56785e076a961b199f29651",
    bytes: 300_747,
  },
  "diagnostic:dangling-connection": {
    sha256: "57e0e3ce2d98210f5badbdfdf08ce69602edc96dddc5fc66154f9ae17dfa9fb0",
    bytes: 4_601,
  },
  "identity:ordinary-string-chain": {
    sha256: "b0a702636d77094e7f56276309ee36838ad7d9a5f02c69300e3671f20b757972",
    bytes: 14_092,
  },
});

const GOLDEN_DIGESTS = Object.freeze({
  "demo:gearbox": {
    sha256: "bfc0bba6c8e0c62cdfa18e75557968ee667c7a3d9dffe9964fa7861c1ff276ff",
    bytes: 174_930,
  },
  "demo:cart": {
    sha256: "f03dce27027bb1e7f8c0fe49ffb1109eee903d6f8075cbee19d170d592f26a89",
    bytes: 340_974,
  },
  "covariance:transformed-cart": {
    sha256: "2ca71f4987df25cb861148180d57bfef036d80de6d0854d19d9b453fa0f9ca97",
    bytes: 351_260,
  },
  "demo:humanoid": {
    sha256: "6d27f7bcfe6b2e5aa640d3fa7e9e38e21d6b1a2c36d8c66117fdcc536ab0fa3b",
    bytes: 285_586,
  },
  "demo:drone": {
    sha256: "656615eda31f7c338ade0e01560b5a566024fe43dfd04b0e3cd03b7148099faf",
    bytes: 292_122,
  },
  "demo:mission": {
    sha256: "b7d27bd0e50e4498563547caf1ab10d0e3b519ac8aeb94d08633171fbb73d065",
    bytes: 852_104,
  },
  "mechanism:Rigid axle suspension": {
    sha256: "3e82916f473f3d1ba201e668077a3110fce109c96ad635be131b2fdc8cc806d5",
    bytes: 82_329,
  },
  "mechanism:Trailing arm suspension": {
    sha256: "843c2e6e81283b8039dd17894aa11b0b435e5176cc5d38473019400587c15096",
    bytes: 64_383,
  },
  "mechanism:Double wishbone corner": {
    sha256: "a05ef4df5ff38a5505e1148f75f72013977ab07e8182afcd5dde62afb909ee46",
    bytes: 112_378,
  },
  "mechanism:Rocker-bogie suspension": {
    sha256: "bde7c8608bf413f8b51b8b382d3034fee584f8000afb847df70396e080995a6f",
    bytes: 144_015,
  },
  "mechanism:Active leveling suspension": {
    sha256: "7f2a7c09274ff9d3ea671fee0136b503bb9be85137f903860d966beaaecc70ea",
    bytes: 189_524,
  },
  "mechanism:Four-wheel central tire inflation system": {
    sha256: "8c050b69de7a071003abe59bc37bdb210ccfed663472142292306ca61e5a5830",
    bytes: 370_708,
  },
  "hybrid:wheeled-rocket": {
    sha256: "967daf699c35ae61390598c4a213bb3559553b450ba979fcc8a10e9960fee639",
    bytes: 356_869,
  },
  "diagnostic:dangling-connection": {
    sha256: "90b558c94dedc8cfdf58b5084bb3ab2a5cb93fb592f5dbdd7badd036e1defc3c",
    bytes: 6_271,
  },
  "identity:ordinary-string-chain": {
    sha256: "b7e9843a19ae6926a459999782e46d21b0a47f4bc5c2b4abbbac88b9448ef7c9",
    bytes: 19_430,
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
      capacity: structuredClone(capacity),
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
      capacity: structuredClone(capacity),
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

function ordinaryStringIdentityFixture() {
  const part = (id, x) => ({
      id,
      type: "beam",
      pos: [x, 0, 0],
      orientation: [0, 0, 0, 1],
      config: componentDefaults("beam"),
    }),
    capacity = {
      ultimateForceN: 10_000,
      ultimateTorqueNm: 2_000,
    };
  return {
    revision: 1,
    parts: [part("a", 0), part("b", 2.4), part("c", 4.8)],
    connections: [
      {
        id: "ab",
        a: "a",
        b: "b",
        kind: "mechanical",
        portA: "B",
        portB: "A",
        capacity: structuredClone(capacity),
      },
      {
        id: "bc",
        a: "b",
        b: "c",
        kind: "mechanical",
        portA: "B",
        portB: "A",
        capacity: structuredClone(capacity),
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
fixtures.set("identity:ordinary-string-chain", ordinaryStringIdentityFixture());

const compiledFixtures = [...fixtures].map(([name, snapshot]) => [
    name,
    compileAssembly(snapshot, TYPES),
  ]),
  digest = (value) => {
    const encoded = exactCompiledEncoding(value);
    return Object.freeze({
      sha256: sha256Hex(encoded),
      bytes: Buffer.byteLength(encoded),
    });
  },
  observed = Object.fromEntries(
    compiledFixtures.map(([name, compiled]) => [name, digest(compiled)]),
  ),
  nonRigidCanonicalObserved = Object.fromEntries(
    compiledFixtures.map(([name, compiled]) => {
      const nonRigidCanonical = { ...compiled },
        nonRigidCanonicalStats = { ...compiled.stats };
      delete nonRigidCanonical.rigidClusters;
      delete nonRigidCanonicalStats.rigidClusterCount;
      nonRigidCanonical.stats = nonRigidCanonicalStats;
      return [name, digest(nonRigidCanonical)];
    }),
  );

for (const [fixtureName, compiled] of compiledFixtures)
  for (const cluster of compiled.rigidClusters) {
    const rootMember = cluster.members.find(
      (member) => member.partId === cluster.rootPartId,
    );
    assert.deepEqual(
      rootMember?.positionClusterM,
      [0, 0, 0],
      `${fixtureName} derived a second floating position authority for its rigid-cluster root`,
    );
    assert.deepEqual(
      rootMember?.orientationCluster,
      [0, 0, 0, 1],
      `${fixtureName} derived a second floating orientation authority for its rigid-cluster root`,
    );
  }

assert.deepEqual(
  nonRigidCanonicalObserved,
  NON_RIGID_CANONICAL_GOLDEN_DIGESTS,
  "assembly compiler non-rigid canonical projection changed; inspect the semantic diff before updating the golden manifest",
);

assert.deepEqual(
  observed,
  GOLDEN_DIGESTS,
  "assembly compiler canonical output changed; inspect the semantic diff before updating the golden manifest",
);

console.log(
  `assembly compiler characterization passed (${fixtures.size} exact fixtures)`,
);
