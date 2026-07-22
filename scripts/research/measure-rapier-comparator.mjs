import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const DT = 1 / 120;
const TOTAL_TICKS = 720;
const CHECKPOINT_TICK = 311;
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PACKAGE_ROOT = path.join(
  REPO_ROOT,
  "node_modules/@dimforge/rapier3d-compat",
);

function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function quaternionAngle(rotation) {
  return 2 * Math.acos(Math.min(1, Math.abs(rotation.w)));
}

function bodyState(body) {
  const position = body.translation();
  const rotation = body.rotation();
  const velocity = body.linvel();
  const angularVelocity = body.angvel();
  return [
    position.x,
    position.y,
    position.z,
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
    velocity.x,
    velocity.y,
    velocity.z,
    angularVelocity.x,
    angularVelocity.y,
    angularVelocity.z,
  ];
}

function stateDigest(body) {
  return digest(Buffer.from(new Float64Array(bodyState(body)).buffer));
}

function addDeterministicGuideInput(body, tick) {
  body.addForce(
    {
      x: 160 + 35 * Math.sin(tick * 0.071),
      y: -90 + 20 * Math.cos(tick * 0.037),
      z: 55 * Math.sin(tick * 0.053),
    },
    true,
  );
}

function createGuideWorld(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 8;
  world.numInternalPgsIterations = 2;

  const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const follower = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0, 0.25)
      .setAdditionalMass(12)
      .setCanSleep(false),
  );
  const joint = world.createImpulseJoint(
    RAPIER.JointData.prismatic(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ),
    base,
    follower,
    true,
  );
  joint.setLimits(-2, 2);
  return { world, follower, followerHandle: follower.handle };
}

function runGuideProbe(RAPIER) {
  const { world, follower } = createGuideWorld(RAPIER);
  let maxTransverseDriftM = 0;
  let maxAngularDriftRad = 0;
  for (let tick = 0; tick < 30 / DT; tick += 1) {
    addDeterministicGuideInput(follower, tick);
    world.step();
    const position = follower.translation();
    maxTransverseDriftM = Math.max(
      maxTransverseDriftM,
      Math.hypot(position.x, position.y),
    );
    maxAngularDriftRad = Math.max(
      maxAngularDriftRad,
      quaternionAngle(follower.rotation()),
    );
  }
  const result = {
    durationS: 30,
    maxTransverseDriftM,
    maxAngularDriftRad,
    finalAxialPositionM: follower.translation().z,
    finalAxialVelocityMPerS: follower.linvel().z,
  };
  world.free();
  return result;
}

function runSnapshotProbe(RAPIER) {
  const live = createGuideWorld(RAPIER);
  for (let tick = 0; tick < CHECKPOINT_TICK; tick += 1) {
    addDeterministicGuideInput(live.follower, tick);
    live.world.step();
  }
  const checkpoint = live.world.takeSnapshot();
  const expected = [];
  for (let tick = CHECKPOINT_TICK; tick < TOTAL_TICKS; tick += 1) {
    addDeterministicGuideInput(live.follower, tick);
    live.world.step();
    expected.push({
      state: stateDigest(live.follower),
      snapshot: digest(live.world.takeSnapshot()),
    });
  }

  const restoredWorld = RAPIER.World.restoreSnapshot(checkpoint);
  const restoredFollower = restoredWorld.getRigidBody(live.followerHandle);
  assert.ok(
    restoredFollower,
    "restored world must retain the rigid-body handle",
  );
  let equalStateTicks = 0;
  let equalSnapshotTicks = 0;
  for (let tick = CHECKPOINT_TICK; tick < TOTAL_TICKS; tick += 1) {
    addDeterministicGuideInput(restoredFollower, tick);
    restoredWorld.step();
    const index = tick - CHECKPOINT_TICK;
    if (stateDigest(restoredFollower) === expected[index].state) {
      equalStateTicks += 1;
    }
    if (digest(restoredWorld.takeSnapshot()) === expected[index].snapshot) {
      equalSnapshotTicks += 1;
    }
  }

  const result = {
    checkpointTick: CHECKPOINT_TICK,
    resumedTicks: TOTAL_TICKS - CHECKPOINT_TICK,
    checkpointBytes: checkpoint.byteLength,
    equalStateTicks,
    equalSnapshotTicks,
  };
  live.world.free();
  restoredWorld.free();
  return result;
}

function createBenchmarkWorld(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -9.80665, z: 0 });
  world.timestep = DT;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0),
  );
  for (let index = 0; index < 300; index += 1) {
    const column = index % 20;
    const row = Math.floor(index / 20) % 15;
    const layer = Math.floor(index / 300);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          (column - 9.5) * 0.75,
          0.3 + layer * 0.65,
          (row - 7) * 0.75,
        )
        .setCanSleep(false),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25), body);
  }
  return world;
}

function runPerformanceProbe(RAPIER) {
  const world = createBenchmarkWorld(RAPIER);
  for (let tick = 0; tick < 120; tick += 1) world.step();
  const stepMs = [];
  for (let tick = 0; tick < 600; tick += 1) {
    const start = performance.now();
    world.step();
    stepMs.push(performance.now() - start);
  }
  const snapshotStart = performance.now();
  const snapshot = world.takeSnapshot();
  const snapshotMs = performance.now() - snapshotStart;
  const result = {
    bodies: 300,
    measuredTicks: stepMs.length,
    p50StepMs: quantile(stepMs, 0.5),
    p95StepMs: quantile(stepMs, 0.95),
    p99StepMs: quantile(stepMs, 0.99),
    maxStepMs: Math.max(...stepMs),
    snapshotBytes: snapshot.byteLength,
    snapshotMs,
  };
  world.free();
  return result;
}

function readPackageEvidence() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  const files = ["rapier.mjs", "rapier.cjs", "rapier_wasm3d_bg.wasm"].map(
    (file) => ({
      file,
      bytes: fs.statSync(path.join(PACKAGE_ROOT, file)).size,
    }),
  );
  return {
    version: packageJson.version,
    license: packageJson.license,
    files,
    totalMeasuredBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

function readHookEvidence(RAPIER) {
  const declaration = fs.readFileSync(
    path.join(PACKAGE_ROOT, "pipeline/physics_hooks.d.ts"),
    "utf8",
  );
  const hookNames = Object.keys(RAPIER.ActiveHooks).filter((key) =>
    Number.isNaN(Number(key)),
  );
  return {
    activeHooks: hookNames,
    declaresContactPairFilter: declaration.includes("filterContactPair("),
    declaresIntersectionPairFilter: declaration.includes(
      "filterIntersectionPair(",
    ),
    declaresContactModification:
      declaration.includes("modifySolverContacts") ||
      declaration.includes("MODIFY_SOLVER_CONTACTS"),
    declaresCustomRowInsertion:
      declaration.includes("addSolverContact") ||
      declaration.includes("addConstraintRow"),
  };
}

async function main() {
  let RAPIER;
  try {
    RAPIER = await import("@dimforge/rapier3d-compat");
  } catch (error) {
    throw new Error(
      "Rapier comparator requires the intentionally untracked research package " +
        "@dimforge/rapier3d-compat@0.19.3.",
      { cause: error },
    );
  }
  await RAPIER.init();

  const packageEvidence = readPackageEvidence();
  const hooks = readHookEvidence(RAPIER);
  const guide = runGuideProbe(RAPIER);
  const snapshot = runSnapshotProbe(RAPIER);
  const performanceProbe = runPerformanceProbe(RAPIER);

  assert.equal(packageEvidence.version, "0.19.3");
  assert.equal(packageEvidence.license, "Apache-2.0");
  assert.equal(hooks.declaresContactModification, false);
  assert.equal(hooks.declaresCustomRowInsertion, false);
  assert.ok(guide.maxTransverseDriftM <= 1e-5);
  assert.ok(guide.maxAngularDriftRad <= 1e-5);
  assert.equal(snapshot.equalStateTicks, snapshot.resumedTicks);
  assert.equal(snapshot.equalSnapshotTicks, snapshot.resumedTicks);

  console.log(
    JSON.stringify(
      {
        candidate: "@dimforge/rapier3d-compat",
        fixedDtS: DT,
        package: packageEvidence,
        publicContactHooks: hooks,
        guide,
        snapshot,
        performance: performanceProbe,
      },
      null,
      2,
    ),
  );
}

await main();
