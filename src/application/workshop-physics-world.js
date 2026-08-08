import * as CANNON from "cannon-es";
import {
  CannonWorldAdapter,
  configureCannonWorldSolverProfile,
} from "../simulation/cannon-world-adapter.js";
import { createTestSiteCollisionBody } from "../simulation/environment/test-site-collision.js";
import { CannonMaterialAdapter } from "../simulation/cannon-material-adapter.js";
import { WORKSHOP_CANNON_SOLVER_PROFILE } from "../simulation/cannon-solver-profile.js";

/** Builds the shared Cannon world and static workshop terrain contract. */
export function createWorkshopPhysicsWorld({ surfaceSampleAt, footprint }) {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  });
  configureCannonWorldSolverProfile(world, WORKSHOP_CANNON_SOLVER_PROFILE);
  const worldAdapter = new CannonWorldAdapter(world),
    groundMaterial = new CANNON.Material("workshop-steel"),
    tireMaterial = new CANNON.Material("tire-rubber"),
    debrisMaterial = new CANNON.Material("generic-structure"),
    groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(22, 0.25, 22)),
      material: groundMaterial,
      position: new CANNON.Vec3(0, -0.25, 0),
    }),
    testSiteCollision = createTestSiteCollisionBody({
      sampleAt: surfaceSampleAt,
      footprint,
      fallbackMaterial: groundMaterial,
    }),
    fieldBody = testSiteCollision.body,
    ropeMaterial = new CANNON.Material("nylon-rope"),
    materialAdapter = new CannonMaterialAdapter(world, [
      ["workshop-steel", groundMaterial],
      ["generic-structure", debrisMaterial],
      ["tire-rubber", tireMaterial],
      ["nylon-rope", ropeMaterial],
      ...testSiteCollision.materialsByKey,
    ]).install();
  // Y-up SAP rejects disjoint world AABBs before exact narrowphase.
  const broadphase = new CANNON.SAPBroadphase(world);
  broadphase.axisIndex = 1;
  broadphase.useBoundingBoxes = true;
  world.broadphase = broadphase;
  Object.assign(groundBody, {
    userData: {
      externalBodyId: "environment:build-plate",
      checkpointPolicy: "reconstruct-from-owner-v1",
      surface: "build plate",
      materialKey: "workshop-steel",
    },
  });
  world.addBody(groundBody);
  world.addBody(fieldBody);

  return Object.freeze({
    world,
    worldAdapter,
    groundMaterial,
    tireMaterial,
    debrisMaterial,
    ropeMaterial,
    materialForKey: (materialKey) =>
      materialAdapter.materialForKey(materialKey),
    groundBody,
    fieldBody,
    terrainSize: testSiteCollision.width,
    terrainDepth: testSiteCollision.depth,
    terrainElementSize: testSiteCollision.elementSize,
    surfaceMaterials: testSiteCollision.materialsByKey,
  });
}
