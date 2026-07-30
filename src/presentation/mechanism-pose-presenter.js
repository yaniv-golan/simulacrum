import { mechanismDeformationTransforms } from "../model/component-geometry-contract.js";

/** Applies one simulation read-model pose to its keyed presentation object. */
export function applyMechanismPose(part, pose, mechanismCoordinates = []) {
  if (!part?.mesh) return;
  if (pose.position)
    part.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
  if (pose.quaternion)
    part.mesh.quaternion.set(
      pose.quaternion.x,
      pose.quaternion.y,
      pose.quaternion.z,
      pose.quaternion.w,
    );
  if (Number.isFinite(pose.phase)) {
    part.phase = pose.phase;
  }
  if (Number.isFinite(pose.jointAngle)) part.jointAngle = pose.jointAngle;
  const descriptor = part.mesh.userData?.geometryDescriptor,
    deformationRoots = part.mesh.userData?.mechanismDeformationRoots || {};
  const transforms = descriptor?.deformationContract
    ? mechanismDeformationTransforms(descriptor, mechanismCoordinates)
    : {};
  for (const coordinate of descriptor?.deformationContract?.coordinates || [])
    for (const projection of coordinate.projections) {
      const transform = transforms[projection.id],
        root = deformationRoots[projection.id];
      if (!root)
        throw new Error(
          `Mechanism mesh has no deformation root for ${projection.id}`,
        );
      root.position.fromArray(transform.positionM);
      root.quaternion.fromArray(transform.orientation);
      root.scale.fromArray(transform.scale);
    }
  if (pose.deformedBodyBoundsWorldM)
    part.deformedBodyBoundsWorldM = structuredClone(
      pose.deformedBodyBoundsWorldM,
    );
}

export function presentMechanismTelemetry({
  telemetry,
  parts,
  missionName,
  missionDescription,
  missionProgress,
  elapsed,
  hasValidMesh,
}) {
  if (!telemetry) return;
  const coordinatesByPart = new Map();
  for (const coordinate of telemetry.twoFrameMechanisms || []) {
    if (!coordinate.coordinateId) continue;
    const samples = coordinatesByPart.get(coordinate.sourcePartId) || [];
    samples.push({
      coordinateId: coordinate.coordinateId,
      coordinateM: coordinate.coordinateM,
    });
    coordinatesByPart.set(coordinate.sourcePartId, samples);
  }
  for (const pose of telemetry.poses || [])
    applyMechanismPose(
      parts.find((candidate) => candidate.id === pose.id),
      pose,
      coordinatesByPart.get(pose.id) || [],
    );
  if (!telemetry.activeMotors && parts.some((part) => part.type === "motor")) {
    missionName.textContent = "DRIVETRAIN INCOMPLETE";
    missionDescription.textContent =
      "Motor needs electrical power and a physically supported shaft.";
    missionProgress.style.width = "0%";
  } else if (elapsed > 2 && hasValidMesh) {
    missionName.textContent = "TRANSMISSION ONLINE";
    missionDescription.textContent =
      "Motor torque is crossing supported shafts and compliant gear teeth.";
    missionProgress.style.width = "100%";
  }
}
