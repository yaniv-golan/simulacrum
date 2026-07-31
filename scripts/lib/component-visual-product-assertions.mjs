import { assert } from "./assert.mjs";

const DETAIL_TIERS = new Set(["performance", "standard", "hero"]);
const close = (actual, expected, label) =>
  assert.ok(
    Math.abs(actual - expected) <= 1e-7,
    `${label}: expected ${expected}, received ${actual}`,
  );

/** Proves that the live editor and canonical renderer still describe one part set. */
export async function assertCanonicalVisualProductState(page, label) {
  const snapshot = await page.evaluate(() => ({
      state: JSON.parse(window.render_game_to_text()),
      performance: window.simulacrum_performance(),
    })),
    { state, performance } = snapshot,
    visuals = performance.visualGeometry,
    visualById = new Map(visuals.map((entry) => [entry.id, entry]));

  assert.equal(
    visuals.length,
    state.parts.length,
    `${label} has a different rendered and authored part count`,
  );
  for (const part of state.parts) {
    const visual = visualById.get(part.id);
    assert.ok(visual, `${label} omitted canonical visual part ${part.id}`);
    assert.equal(
      visual.type,
      part.type,
      `${label} rendered the wrong type for part ${part.id}`,
    );
    assert.ok(
      visual.geometryClass,
      `${label} part ${part.id} has no geometry class`,
    );
    assert.ok(
      DETAIL_TIERS.has(visual.detailTier),
      `${label} part ${part.id} has no deterministic detail tier`,
    );
    if (visual.geometryClass !== "runtime-flexible")
      assert.ok(
        visual.bodyPrimitiveIds.length > 0,
        `${label} part ${part.id} has no projected physical body`,
      );
    assert.equal(
      visual.bodyPrimitiveIds.length,
      visual.bodyPrimitiveKinds.length,
      `${label} part ${part.id} lost primitive identity`,
    );
  }
  assert.ok(
    performance.shared.primitiveGeometries <= 512,
    `${label} exceeded the shared primitive-geometry cap`,
  );
  assert.ok(
    performance.shared.profileGeometries <= 256,
    `${label} exceeded the shared profile-geometry cap`,
  );
  assert.ok(
    (performance.shared.owned.componentColorMaterials || 0) <=
      state.parts.length * 2,
    `${label} retained unbounded object-owned color materials`,
  );

  const mechanisms = state.architecture?.session?.systems?.mechanisms,
    poses = new Map((mechanisms?.poses || []).map((pose) => [pose.id, pose]));
  for (const sample of mechanisms?.twoFrameMechanisms || []) {
    if (!sample.active || sample.sourcePartId == null) continue;
    const visual = visualById.get(sample.sourcePartId),
      coordinate = visual?.deformationContract?.coordinates?.find(
        (entry) => entry.id === sample.coordinateId,
      );
    assert.ok(
      visual,
      `${label} omitted active mechanism visual ${sample.sourcePartId}`,
    );
    assert.ok(
      visual.deformationContract,
      `${label} active mechanism ${sample.sourcePartId} has no deformation contract`,
    );
    assert.ok(
      coordinate,
      `${label} omitted deformation coordinate ${sample.sourcePartId}:${sample.coordinateId}`,
    );
    const boundedCoordinateM = Math.max(
      coordinate.allowedCoordinateRangeM.minimum,
      Math.min(coordinate.allowedCoordinateRangeM.maximum, sample.coordinateM),
    );
    for (const projection of coordinate.projections) {
      const transform = visual.deformationTransforms[projection.id];
      assert.ok(
        transform,
        `${label} omitted deformation projection ${projection.id}`,
      );
      if (projection.kind === "anchor-local-z-scale-v1")
        close(
          transform.scale[2],
          boundedCoordinateM / coordinate.referenceBodyLengthM,
          `${label} ${sample.sourcePartId}:${projection.id} scale`,
        );
      if (projection.kind === "local-z-translation-v1")
        close(
          transform.positionM[2],
          (boundedCoordinateM - coordinate.referenceCoordinateM) *
            projection.gainMPerM,
          `${label} ${sample.sourcePartId}:${projection.id} translation`,
        );
    }
    const completedPose = poses.get(sample.sourcePartId);
    assert.ok(
      completedPose,
      `${label} omitted completed pose ${sample.sourcePartId}`,
    );
    assert.ok(
      completedPose.deformedBodyBoundsWorldM,
      `${label} completed pose ${sample.sourcePartId} has no deformed bounds`,
    );
    assert.ok(
      visual.deformedBodyBoundsWorldM,
      `${label} visual ${sample.sourcePartId} has no deformed bounds`,
    );
    for (const key of ["minimumM", "maximumM"])
      completedPose.deformedBodyBoundsWorldM[key].forEach((expected, axis) =>
        close(
          visual.deformedBodyBoundsWorldM[key][axis],
          expected,
          `${label} ${sample.sourcePartId} ${key}[${axis}]`,
        ),
      );
  }
  return snapshot;
}
