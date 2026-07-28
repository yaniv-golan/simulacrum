import * as CANNON from "cannon-es";
import { createYUpHeightfieldCandidateFilter } from "../heightfield-broadphase.js";
import { supportMaterialResponse } from "../../model/contact-material-pairs.js";
import { TEST_SITE_TERRAIN_ELEMENT_SIZE_M } from "../../model/test-site-terrain.js";

const PARTICIPANT_SURFACE_FRICTION = Object.freeze({
  "short-grass": 0.62,
  "dry-asphalt": 0.92,
  "wet-asphalt": 0.56,
  "weathered-concrete": 0.86,
  "compacted-soil": 0.72,
  "loose-gravel": 0.5,
  "dry-sand": 0.4,
  "saturated-mud": 0.3,
  "low-grip-polymer": 0.16,
});

function participantSurfaceLaw(materialKey, participantMaterialName) {
  const baseFriction = PARTICIPANT_SURFACE_FRICTION[materialKey];
  if (!Number.isFinite(baseFriction))
    throw new RangeError(`Unknown test-site contact material ${materialKey}`);
  const response = supportMaterialResponse(materialKey),
    scale = participantMaterialName === "robot-foot" ? 1 : 0.72;
  return Object.freeze({
    materialKey,
    shapeId: `test-reserve:${materialKey}`,
    friction: baseFriction * scale,
    restitution: 0.02,
    contactEquationStiffness: response.foundationStiffnessNPerM || 1e8,
    contactEquationRelaxation: response.foundationStiffnessNPerM ? 4 : 3,
    frictionEquationStiffness: 1e8,
    frictionEquationRelaxation: 3,
  });
}

/** Installs explicit non-tire contact laws for every physical site surface. */
export function installTestSiteContactMaterials({
  world,
  materialsByKey,
  footMaterial,
  debrisMaterial,
}) {
  for (const [materialKey, surfaceMaterial] of materialsByKey)
    for (const [participantMaterial, scale] of [
      [footMaterial, 1],
      [debrisMaterial, 0.72],
    ])
      world.addContactMaterial(
        new CANNON.ContactMaterial(participantMaterial, surfaceMaterial, {
          friction: PARTICIPANT_SURFACE_FRICTION[materialKey] * scale,
          restitution: 0.02,
          contactEquationStiffness:
            supportMaterialResponse(materialKey).foundationStiffnessNPerM ||
            1e8,
          contactEquationRelaxation: supportMaterialResponse(materialKey)
            .foundationStiffnessNPerM
            ? 4
            : 3,
        }),
      );
}

/**
 * Builds one Y-up Heightfield from the shared query. cannon-es implements
 * sphere/box/convex/cylinder contact against Heightfield, while Trimesh only
 * supports sphere contact. Material identity and pair laws are resolved per
 * completed contact from this same canonical query by CannonSolverTransaction.
 */
export function createTestSiteCollisionBody({
  sampleAt,
  footprint,
  fallbackMaterial,
  targetElementSizeM = TEST_SITE_TERRAIN_ELEMENT_SIZE_M,
}) {
  const [centerX, centerZ] = footprint.centerM,
    [width, depth] = footprint.sizeM,
    segmentsX = Math.ceil(width / targetElementSizeM),
    segmentsZ = Math.ceil(depth / targetElementSizeM),
    elementSize = width / segmentsX,
    minimumX = centerX - width / 2,
    minimumZ = centerZ - depth / 2;
  if (Math.abs(depth / segmentsZ - elementSize) > 1e-9)
    throw new RangeError(
      "Test-site footprint must resolve to square terrain cells",
    );

  const samples = [];
  for (let ix = 0; ix <= segmentsX; ix++) {
    const sampleRow = [],
      x = minimumX + ix * elementSize;
    for (let iz = 0; iz <= segmentsZ; iz++)
      sampleRow.push(sampleAt(x, minimumZ + iz * elementSize));
    samples.push(sampleRow);
  }
  const heights = samples.map((row) =>
    [...row].reverse().map(({ heightM }) => heightM),
  );

  const triangleCounts = {},
    triangleMaterial = (vertices) => {
      const counts = new Map();
      for (const { materialKey } of vertices)
        counts.set(materialKey, (counts.get(materialKey) || 0) + 1);
      return [...counts].sort(
        ([leftKey, leftCount], [rightKey, rightCount]) =>
          rightCount - leftCount || leftKey.localeCompare(rightKey, "en"),
      )[0][0];
    };
  for (let ix = 0; ix < segmentsX; ix++)
    for (let iz = 0; iz < segmentsZ; iz++) {
      const a = samples[ix][iz],
        b = samples[ix + 1][iz],
        c = samples[ix][iz + 1],
        d = samples[ix + 1][iz + 1],
        first = [a, c, b],
        second = [b, c, d];
      for (const triangle of [first, second]) {
        const materialKey = triangleMaterial(triangle);
        triangleCounts[materialKey] = (triangleCounts[materialKey] || 0) + 1;
      }
    }

  const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: fallbackMaterial,
    }),
    materialsByKey = new Map(
      Object.keys(triangleCounts)
        .sort()
        .map((materialKey) => [materialKey, new CANNON.Material(materialKey)]),
    ),
    heightfield = new CANNON.Heightfield(heights, { elementSize }),
    heightfieldOrientation = new CANNON.Quaternion();
  heightfieldOrientation.setFromEuler(-Math.PI / 2, 0, 0);
  Object.assign(heightfield, {
    userData: {
      materialKey: "canonical-test-site",
      shapeId: "test-reserve:heightfield",
      featureIdentityKind: "heightfield-cell-triangle-v1",
    },
  });
  body.addShape(
    heightfield,
    new CANNON.Vec3(minimumX, 0, centerZ + depth / 2),
    heightfieldOrientation,
  );
  Object.assign(body, {
    userData: {
      externalBodyId: "environment:test-reserve",
      surface: "Workshop Test Reserve",
      materialKey: "short-grass",
      rollingSupportAt: (x, z) => {
        const sample = sampleAt(x, z),
          localX = (x - minimumX) / elementSize,
          localZ = (z - minimumZ) / elementSize,
          ix = Math.max(0, Math.min(segmentsX - 1, Math.floor(localX))),
          iz = Math.max(0, Math.min(segmentsZ - 1, Math.floor(localZ))),
          fx = localX - ix,
          fz = localZ - iz,
          triangle = fx + fz <= 1 ? 0 : 1,
          delta = elementSize * 0.5,
          left = sampleAt(x - delta, z).heightM,
          right = sampleAt(x + delta, z).heightM,
          back = sampleAt(x, z - delta).heightM,
          front = sampleAt(x, z + delta).heightM,
          nx = -(right - left) / (2 * delta),
          nz = -(front - back) / (2 * delta),
          length = Math.hypot(nx, 1, nz);
        return Object.freeze({
          validity: sample?.inside ? "measured" : "unavailable",
          heightM: sample.heightM,
          normal: Object.freeze({
            x: nx / length,
            y: 1 / length,
            z: nz / length,
          }),
          materialKey: sample.materialKey,
          featureId: `test-reserve:heightfield:cell:${ix}:${iz}:triangle:${triangle}`,
        });
      },
      triangleCounts: Object.freeze(triangleCounts),
      vertexCount: (segmentsX + 1) * (segmentsZ + 1),
      contactMaterialAt: (x, z, participantMaterialName) => {
        const sample = sampleAt(x, z);
        if (!sample?.inside)
          throw new RangeError(
            `Test-site contact lies outside the canonical footprint (${x}, ${z})`,
          );
        return participantSurfaceLaw(
          sample.materialKey,
          participantMaterialName,
        );
      },
      broadphaseCandidateFilter: createYUpHeightfieldCandidateFilter({
        heights,
        elementSize,
        originX: minimumX,
        originZ: centerZ + depth / 2,
      }),
    },
  });
  return Object.freeze({
    body,
    materialsByKey,
    triangleCounts: Object.freeze(triangleCounts),
    vertexCount: (segmentsX + 1) * (segmentsZ + 1),
    elementSize,
    width,
    depth,
    segmentsX,
    segmentsZ,
  });
}
