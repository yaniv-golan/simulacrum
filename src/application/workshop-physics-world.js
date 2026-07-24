import * as CANNON from "cannon-es";
import { CannonWorldAdapter } from "../simulation/cannon-world-adapter.js";
import {
  createTestSiteCollisionBody,
  installTestSiteContactMaterials,
} from "../simulation/environment/test-site-collision.js";
import { CannonMaterialAdapter } from "../simulation/cannon-material-adapter.js";

/** Builds the shared Cannon world and static workshop terrain contract. */
export function createWorkshopPhysicsWorld({ surfaceSampleAt, footprint }) {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    worldAdapter = new CannonWorldAdapter(world),
    groundMaterial = new CANNON.Material("ground"),
    footMaterial = new CANNON.Material("robot-foot"),
    debrisMaterial = new CANNON.Material("detached-component"),
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
      ["generic-ground", groundMaterial],
      ["generic-structure", debrisMaterial],
      ["nylon-rope", ropeMaterial],
      ...testSiteCollision.materialsByKey,
    ]).install();
  // Y-up SAP rejects disjoint world AABBs before exact narrowphase.
  const broadphase = new CANNON.SAPBroadphase(world);
  broadphase.axisIndex = 1;
  broadphase.useBoundingBoxes = true;
  world.broadphase = broadphase;
  Object.assign(world.solver, { iterations: 30, tolerance: 0.0002 });
  Object.assign(groundBody, {
    userData: {
      externalBodyId: "environment:build-plate",
      surface: "build plate",
      materialKey: "workshop-steel",
    },
  });
  world.addBody(groundBody);
  world.addBody(fieldBody);
  world.addContactMaterial(
    new CANNON.ContactMaterial(footMaterial, groundMaterial, {
      friction: 1.15,
      restitution: 0.02,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e8,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(debrisMaterial, groundMaterial, {
      friction: 0.68,
      restitution: 0.1,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
    }),
  );
  installTestSiteContactMaterials({
    world,
    materialsByKey: testSiteCollision.materialsByKey,
    footMaterial,
    debrisMaterial,
  });

  return Object.freeze({
    world,
    worldAdapter,
    groundMaterial,
    footMaterial,
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
