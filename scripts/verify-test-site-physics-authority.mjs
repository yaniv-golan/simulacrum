import * as CANNON from "cannon-es";
import * as THREE from "three";
import { assert } from "./lib/assert.mjs";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";
import { createTestSiteTerrainGeometry } from "../src/presentation/test-site-surface-presentation.js";
import { FIELD_SURFACE_Y } from "../src/simulation/environment/earth.js";

const environment = createTestingPlaygroundEnvironment(),
  physics = createWorkshopPhysicsWorld({
    surfaceSampleAt: environment.surfaceSampleAt,
    footprint: environment.testSite.footprint,
  }),
  geometry = createTestSiteTerrainGeometry({
    testSite: environment.testSite,
    terrainHeightAt: environment.terrainHeightAt,
    baseHeightM: FIELD_SURFACE_Y,
  }),
  [centerX, centerZ] = environment.testSite.footprint.centerM,
  terrainMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
terrainMesh.position.set(centerX, FIELD_SURFACE_Y, centerZ);
terrainMesh.rotation.x = -Math.PI / 2;
terrainMesh.updateMatrixWorld(true);

assert.equal(geometry.userData.authority, "test-site-surface-field");
assert.equal(geometry.userData.elementSizeM, physics.terrainElementSize);
assert.equal(geometry.userData.segmentsX, 240);
assert.equal(geometry.userData.segmentsZ, 180);
assert.equal(geometry.userData.denseTileCount, 48);
assert.equal(geometry.userData.tileCount, 108);
assert.equal(geometry.userData.triangleCount, 41_400);

const probes = [
    [-91.8, 108.3],
    [-69.8, 108.3],
    [65.2, 95.3],
    [108.2, 95.3],
    [150.2, 95.3],
    [72.2, 60.3],
    [116.2, 58.3],
    [154.2, 70.3],
    [-174.8, -61.7],
    [-174.8, -19.7],
    [-164.8, 82.3],
    [-139.8, -124.7],
    [-104.8, -124.7],
    [-159.8, -124.7],
    [192.2, -17.7],
    [104.2, -42.7],
    [-29.8, -134.7],
    [0.2, 60.3],
    [-223.8, 80.3],
    [104.2, -111.7],
  ],
  renderRay = new THREE.Raycaster(),
  collisionResult = new CANNON.RaycastResult(),
  normalMatrix = new THREE.Matrix3().getNormalMatrix(terrainMesh.matrixWorld);
let maximumHeightDeltaM = 0,
  minimumNormalDot = 1;

for (const [x, z] of probes) {
  renderRay.set(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0));
  const renderHit = renderRay.intersectObject(terrainMesh, false)[0];
  assert.ok(renderHit, `visual terrain ray missed (${x}, ${z})`);
  collisionResult.reset();
  assert.equal(
    physics.world.raycastClosest(
      new CANNON.Vec3(x, 40, z),
      new CANNON.Vec3(x, -20, z),
      { skipBackfaces: false },
      collisionResult,
    ),
    true,
    `collision terrain ray missed (${x}, ${z})`,
  );
  assert.equal(collisionResult.body, physics.fieldBody);
  const collisionMaterial = physics.fieldBody.userData.contactMaterialAt(
    x,
    z,
    physics.debrisMaterial.name,
  ).materialKey;
  assert.equal(
    collisionMaterial,
    environment.surfaceSampleAt(x, z).materialKey,
    `collision material owner disagreed at (${x}, ${z})`,
  );
  const renderNormal = renderHit.face.normal
      .clone()
      .applyMatrix3(normalMatrix)
      .normalize(),
    collisionNormal = new THREE.Vector3(
      collisionResult.hitNormalWorld.x,
      collisionResult.hitNormalWorld.y,
      collisionResult.hitNormalWorld.z,
    ).normalize(),
    heightDeltaM = Math.abs(
      renderHit.point.y - collisionResult.hitPointWorld.y,
    ),
    normalDot = renderNormal.dot(collisionNormal);
  maximumHeightDeltaM = Math.max(maximumHeightDeltaM, heightDeltaM);
  minimumNormalDot = Math.min(minimumNormalDot, normalDot);
}

assert.ok(
  maximumHeightDeltaM < 1e-5,
  `visual/collision height mismatch exceeded 0.01 mm (${maximumHeightDeltaM} m)`,
);
assert.ok(
  minimumNormalDot > 0.99999,
  `visual/collision normal mismatch exceeded frozen bound (${minimumNormalDot})`,
);

function dynamicProbe({ id, position, velocity }) {
  const body = new CANNON.Body({
    mass: 12,
    material: physics.debrisMaterial,
    shape: new CANNON.Sphere(0.28),
    position: new CANNON.Vec3(...position),
    velocity: new CANNON.Vec3(...velocity),
    linearDamping: 0,
    angularDamping: 0.01,
  });
  body.userData = { externalBodyId: id };
  physics.world.addBody(body);
  return body;
}

function stepProbe(body, ticks) {
  let maximumVerticalSpeed = 0,
    maximumSupportOwners = 0,
    maximumHorizontalSpeed = Math.hypot(body.velocity.x, body.velocity.z);
  const materials = new Set();
  for (let tick = 1; tick <= ticks; tick++) {
    physics.worldAdapter.integrate(1 / 120);
    const owners = new Set();
    for (const contact of physics.world.contacts) {
      if (!(
        (contact.bi === body && contact.bj === physics.fieldBody) ||
        (contact.bj === body && contact.bi === physics.fieldBody)
      ))
        continue;
      owners.add(contact.surfaceMaterialKey);
    }
    owners.delete(undefined);
    for (const material of owners) materials.add(material);
    maximumSupportOwners = Math.max(maximumSupportOwners, owners.size);
    maximumVerticalSpeed = Math.max(
      maximumVerticalSpeed,
      Math.abs(body.velocity.y),
    );
    maximumHorizontalSpeed = Math.max(
      maximumHorizontalSpeed,
      Math.hypot(body.velocity.x, body.velocity.z),
    );
    assert.ok(
      [
        body.position.x,
        body.position.y,
        body.position.z,
        body.velocity.x,
        body.velocity.y,
        body.velocity.z,
      ].every(Number.isFinite),
      `${body.userData.externalBodyId} produced non-finite state`,
    );
  }
  return {
    materials,
    maximumSupportOwners,
    maximumVerticalSpeed,
    maximumHorizontalSpeed,
  };
}

const laneProbe = dynamicProbe({
    id: "test-site-authority:surface-seam",
    position: [-100, environment.terrainHeightAt(-100, 108) + 0.29, 108],
    velocity: [12, 0, 0],
  }),
  laneResult = stepProbe(laneProbe, 240);
assert.ok(laneProbe.position.x > -87, "seam probe snagged before crossing");
assert.ok(laneResult.materials.has("short-grass"));
assert.ok(laneResult.materials.has("dry-asphalt"));
assert.ok(
  laneResult.maximumSupportOwners <= 1,
  `surface seam applied ${laneResult.maximumSupportOwners} material owners in one tick`,
);
assert.ok(
  laneResult.maximumVerticalSpeed < 1,
  `surface seam injected a vertical impulse (${laneResult.maximumVerticalSpeed} m/s)`,
);
assert.ok(
  laneResult.maximumHorizontalSpeed <= 12.05,
  `surface seam increased horizontal speed (${laneResult.maximumHorizontalSpeed} m/s)`,
);
physics.world.removeBody(laneProbe);

const boardProbe = dynamicProbe({
    id: "test-site-authority:board-edge",
    position: [18, 0.29, 0],
    velocity: [12, 0, 0],
  }),
  boardResult = stepProbe(boardProbe, 180);
assert.ok(
  boardProbe.position.x > 23,
  "board-edge probe snagged at the reserve seam",
);
assert.ok(
  boardResult.maximumVerticalSpeed < 4,
  `board/reserve seam injected an unstable impulse (${boardResult.maximumVerticalSpeed} m/s)`,
);
assert.ok(
  boardResult.maximumHorizontalSpeed <= 12.05,
  `board/reserve seam increased horizontal speed (${boardResult.maximumHorizontalSpeed} m/s)`,
);
physics.world.removeBody(boardProbe);

terrainMesh.geometry.dispose();
terrainMesh.material.dispose();
console.log(
  `test-site physics authority passed (${maximumHeightDeltaM.toExponential(2)} m max height delta, ${minimumNormalDot.toFixed(7)} min normal dot)`,
);
