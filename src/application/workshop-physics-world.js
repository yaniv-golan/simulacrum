import * as CANNON from "cannon-es";
import { CannonWorldAdapter } from "../simulation/cannon-world-adapter.js";
import { createYUpHeightfieldCandidateFilter } from "../simulation/heightfield-broadphase.js";

/** Builds the shared Cannon world and static workshop terrain contract. */
export function createWorkshopPhysicsWorld({ terrainHeightAt }) {
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
    fieldBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
    });
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
  Object.assign(fieldBody, {
    userData: {
      externalBodyId: "environment:terrain",
      surface: "streamed terrain",
      materialKey: "compacted-soil",
    },
  });

  const terrainSegments = 128,
    terrainSize = 160,
    elementSize = terrainSize / terrainSegments,
    terrainHeights = [];
  for (let ix = 0; ix <= terrainSegments; ix++) {
    const row = [],
      x = -terrainSize / 2 + ix * elementSize;
    for (let iz = 0; iz <= terrainSegments; iz++) {
      // Heightfield local +Y maps to world -Z after the body rotation.
      const z = terrainSize / 2 - iz * elementSize;
      row.push(terrainHeightAt(x, z));
    }
    terrainHeights.push(row);
  }
  fieldBody.addShape(new CANNON.Heightfield(terrainHeights, { elementSize }));
  fieldBody.position.set(-terrainSize / 2, 0, terrainSize / 2);
  fieldBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  const fieldRuntimeBody = /** @type {any} */ (fieldBody);
  fieldRuntimeBody.userData.broadphaseCandidateFilter =
    createYUpHeightfieldCandidateFilter({
      heights: terrainHeights,
      elementSize,
      originX: -terrainSize / 2,
      originZ: terrainSize / 2,
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

  return Object.freeze({
    world,
    worldAdapter,
    groundMaterial,
    footMaterial,
    debrisMaterial,
    groundBody,
    fieldBody,
    terrainSize,
  });
}
