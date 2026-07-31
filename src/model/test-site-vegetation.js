import {
  testSiteShapeBounds,
  testSiteShapeContains,
} from "./test-site-shapes.js";
import { deepFreeze, DomainValidationError } from "./primitives.js";

const compiledByFrozenDefinition = new WeakMap();

function seededRandom(seedValue) {
  let seed = seedValue >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function ringArea(ring) {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index],
      next = ring[(index + 1) % ring.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
}

function shapeAreaM2(shape) {
  if (shape.kind === "rectangle") return shape.sizeM[0] * shape.sizeM[1];
  if (shape.kind === "ellipse")
    return Math.PI * (shape.sizeM[0] / 2) * (shape.sizeM[1] / 2);
  if (shape.kind === "polygon")
    return (
      Math.abs(ringArea(shape.ringsM[0])) -
      shape.ringsM
        .slice(1)
        .reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0)
    );
  let lengthM = 0;
  for (const path of shape.pathsM)
    for (let index = 0; index < path.length - 1; index++)
      lengthM += Math.hypot(
        path[index + 1][0] - path[index][0],
        path[index + 1][1] - path[index][1],
      );
  return lengthM * shape.widthM;
}

function stagingShape(pad) {
  return {
    kind: "rectangle",
    centerM: [pad.pose.positionM[0], pad.pose.positionM[2]],
    sizeM: [pad.clearanceM[0], pad.clearanceM[2]],
    rotationRad: pad.pose.headingRad,
  };
}

function exclusionsFor(rule, testSite) {
  return [
    ...rule.exclusionShapes,
    ...(rule.excludeSurfaceRegions
      ? testSite.surfaceRegions.map(({ shape }) => shape)
      : []),
    ...(rule.excludeFluidRegions
      ? testSite.fluidRegions.map(({ shape }) => shape)
      : []),
    ...(rule.excludeClearVolumes
      ? testSite.clearVolumes.map(({ shape }) => shape)
      : []),
    ...(rule.excludeStagingPads ? testSite.stagingPads.map(stagingShape) : []),
  ];
}

/** Deterministically expands strict vegetation rules into immutable instances. */
export function compileTestSiteVegetation(testSite) {
  const cached = Object.isFrozen(testSite)
    ? compiledByFrozenDefinition.get(testSite)
    : null;
  if (cached) return cached;
  const instances = [];
  for (const rule of testSite.vegetationRules) {
    const random = seededRandom(rule.seed),
      bounds = testSiteShapeBounds(rule.zone),
      targetCount = Math.round(
        (shapeAreaM2(rule.zone) / 10_000) * rule.densityPerHectare,
      ),
      exclusions = exclusionsFor(rule, testSite),
      accepted = [],
      maximumRadiusM = rule.sizeDistribution.radiusM[1],
      spacingCellM = Math.max(0.1, rule.minimumSpacingM + maximumRadiusM * 2),
      spacingBuckets = new Map(),
      spacingKey = (x, z) =>
        `${Math.floor(x / spacingCellM)}:${Math.floor(z / spacingCellM)}`,
      nearbyInstances = (x, z) => {
        const cellX = Math.floor(x / spacingCellM),
          cellZ = Math.floor(z / spacingCellM),
          nearby = [];
        for (let offsetX = -1; offsetX <= 1; offsetX++)
          for (let offsetZ = -1; offsetZ <= 1; offsetZ++)
            nearby.push(
              ...(spacingBuckets.get(`${cellX + offsetX}:${cellZ + offsetZ}`) ||
                []),
            );
        return nearby;
      };
    let attempts = 0;
    while (accepted.length < targetCount && attempts++ < targetCount * 80) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX),
        z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ),
        radiusM =
          rule.sizeDistribution.radiusM[0] +
          random() *
            (rule.sizeDistribution.radiusM[1] -
              rule.sizeDistribution.radiusM[0]),
        heightM =
          rule.sizeDistribution.heightM[0] +
          random() *
            (rule.sizeDistribution.heightM[1] -
              rule.sizeDistribution.heightM[0]);
      if (!testSiteShapeContains(rule.zone, x, z, -radiusM)) continue;
      if (
        exclusions.some((shape) =>
          testSiteShapeContains(shape, x, z, rule.exclusionMarginM + radiusM),
        ) ||
        nearbyInstances(x, z).some(
          (instance) =>
            Math.hypot(
              x - instance.pose.positionM[0],
              z - instance.pose.positionM[2],
            ) <
            rule.minimumSpacingM + radiusM + instance.radiusM,
        )
      )
        continue;
      const instance = {
        id: `${rule.id}-${accepted.length + 1}`,
        ruleId: rule.id,
        districtId: rule.districtId,
        kind: rule.kind,
        pose: {
          positionM: [x, 0, z],
          headingRad: random() * Math.PI * 2,
        },
        radiusM,
        heightM,
        materialKey: rule.materialKey,
        collidable: radiusM >= rule.colliderMinimumRadiusM,
        presentation: rule.presentation,
      };
      accepted.push(instance);
      const key = spacingKey(x, z);
      if (!spacingBuckets.has(key)) spacingBuckets.set(key, []);
      spacingBuckets.get(key).push(instance);
    }
    if (accepted.length !== targetCount)
      throw new DomainValidationError(
        "TEST_SITE_VEGETATION_DENSITY_UNSATISFIABLE",
        `Vegetation rule ${rule.id} placed ${accepted.length} of ${targetCount} instances`,
        {
          path: ["vegetationRules", rule.id],
          details: { accepted: accepted.length, targetCount },
        },
      );
    instances.push(...accepted);
  }
  const compiled = deepFreeze(instances);
  if (Object.isFrozen(testSite))
    compiledByFrozenDefinition.set(testSite, compiled);
  return compiled;
}

/** Projects collidable vegetation into the same explicit fixture contract. */
export function testSiteVegetationFixtures(testSite) {
  return Object.freeze(
    compileTestSiteVegetation(testSite)
      .filter(({ collidable }) => collidable)
      .map((instance) =>
        deepFreeze({
          id: `vegetation:${instance.id}`,
          districtId: instance.districtId,
          pose: instance.pose,
          materialKey: instance.materialKey,
          collisionGeometry: {
            kind: "compound",
            children: [
              {
                geometry: {
                  kind: "cylinder",
                  axis: "y",
                  radiusM: instance.radiusM,
                  heightM: instance.heightM,
                  segments: 10,
                },
                offsetM: [0, instance.heightM / 2, 0],
                rotationEulerRad: [0, 0, 0],
              },
            ],
          },
          presentation: instance.presentation,
        }),
      ),
  );
}
