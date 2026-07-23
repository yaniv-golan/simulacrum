import * as CANNON from "cannon-es";
import { createYUpHeightfieldCandidateFilter } from "../heightfield-broadphase.js";
import { supportMaterialResponse } from "../../model/contact-material-pairs.js";

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
  targetElementSizeM = 2.5,
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

  const samples = [],
    heights = [];
  for (let ix = 0; ix <= segmentsX; ix++) {
    const sampleRow = [],
      heightRow = [],
      x = minimumX + ix * elementSize;
    for (let iz = 0; iz <= segmentsZ; iz++) {
      sampleRow.push(sampleAt(x, minimumZ + iz * elementSize));
      heightRow.push(
        sampleAt(x, minimumZ + (segmentsZ - iz) * elementSize).heightM,
      );
    }
    samples.push(sampleRow);
    heights.push(heightRow);
  }

  const triangleCounts = {},
    point = (ix, iz) => [
      minimumX + ix * elementSize,
      samples[ix][iz].heightM,
      minimumZ + iz * elementSize,
    ],
    triangleMaterial = (vertices) => {
      const x = vertices.reduce((sum, vertex) => sum + vertex[0], 0) / 3,
        z = vertices.reduce((sum, vertex) => sum + vertex[2], 0) / 3;
      return sampleAt(x, z).materialKey;
    };
  for (let ix = 0; ix < segmentsX; ix++)
    for (let iz = 0; iz < segmentsZ; iz++) {
      const a = point(ix, iz),
        b = point(ix + 1, iz),
        c = point(ix, iz + 1),
        d = point(ix + 1, iz + 1),
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
