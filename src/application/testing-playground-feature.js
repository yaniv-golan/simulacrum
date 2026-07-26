import * as THREE from "three";
import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";
import { createTestReservePanel } from "../presentation/test-reserve-panel.js";
import { captureTestingPlaygroundDeployment } from "./testing-playground-deployment.js";

function physicalAssemblyBounds(parts) {
  const bounds = new THREE.Box3(),
    unitScale = new THREE.Vector3(1, 1, 1);
  for (const part of parts) {
    const descriptor = geometryDescriptorForPart(part),
      partBounds = new THREE.Box3(
        new THREE.Vector3(...descriptor.selectionBoundsPartM.minimumM),
        new THREE.Vector3(...descriptor.selectionBoundsPartM.maximumM),
      ),
      transform = new THREE.Matrix4().compose(
        new THREE.Vector3(...part.pos),
        new THREE.Quaternion(...part.orientation),
        unitScale,
      );
    bounds.union(partBounds.applyMatrix4(transform));
  }
  return bounds;
}

/** Owns stopped-build placement into canonical Test Reserve staging pads. */
export function createTestingPlaygroundFeature({
  root,
  state,
  testSite,
  surfaceHeightAt,
  parts,
  history,
  workspace,
  drawConnections,
  cameraTarget,
  render,
  setMode,
  retry,
  courseRecords,
  runIdentity,
  contactEffectsSnapshot,
  notify,
}) {
  let selectedPadId = "board";

  function deploy(padId, setStatus) {
    if (state.running) {
      setStatus("STOP THE SIMULATION BEFORE DEPLOYING");
      return false;
    }
    const pad = testSite.stagingPads.find(({ id }) => id === padId),
      currentParts = parts();
    if (!pad || !currentParts.length) {
      setStatus(pad ? "BUILD A MACHINE BEFORE DEPLOYING" : "UNKNOWN PAD");
      return false;
    }
    const bounds = physicalAssemblyBounds(workspace.editorSnapshot()),
      size = bounds.getSize(new THREE.Vector3()),
      cosine = Math.abs(Math.cos(pad.pose.headingRad)),
      sine = Math.abs(Math.sin(pad.pose.headingRad)),
      rotatedSize = {
        x: size.x * cosine + size.z * sine,
        y: size.y,
        z: size.x * sine + size.z * cosine,
      },
      [clearX, clearY, clearZ] = pad.clearanceM;
    if (
      rotatedSize.x > clearX ||
      rotatedSize.y > clearY ||
      rotatedSize.z > clearZ
    ) {
      setStatus(
        `DOES NOT FIT · NEED ${rotatedSize.x.toFixed(1)} × ${rotatedSize.y.toFixed(1)} × ${rotatedSize.z.toFixed(1)} M`,
      );
      return false;
    }
    history.record(`deploy to ${pad.id} test pad`);
    const center = bounds.getCenter(new THREE.Vector3()),
      yaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        pad.pose.headingRad,
      ),
      targetX = pad.pose.positionM[0],
      targetZ = pad.pose.positionM[2],
      targetBottomY = surfaceHeightAt(targetX, targetZ) + pad.pose.positionM[1],
      deltaY = targetBottomY - bounds.min.y;
    for (const part of currentParts) {
      const relative = part.mesh.position
        .clone()
        .sub(center)
        .applyQuaternion(yaw);
      part.mesh.position.set(
        targetX + relative.x,
        part.mesh.position.y + deltaY,
        targetZ + relative.z,
      );
      part.mesh.quaternion.premultiply(yaw);
      part.pos = part.mesh.position.toArray();
    }
    selectedPadId = pad.id;
    workspace.sync();
    state.testDeployment = captureTestingPlaygroundDeployment({
      siteId: testSite.id,
      padId: pad.id,
      pose: {
        positionM: [targetX, targetBottomY, targetZ],
        headingRad: pad.pose.headingRad,
      },
      parts: workspace.editorSnapshot(),
    });
    drawConnections();
    cameraTarget.set(
      targetX,
      targetBottomY + Math.max(1.2, size.y / 2),
      targetZ,
    );
    render();
    setStatus(`DEPLOYED · ${pad.id.toUpperCase()} PAD · START WHEN READY`);
    notify(`Assembly deployed to ${pad.id} test pad`);
    return true;
  }

  function selectTrial(routeId, setStatus) {
    if (state.running) {
      setStatus("STOP THE SIMULATION BEFORE SELECTING A TRIAL");
      return false;
    }
    const route = testSite.routes.find(({ id }) => id === routeId);
    if (!route) {
      setStatus("UNKNOWN GUIDED TRIAL");
      return false;
    }
    state.activeTestRouteId = route.id;
    setStatus(
      `ARMED · ${route.label.toUpperCase()} · ${route.stagingPadId.toUpperCase()} PAD RECOMMENDED`,
    );
    notify(`${route.label} trial armed`);
    return true;
  }

  const panel = createTestReservePanel({
    root,
    testSite,
    isRunning: () => state.running,
    activeRouteId: () => state.activeTestRouteId,
    machinePosition: () => {
      const currentParts = parts();
      if (!currentParts.length) return { x: 0, z: 0 };
      const center = physicalAssemblyBounds(
        workspace.editorSnapshot(),
      ).getCenter(new THREE.Vector3());
      return { x: center.x, z: center.z };
    },
    onFreeTest: () => {
      state.activeTestRouteId = null;
      setMode("test");
    },
    onRetry: retry,
    courseView: (routeId) => courseRecords.view(routeId),
    onDeploy: deploy,
    onTrial: selectTrial,
  });
  return Object.freeze({
    panel,
    deploy,
    snapshot: () => {
      const identity = runIdentity(),
        activeRoute = state.activeTestRouteId,
        routeView = activeRoute ? courseRecords.view(activeRoute) : null;
      return Object.freeze({
        siteId: testSite.id,
        selectedPadId,
        activeRouteId: activeRoute,
        open: !root
          .querySelector(".test-reserve-browser")
          .classList.contains("hidden"),
        records: routeView?.reliability || null,
        proofIdentity: routeView?.proofIdentity || null,
        currentRunIdentity: identity
          ? {
              runConfigurationFingerprint: identity.runConfigurationFingerprint,
              blueprintFingerprint: identity.blueprintFingerprint,
              testSiteFingerprint: identity.testSiteFingerprint,
              materialMapFingerprint: identity.materialMapFingerprint,
              deploymentFingerprint: identity.deploymentFingerprint,
            }
          : null,
        contactEffects: contactEffectsSnapshot(),
      });
    },
  });
}
