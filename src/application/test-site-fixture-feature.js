import * as CANNON from "cannon-es";
import {
  addTestSiteFixtureInstances,
  addTestSiteFixtureVisual,
} from "../presentation/test-site-fixture-presentation.js";
import { testSiteVegetationFixtures } from "../model/test-site-vegetation.js";

function primitiveShape(geometry) {
  if (geometry.kind === "box")
    return new CANNON.Box(
      new CANNON.Vec3(...geometry.sizeM.map((size) => size / 2)),
    );
  return new CANNON.Cylinder(
    geometry.radiusM,
    geometry.radiusM,
    geometry.heightM,
    geometry.segments,
  );
}

function shapeOrientation(geometry, rotationEulerRad) {
  const orientation = new CANNON.Quaternion();
  orientation.setFromEuler(
    rotationEulerRad[0],
    rotationEulerRad[1],
    rotationEulerRad[2],
  );
  if (geometry.kind !== "cylinder" || geometry.axis === "y") return orientation;
  const axisRotation = new CANNON.Quaternion(),
    combined = new CANNON.Quaternion();
  if (geometry.axis === "x") axisRotation.setFromEuler(0, 0, Math.PI / 2);
  else axisRotation.setFromEuler(Math.PI / 2, 0, 0);
  orientation.mult(axisRotation, combined);
  return combined;
}

const FIXTURE_TILE_SIZE_M = 64;
const MAX_FIXTURE_SHAPES_PER_BODY = 24;

function fixtureGroupIdentity(fixture) {
  const [x, , z] = fixture.pose.positionM,
    tileX = Math.floor(x / FIXTURE_TILE_SIZE_M),
    tileZ = Math.floor(z / FIXTURE_TILE_SIZE_M);
  return {
    key: `${fixture.districtId}:${fixture.materialKey}:${tileX}:${tileZ}`,
    tileX,
    tileZ,
  };
}

function fixtureChildren(fixture) {
  return fixture.collisionGeometry.kind === "compound"
    ? fixture.collisionGeometry.children
    : [
        {
          geometry: fixture.collisionGeometry,
          offsetM: [0, 0, 0],
          rotationEulerRad: [0, 0, 0],
        },
      ];
}

function fixtureGroupBody(group, groundMaterial) {
  const groupCenterX =
      group.tileX * FIXTURE_TILE_SIZE_M + FIXTURE_TILE_SIZE_M / 2,
    groupCenterZ = group.tileZ * FIXTURE_TILE_SIZE_M + FIXTURE_TILE_SIZE_M / 2,
    body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      position: new CANNON.Vec3(groupCenterX, 0, groupCenterZ),
    }),
    fixtureIds = [];
  for (const { fixture, groundY } of group.fixtures) {
    fixtureIds.push(fixture.id);
    const heading = new CANNON.Quaternion();
    heading.setFromEuler(0, fixture.pose.headingRad, 0);
    for (const [index, child] of fixtureChildren(fixture).entries()) {
      if (child.geometry.kind === "none") continue;
      const shape = primitiveShape(child.geometry),
        rotatedOffset = heading.vmult(new CANNON.Vec3(...child.offsetM)),
        childOrientation = shapeOrientation(
          child.geometry,
          child.rotationEulerRad,
        ),
        worldOrientation = new CANNON.Quaternion();
      heading.mult(childOrientation, worldOrientation);
      Object.assign(shape, {
        userData: {
          shapeId: `fixture:${fixture.id}:${index}`,
          fixtureId: fixture.id,
          districtId: fixture.districtId,
          materialKey: fixture.materialKey,
          surface: fixture.presentation.key,
        },
      });
      body.addShape(
        shape,
        new CANNON.Vec3(
          fixture.pose.positionM[0] + rotatedOffset.x - groupCenterX,
          groundY + fixture.pose.positionM[1] + rotatedOffset.y,
          fixture.pose.positionM[2] + rotatedOffset.z - groupCenterZ,
        ),
        worldOrientation,
      );
    }
  }
  Object.assign(body, {
    userData: {
      externalBodyId: `environment:fixture-group:${group.key}`,
      fixtureIds: Object.freeze(fixtureIds),
      districtId: group.districtId,
      surface: "test-site-fixtures",
      materialKey: group.materialKey,
    },
  });
  return body;
}

/** Builds bounded, deterministic compound bodies without losing shape identity. */
export function createTestSiteFixtureBodies({
  fixtures,
  terrainHeightAt,
  groundMaterial,
}) {
  const groups = new Map();
  for (const fixture of fixtures) {
    if (fixture.collisionGeometry.kind === "none") continue;
    const identity = fixtureGroupIdentity(fixture);
    if (!groups.has(identity.key))
      groups.set(identity.key, {
        ...identity,
        districtId: fixture.districtId,
        materialKey: fixture.materialKey,
        fixtures: [],
      });
    groups.get(identity.key).fixtures.push({
      fixture,
      groundY: terrainHeightAt(
        fixture.pose.positionM[0],
        fixture.pose.positionM[2],
      ),
    });
  }
  const chunkedGroups = [];
  for (const group of [...groups.values()].sort((left, right) =>
    left.key.localeCompare(right.key, "en"),
  )) {
    let fixtures = [],
      shapeCount = 0,
      chunkIndex = 0;
    const flush = () => {
      if (!fixtures.length) return;
      chunkedGroups.push({
        ...group,
        key: `${group.key}:${chunkIndex++}`,
        fixtures,
      });
      fixtures = [];
      shapeCount = 0;
    };
    for (const entry of [...group.fixtures].sort((left, right) =>
      left.fixture.id.localeCompare(right.fixture.id, "en"),
    )) {
      const entryShapeCount = fixtureChildren(entry.fixture).filter(
        ({ geometry }) => geometry.kind !== "none",
      ).length;
      if (shapeCount + entryShapeCount > MAX_FIXTURE_SHAPES_PER_BODY) flush();
      fixtures.push(entry);
      shapeCount += entryShapeCount;
    }
    flush();
  }
  return Object.freeze(
    chunkedGroups.map((group) => fixtureGroupBody(group, groundMaterial)),
  );
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
  const bodies = [],
    fixtures = [
      ...testSite.staticFixtures,
      ...testSiteVegetationFixtures(testSite),
    ],
    instancedPresentationKeys = new Set(["rock", "tree-trunk"]);
  addTestSiteFixtureInstances({
    fixtures,
    terrainHeightAt,
    parent,
    materials,
  });
  for (const fixture of fixtures) {
    const groundY = terrainHeightAt(
      fixture.pose.positionM[0],
      fixture.pose.positionM[2],
    );
    if (!instancedPresentationKeys.has(fixture.presentation.key))
      addTestSiteFixtureVisual({ fixture, groundY, parent, materials });
  }
  for (const body of createTestSiteFixtureBodies({
    fixtures,
    terrainHeightAt,
    groundMaterial,
  })) {
    world.addBody(body);
    bodies.push(body);
  }
  return Object.freeze({ bodies: Object.freeze(bodies) });
}
