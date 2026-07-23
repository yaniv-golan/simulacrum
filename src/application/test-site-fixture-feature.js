import * as CANNON from "cannon-es";
import * as THREE from "three";
import { mesh } from "../presentation/mesh-primitives.js";

function fixtureBody(fixture, groundY, groundMaterial) {
  const [width, height, depth] = fixture.sizeM,
    body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      position: new CANNON.Vec3(
        fixture.positionM[0],
        groundY + height / 2,
        fixture.positionM[2],
      ),
    });
  if (fixture.kind === "tree-trunk")
    body.addShape(new CANNON.Cylinder(width / 2, width / 2, height, 10));
  else if (fixture.kind === "rock")
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)),
    );
  else if (fixture.kind === "log") {
    const horizontal = new CANNON.Quaternion(),
      yaw = new CANNON.Quaternion();
    horizontal.setFromEuler(0, 0, Math.PI / 2);
    yaw.setFromEuler(0, fixture.headingRad, 0);
    yaw.mult(horizontal, body.quaternion);
    body.addShape(new CANNON.Cylinder(depth / 2, depth / 2, width, 12));
  } else if (fixture.kind === "sign") {
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.06, height / 2, 0.06)));
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(width / 2, height * 0.22, depth / 2)),
      new CANNON.Vec3(0, height * 0.27, 0),
    );
    body.quaternion.setFromEuler(0, fixture.headingRad, 0);
  } else {
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)),
    );
    body.quaternion.setFromEuler(0, fixture.headingRad, 0);
  }
  Object.assign(body, {
    userData: {
      externalBodyId: `environment:fixture:${fixture.id}`,
      fixtureId: fixture.id,
      districtId: fixture.districtId,
      surface: fixture.kind,
      materialKey: fixture.materialKey,
    },
  });
  return body;
}

function addFixtureVisual(fixture, groundY, parent, materials) {
  const [x, , z] = fixture.positionM,
    [width, height, depth] = fixture.sizeM,
    group = new THREE.Group();
  group.name = `test-fixture:${fixture.id}`;
  group.position.set(x, groundY, z);
  group.rotation.y = fixture.headingRad;
  parent.add(group);
  if (fixture.kind === "tree-trunk") {
    mesh(
      new THREE.CylinderGeometry(width * 0.42, width * 0.55, height, 10),
      materials.bark,
      [0, height / 2, 0],
      [],
      group,
    );
    for (const [ox, oy, oz, scale, materialIndex] of [
      [0, 0.86, 0, 0.52, 0],
      [-0.32, 0.73, 0.12, 0.38, 1],
      [0.34, 0.76, -0.1, 0.42, 2],
    ])
      mesh(
        new THREE.IcosahedronGeometry(height * scale, 1),
        materials.leaves[materialIndex],
        [ox * height, oy * height, oz * height],
        [],
        group,
      ).scale.set(0.52, 0.38, 0.52);
  } else if (fixture.kind === "rock") {
    const rock = mesh(
      new THREE.DodecahedronGeometry(0.5, 1),
      materials.stone,
      [0, height / 2, 0],
      [0.18, 0.25, -0.12],
      group,
    );
    rock.scale.set(width, height, depth);
  } else if (fixture.kind === "log")
    mesh(
      new THREE.CylinderGeometry(depth / 2, depth / 2, width, 14),
      materials.bark,
      [0, depth / 2, 0],
      [0, 0, Math.PI / 2],
      group,
    );
  else if (fixture.kind === "sign") {
    mesh(
      new THREE.CylinderGeometry(0.055, 0.07, height, 8),
      materials.signPost,
      [0, height / 2, 0],
      [],
      group,
    );
    mesh(
      new THREE.BoxGeometry(width, height * 0.44, depth),
      materials.signFace,
      [0, height * 0.77, 0],
      [],
      group,
    );
  } else
    mesh(
      new THREE.BoxGeometry(width, height, depth),
      materials.stone,
      [0, height / 2, 0],
      [],
      group,
    );
  return group;
}

/** Compiles canonical solid fixtures into matching visible and Cannon objects. */
export function createTestSiteFixtureFeature({
  parent,
  world,
  groundMaterial,
  testSite,
  terrainHeightAt,
  materials,
}) {
  const bodies = [];
  for (const fixture of testSite.staticFixtures) {
    const groundY = terrainHeightAt(fixture.positionM[0], fixture.positionM[2]);
    addFixtureVisual(fixture, groundY, parent, materials);
    if (!fixture.collision) continue;
    const body = fixtureBody(fixture, groundY, groundMaterial);
    world.addBody(body);
    bodies.push(body);
  }
  return Object.freeze({ bodies: Object.freeze(bodies) });
}
