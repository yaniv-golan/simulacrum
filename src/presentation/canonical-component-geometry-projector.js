import * as THREE from "three";
import { physicalFeaturePrimitivesForDescriptor } from "../model/component-geometry-contract.js";
import { deepFreeze } from "../model/primitives.js";
import { sharePrimitiveGeometry } from "./render-resources.js";

const AXIAL_Y_TO_Z = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
);

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

function geometryForPrimitive(geometry, detailPolicy) {
  const radialSegments = Math.max(8, Number(detailPolicy.radialSegments || 24));
  let result;
  if (geometry.kind === "box-v1")
    result = new THREE.BoxGeometry(...geometry.fullSizeM);
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
  else
    throw new Error(`Unsupported canonical render primitive ${geometry.kind}`);
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

function projectPrimitive({ primitive, material, detailPolicy, role }) {
  const object = new THREE.Mesh(
    geometryForPrimitive(primitive.geometry, detailPolicy),
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
    for (const id of coordinate.primitiveIds)
      deformationByPrimitive.set(id, coordinate.id);
  const coordinateRoots = new Map();
  for (const coordinate of geometryDescriptor.deformationContract
    ?.coordinates || []) {
    const root = new THREE.Group();
    root.name = `Canonical deformation ${coordinate.id}`;
    root.userData.deformationCoordinateId = coordinate.id;
    deformationRoot.add(root);
    coordinateRoots.set(coordinate.id, root);
  }
  g.userData.mechanismDeformationRoots = Object.fromEntries(coordinateRoots);
  g.userData.mechanismDeformationRoot =
    coordinateRoots.size === 1
      ? coordinateRoots.values().next().value
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
        role: "body",
      }),
      coordinateId = deformationByPrimitive.get(primitive.id);
    (coordinateRoots.get(coordinateId) || physicalRoot).add(object);
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
      [...coordinateRoots].map(([id, root]) => [id, root.name]),
    ),
    runtimeCapacity,
    telemetryProjection:
      geometryDescriptor.runtimeGeometryContract?.telemetryProjection || null,
  });
  g.userData.geometryProjection = projection;
  return projection;
}
