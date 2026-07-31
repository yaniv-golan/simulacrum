import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { physicalFeaturePrimitivesForDescriptor } from "../model/component-geometry-contract.js";
import { deepFreeze } from "../model/primitives.js";
import { sharePrimitiveGeometry } from "./render-resources.js";

const AXIAL_Y_TO_Z = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
);
const PROFILE_GEOMETRY_KINDS = new Set([
  "rounded-wheel-v1",
  "spur-gear-v1",
  "helical-spring-v1",
  "extruded-profile-v1",
]);

function roundedWheelGeometry(geometry, radialSegments, shoulderSegments) {
  const halfWidthM = geometry.widthM / 2,
    shoulderM = geometry.shoulderRadiusM,
    innerRadiusM = geometry.radiusM - shoulderM,
    lowerCenterM = -halfWidthM + shoulderM,
    upperCenterM = halfWidthM - shoulderM,
    points = [new THREE.Vector2(0, -halfWidthM)];
  for (let index = 0; index <= shoulderSegments; index++) {
    const angle = -Math.PI / 2 + (index / shoulderSegments) * (Math.PI / 2);
    points.push(
      new THREE.Vector2(
        innerRadiusM + Math.cos(angle) * shoulderM,
        lowerCenterM + Math.sin(angle) * shoulderM,
      ),
    );
  }
  points.push(new THREE.Vector2(geometry.radiusM, upperCenterM));
  for (let index = 1; index <= shoulderSegments; index++) {
    const angle = (index / shoulderSegments) * (Math.PI / 2);
    points.push(
      new THREE.Vector2(
        innerRadiusM + Math.cos(angle) * shoulderM,
        upperCenterM + Math.sin(angle) * shoulderM,
      ),
    );
  }
  points.push(new THREE.Vector2(0, halfWidthM));
  return new THREE.LatheGeometry(points, radialSegments);
}

function roundedBoxGeometry(geometry, detailPolicy) {
  const segments = Math.max(1, Number(detailPolicy.edgeSegments || 4));
  const result = new RoundedBoxGeometry(
    ...geometry.fullSizeM,
    segments,
    geometry.radiusM,
  );
  result.userData.sharedPrimitiveKey = [
    geometry.kind,
    ...geometry.fullSizeM,
    geometry.radiusM,
    segments,
  ].join(":");
  return result;
}

function involuteAngle(baseRadiusM, radiusM) {
  if (radiusM <= baseRadiusM) return 0;
  const alpha = Math.acos(baseRadiusM / radiusM);
  return Math.tan(alpha) - alpha;
}

function spurGearGeometry(geometry, detailPolicy) {
  const shape = new THREE.Shape(),
    toothPitchRad = (Math.PI * 2) / geometry.toothCount,
    halfToothAtPitchRad = toothPitchRad / 4,
    baseRadiusM = geometry.pitchRadiusM * Math.cos(geometry.pressureAngleRad),
    pitchInvoluteRad = involuteAngle(baseRadiusM, geometry.pitchRadiusM),
    rootSampleRadiusM = Math.max(geometry.rootRadiusM, baseRadiusM),
    flankSamples = Math.max(2, Number(detailPolicy.gearFlankSegments || 3)),
    points = [];
  for (let tooth = 0; tooth < geometry.toothCount; tooth++) {
    const centerAngle = geometry.toothPhaseRad + tooth * toothPitchRad;
    for (const side of [-1, 1]) {
      const samples = Array.from({ length: flankSamples + 1 }, (_, index) =>
        side < 0 ? index : flankSamples - index,
      );
      for (const sample of samples) {
        const fraction = sample / flankSamples,
          radiusM =
            rootSampleRadiusM +
            (geometry.tipRadiusM - rootSampleRadiusM) * fraction,
          flankOffsetRad =
            halfToothAtPitchRad +
            pitchInvoluteRad -
            involuteAngle(baseRadiusM, radiusM),
          angle = centerAngle + side * flankOffsetRad;
        points.push(
          new THREE.Vector2(
            Math.cos(angle) * radiusM,
            Math.sin(angle) * radiusM,
          ),
        );
      }
    }
    const rootAngle = centerAngle + toothPitchRad / 2;
    points.push(
      new THREE.Vector2(
        Math.cos(rootAngle) * geometry.rootRadiusM,
        Math.sin(rootAngle) * geometry.rootRadiusM,
      ),
    );
  }
  shape.setFromPoints(points);
  if (geometry.boreRadiusM > 0) {
    const bore = new THREE.Path();
    bore.absarc(0, 0, geometry.boreRadiusM, 0, Math.PI * 2, true);
    shape.holes.push(bore);
  }
  let result = new THREE.ExtrudeGeometry(shape, {
    depth: geometry.axialThicknessM,
    bevelEnabled: false,
    curveSegments: Math.max(8, Number(detailPolicy.radialSegments || 24)),
  });
  result.translate(0, 0, -geometry.axialThicknessM / 2);
  if (geometry.hubRadiusM !== null) {
    const hubShape = new THREE.Shape(),
      bore = new THREE.Path();
    hubShape.absarc(0, 0, geometry.hubRadiusM, 0, Math.PI * 2);
    bore.absarc(0, 0, geometry.boreRadiusM, 0, Math.PI * 2, true);
    hubShape.holes.push(bore);
    const hub = new THREE.ExtrudeGeometry(hubShape, {
      depth: geometry.hubThicknessM,
      bevelEnabled: false,
      curveSegments: Math.max(8, Number(detailPolicy.radialSegments || 24)),
    });
    hub.translate(0, 0, -geometry.hubThicknessM / 2);
    const merged = mergeGeometries([result, hub], false);
    result.dispose();
    hub.dispose();
    result = merged;
  }
  result.userData.sharedPrimitiveKey = [
    geometry.kind,
    geometry.toothCount,
    geometry.toothPhaseRad,
    geometry.pitchRadiusM,
    geometry.pressureAngleRad,
    geometry.moduleM,
    geometry.axialThicknessM,
    geometry.rootRadiusM,
    geometry.tipRadiusM,
    geometry.boreRadiusM,
    geometry.hubRadiusM,
    geometry.hubThicknessM,
    flankSamples,
  ].join(":");
  return result;
}

function helicalSpringGeometry(geometry, detailPolicy) {
  const longitudinalSegments = Math.max(
      Math.ceil(geometry.activeTurns * 12),
      Math.ceil(
        geometry.activeTurns * Number(detailPolicy.springSegmentsPerTurn || 24),
      ),
    ),
    axialSpanM = geometry.referenceAxialLengthM - 2 * geometry.wireRadiusM,
    closedEndFraction = Math.min(0.08, 0.45 / geometry.activeTurns),
    path = new (class extends THREE.Curve {
      getPoint(fraction, target = new THREE.Vector3()) {
        const angle = fraction * geometry.activeTurns * Math.PI * 2,
          axialFraction =
            geometry.endTreatment === "closed-ground-v1"
              ? fraction < closedEndFraction
                ? 0
                : fraction > 1 - closedEndFraction
                  ? 1
                  : (fraction - closedEndFraction) / (1 - 2 * closedEndFraction)
              : fraction;
        return target.set(
          Math.cos(angle) * geometry.meanCoilRadiusM,
          Math.sin(angle) * geometry.meanCoilRadiusM,
          -axialSpanM / 2 + axialFraction * axialSpanM,
        );
      }

      getTangent(fraction, target = new THREE.Vector3()) {
        const delta = 0.0001,
          before = this.getPoint(Math.max(0, fraction - delta)),
          after = this.getPoint(Math.min(1, fraction + delta));
        return target.subVectors(after, before).normalize();
      }
    })();
  let result = new THREE.TubeGeometry(
    path,
    longitudinalSegments,
    geometry.wireRadiusM,
    Math.max(6, Number(detailPolicy.springWireSegments || 10)),
    false,
  );
  if (geometry.endTreatment === "closed-ground-v1") {
    const wireSegments = Math.max(
        6,
        Number(detailPolicy.springWireSegments || 10),
      ),
      caps = [0, 1].map((fraction) => {
        const cap = new THREE.CylinderGeometry(
            geometry.wireRadiusM,
            geometry.wireRadiusM,
            geometry.wireRadiusM * 0.15,
            wireSegments,
          ),
          point = path.getPoint(fraction),
          tangent = path.getTangent(fraction).normalize();
        cap.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            tangent,
          ),
        );
        cap.translate(point.x, point.y, point.z);
        return cap;
      }),
      capped = mergeGeometries([result, ...caps], false);
    result.dispose();
    for (const cap of caps) cap.dispose();
    result = capped;
  }
  result.computeBoundingBox();
  const bounds = result.boundingBox,
    radialM = geometry.meanCoilRadiusM + geometry.wireRadiusM,
    actualHalfSize = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5),
    center = bounds.getCenter(new THREE.Vector3());
  result.translate(-center.x, -center.y, -center.z);
  result.scale(
    radialM / actualHalfSize.x,
    radialM / actualHalfSize.y,
    geometry.referenceAxialLengthM / 2 / actualHalfSize.z,
  );
  result.userData.sharedPrimitiveKey = [
    geometry.kind,
    geometry.meanCoilRadiusM,
    geometry.wireRadiusM,
    geometry.activeTurns,
    geometry.endTreatment,
    geometry.referenceAxialLengthM,
    longitudinalSegments,
    detailPolicy.springWireSegments || 10,
  ].join(":");
  return result;
}

function extrudedProfileGeometry(geometry) {
  const shape = new THREE.Shape();
  shape.setFromPoints(
    geometry.pointsM.map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const result = new THREE.ExtrudeGeometry(shape, {
    depth: geometry.axialThicknessM,
    bevelEnabled: false,
  });
  result.translate(0, 0, -geometry.axialThicknessM / 2);
  result.userData.sharedPrimitiveKey = [
    geometry.kind,
    geometry.pointsM.flat().join(","),
    geometry.axialThicknessM,
  ].join(":");
  return result;
}

function geometryForPrimitive(geometry, detailPolicy, detailTier) {
  const radialSegments = Math.max(8, Number(detailPolicy.radialSegments || 24));
  let result;
  if (geometry.kind === "box-v1")
    result = new THREE.BoxGeometry(...geometry.fullSizeM);
  else if (geometry.kind === "rounded-box-v1")
    result = roundedBoxGeometry(geometry, detailPolicy);
  else if (geometry.kind === "sphere-v1")
    result = new THREE.SphereGeometry(
      geometry.radiusM,
      radialSegments,
      Math.max(6, radialSegments / 2),
    );
  else if (geometry.kind === "cylinder-v1")
    result = new THREE.CylinderGeometry(
      geometry.radiusM,
      geometry.radiusM,
      geometry.axialLengthM,
      radialSegments,
    );
  else if (geometry.kind === "elliptic-cylinder-v1") {
    result = new THREE.CylinderGeometry(1, 1, 1, radialSegments);
    result.scale(geometry.radiusXM, geometry.axialLengthM, geometry.radiusYM);
    result.userData.sharedPrimitiveKey = [
      geometry.kind,
      geometry.radiusXM,
      geometry.radiusYM,
      geometry.axialLengthM,
      radialSegments,
    ].join(":");
  } else if (geometry.kind === "capsule-v1")
    result = new THREE.CapsuleGeometry(
      geometry.radiusM,
      geometry.cylinderLengthM,
      Math.max(4, radialSegments / 3),
      radialSegments,
    );
  else if (geometry.kind === "cone-v1")
    result = new THREE.CylinderGeometry(
      geometry.endRadiusM,
      geometry.startRadiusM,
      geometry.axialLengthM,
      radialSegments,
    );
  else if (geometry.kind === "rounded-wheel-v1")
    result = roundedWheelGeometry(
      geometry,
      radialSegments,
      Math.max(2, Number(detailPolicy.shoulderSegments || 6)),
    );
  else if (geometry.kind === "spur-gear-v1")
    result = spurGearGeometry(geometry, detailPolicy);
  else if (geometry.kind === "helical-spring-v1")
    result = helicalSpringGeometry(geometry, detailPolicy);
  else if (geometry.kind === "extruded-profile-v1")
    result = extrudedProfileGeometry(geometry);
  else
    throw new Error(`Unsupported canonical render primitive ${geometry.kind}`);
  result.userData.sharedGeometryCategory = PROFILE_GEOMETRY_KINDS.has(
    geometry.kind,
  )
    ? "profile"
    : "primitive";
  result.userData.sharedDetailTier = detailTier;
  return sharePrimitiveGeometry(result);
}

function isAxial(geometry) {
  return [
    "cylinder-v1",
    "elliptic-cylinder-v1",
    "capsule-v1",
    "cone-v1",
    "rounded-wheel-v1",
  ].includes(geometry.kind);
}

function projectPrimitive({
  primitive,
  material,
  detailPolicy,
  detailTier,
  role,
}) {
  const object = new THREE.Mesh(
    geometryForPrimitive(primitive.geometry, detailPolicy, detailTier),
    material,
  );
  object.name = `Canonical ${role} ${primitive.id}`;
  object.position.fromArray(primitive.framePart.positionM);
  object.quaternion.fromArray(primitive.framePart.orientation);
  if (isAxial(primitive.geometry)) object.quaternion.multiply(AXIAL_Y_TO_Z);
  object.userData.canonicalGeometryRole = role;
  object.userData.canonicalGeometryId = primitive.id;
  object.userData.canonicalFramePart = structuredClone(primitive.framePart);
  object.userData.canonicalGeometry = structuredClone(primitive.geometry);
  object.castShadow = detailPolicy.castShadow !== false;
  object.receiveShadow = detailPolicy.receiveShadow !== false;
  return object;
}

function straightFlexiblePreview({ descriptor, material, detailPolicy }) {
  const [portA, portB] = descriptor.runtimeGeometryContract.endpointPortIds,
    start = new THREE.Vector3(
      ...descriptor.portFrames[portA].framePart.positionM,
    ),
    end = new THREE.Vector3(
      ...descriptor.portFrames[portB].framePart.positionM,
    ),
    delta = end.clone().sub(start),
    lengthM = delta.length(),
    preview = new THREE.Mesh(
      new THREE.CylinderGeometry(
        descriptor.runtimeGeometryContract.diameterM / 2,
        descriptor.runtimeGeometryContract.diameterM / 2,
        Math.max(lengthM, 1e-9),
        Math.max(6, Number(detailPolicy.flexibleRadialSegments || 8)),
      ),
      material,
    );
  preview.position.copy(start).add(end).multiplyScalar(0.5);
  if (lengthM > 1e-9)
    preview.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.multiplyScalar(1 / lengthM),
    );
  preview.name = "Canonical flexible-line rest preview";
  preview.userData.flexibleLinePreview = true;
  preview.userData.referenceLengthM = Math.max(lengthM, 1e-9);
  preview.castShadow = detailPolicy.castShadow !== false;
  preview.receiveShadow = detailPolicy.receiveShadow !== false;
  return preview;
}

function projectFlexibleRuntime({
  g,
  descriptor,
  material,
  detailPolicy,
  runtimeRoot,
}) {
  const contract = descriptor.runtimeGeometryContract,
    preview = straightFlexiblePreview({ descriptor, material, detailPolicy }),
    runtimeGeometry = new THREE.CylinderGeometry(
      contract.diameterM / 2,
      contract.diameterM / 2,
      1,
      Math.max(6, Number(detailPolicy.flexibleRadialSegments || 8)),
    ),
    runtime = new THREE.InstancedMesh(
      runtimeGeometry,
      material,
      contract.maximumSegmentCount,
    );
  runtime.count = 0;
  runtime.visible = false;
  runtime.frustumCulled = false;
  runtime.name = "Canonical flexible-line solved segments";
  runtime.userData.flexibleLineRuntime = true;
  runtime.castShadow = detailPolicy.castShadow !== false;
  runtime.receiveShadow = detailPolicy.receiveShadow !== false;
  runtime.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  runtimeRoot.add(preview, runtime);
  g.userData.flexibleLineVisual = {
    preview,
    runtime,
    maximumEdgeCount: contract.maximumSegmentCount,
  };
  return { preview, runtime };
}

export function projectCanonicalComponentGeometry({
  g,
  geometryDescriptor,
  appearanceResolver,
  detailPolicy = {},
  detailTier = "standard",
}) {
  const physicalRoot = new THREE.Group(),
    featureRoot = new THREE.Group(),
    deformationRoot = new THREE.Group(),
    runtimeRoot = new THREE.Group();
  physicalRoot.name = "Canonical physical body";
  featureRoot.name = "Canonical physical interfaces";
  deformationRoot.name = "Canonical deformation coordinates";
  runtimeRoot.name = "Canonical runtime geometry";
  physicalRoot.userData.canonicalPhysicalRoot = true;
  featureRoot.userData.canonicalFeatureRoot = true;
  deformationRoot.userData.mechanismDeformationRoot = true;
  runtimeRoot.userData.canonicalRuntimeGeometryRoot = true;
  g.add(physicalRoot, featureRoot, deformationRoot, runtimeRoot);

  const deformationByPrimitive = new Map();
  for (const coordinate of geometryDescriptor.deformationContract
    ?.coordinates || [])
    for (const projection of coordinate.projections)
      for (const id of projection.primitiveIds)
        deformationByPrimitive.set(id, projection.id);
  const projectionRoots = new Map();
  for (const coordinate of geometryDescriptor.deformationContract
    ?.coordinates || []) {
    for (const projection of coordinate.projections) {
      const root = new THREE.Group();
      root.name = `Canonical deformation ${coordinate.id} ${projection.id}`;
      root.userData.deformationCoordinateId = coordinate.id;
      root.userData.deformationProjectionId = projection.id;
      deformationRoot.add(root);
      projectionRoots.set(projection.id, root);
    }
  }
  g.userData.mechanismDeformationRoots = Object.fromEntries(projectionRoots);
  g.userData.mechanismDeformationRoot =
    projectionRoots.size === 1
      ? projectionRoots.values().next().value
      : deformationRoot;

  for (const primitive of geometryDescriptor.bodyPrimitives) {
    const material = appearanceResolver({
        materialKey: primitive.materialKey,
        semanticKey: primitive.semanticKey,
        role: "body",
      }),
      object = projectPrimitive({
        primitive,
        material,
        detailPolicy,
        detailTier,
        role: "body",
      }),
      projectionId = deformationByPrimitive.get(primitive.id);
    (projectionRoots.get(projectionId) || physicalRoot).add(object);
  }

  const featurePrimitives =
    physicalFeaturePrimitivesForDescriptor(geometryDescriptor);
  for (const primitive of featurePrimitives) {
    const material = appearanceResolver({
      materialKey: primitive.materialKey,
      semanticKey: primitive.semanticKey,
      role: "feature",
    });
    featureRoot.add(
      projectPrimitive({
        primitive,
        material,
        detailPolicy,
        detailTier,
        role: "feature",
      }),
    );
  }

  let runtimeCapacity = 0;
  if (geometryDescriptor.geometryClass === "runtime-flexible-v1") {
    projectFlexibleRuntime({
      g,
      descriptor: geometryDescriptor,
      material: appearanceResolver({
        materialKey: geometryDescriptor.runtimeGeometryContract.materialKey,
        semanticKey: geometryDescriptor.runtimeGeometryContract.styleKey,
        role: "runtime",
      }),
      detailPolicy,
      runtimeRoot,
    });
    runtimeCapacity =
      geometryDescriptor.runtimeGeometryContract.maximumSegmentCount;
  }

  const projection = deepFreeze({
    schemaVersion: 1,
    descriptorDigest: geometryDescriptor.provenance.definitionDigest,
    geometryClass: geometryDescriptor.geometryClass,
    bodyPrimitiveIds: geometryDescriptor.bodyPrimitives.map(({ id }) => id),
    featureIds: geometryDescriptor.physicalFeatures.map(({ id }) => id),
    bodyPrimitives: structuredClone(geometryDescriptor.bodyPrimitives),
    featurePrimitives: structuredClone(featurePrimitives),
    deformationRoots: Object.fromEntries(
      [...projectionRoots].map(([id, root]) => [id, root.name]),
    ),
    runtimeCapacity,
    telemetryProjection:
      geometryDescriptor.runtimeGeometryContract?.telemetryProjection || null,
  });
  g.userData.geometryProjection = projection;
  return projection;
}
