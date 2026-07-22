/** Applies one simulation read-model pose to its keyed presentation object. */
export function applyMechanismPose(part, pose) {
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
    if (!pose.quaternion) part.mesh.rotation.z = pose.phase;
  }
  if (Number.isFinite(pose.jointAngle)) part.mesh.rotation.z = pose.jointAngle;
  if (Number.isFinite(pose.axialScale)) {
    const deformationRoot = part.mesh.userData?.mechanismDeformationRoot;
    if (!deformationRoot)
      throw new Error("Mechanism mesh has no deformation presentation root");
    deformationRoot.scale.z = pose.axialScale;
  }
  if (Number.isFinite(pose.spinDelta)) part.mesh.rotation.x += pose.spinDelta;
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
  for (const pose of telemetry.poses || [])
    applyMechanismPose(
      parts.find((candidate) => candidate.id === pose.id),
      pose,
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
