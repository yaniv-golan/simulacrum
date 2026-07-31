import * as THREE from "three";
import { rebuildComponentVisual } from "./component-mesh-factory.js";
import {
  COMPONENT_DETAIL_POLICY_VERSION,
  componentDetailReason,
  componentDetailTier,
} from "./component-detail-policy.js";

const cameraPosition = new THREE.Vector3();
const partCenter = new THREE.Vector3();
const worldScale = new THREE.Vector3();

function projectedDiameterPx(root, camera, viewportHeightPx) {
  const bounds = root.userData.geometryDescriptor?.selectionBoundsPartM;
  if (!bounds) return 0;
  partCenter
    .fromArray(bounds.minimumM)
    .add(new THREE.Vector3().fromArray(bounds.maximumM))
    .multiplyScalar(0.5);
  const sizeX = bounds.maximumM[0] - bounds.minimumM[0],
    sizeY = bounds.maximumM[1] - bounds.minimumM[1],
    sizeZ = bounds.maximumM[2] - bounds.minimumM[2],
    localRadiusM = Math.hypot(sizeX, sizeY, sizeZ) / 2;
  root.updateWorldMatrix(true, false);
  root.localToWorld(partCenter);
  root.getWorldScale(worldScale);
  camera.getWorldPosition(cameraPosition);
  const radiusM =
      localRadiusM * Math.max(worldScale.x, worldScale.y, worldScale.z),
    distanceM = Math.max(
      camera.near || 0.01,
      cameraPosition.distanceTo(partCenter),
    ),
    focalPx =
      viewportHeightPx /
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  return (2 * radiusM * focalPx) / distanceM;
}

/** Owns camera/assembly-driven detail state while retaining stable part roots. */
export class ComponentDetailController {
  constructor() {
    this.entries = new Map();
    this.transitionCount = 0;
    this.pendingTransitions = 0;
  }

  update({
    parts,
    camera,
    viewportHeightPx,
    pixelRatio = 1,
    running,
    selectedIds = new Set(),
    quality = "auto",
  }) {
    const activeIds = new Set(),
      partCount = parts.length;
    this.pendingTransitions = 0;
    for (const part of parts) {
      activeIds.add(part.id);
      const root = part.mesh,
        selected = selectedIds.has(part.id);
      if (root.userData.visualDetailPolicy === "authored-fixed-v1") {
        const tier = root.userData.visualDetailTier || "standard";
        this.entries.set(part.id, {
          id: part.id,
          tier,
          desiredTier: tier,
          reason: "projection:authored-fixed",
          projectedDiameterPx: null,
          selected,
        });
        continue;
      }
      if (root.userData.largeAssemblyBatched) {
        this.entries.set(part.id, {
          id: part.id,
          tier: "performance",
          desiredTier: "performance",
          reason: "projection:large-assembly-batch",
          projectedDiameterPx: null,
          selected,
        });
        continue;
      }
      const currentTier = root.userData.visualDetailTier || "standard",
        diameterPx = projectedDiameterPx(
          root,
          camera,
          viewportHeightPx * Math.max(0.25, Number(pixelRatio) || 1),
        ),
        desiredTier = componentDetailTier({
          currentTier,
          projectedDiameterPx: diameterPx,
          partCount,
          quality,
          selected,
        });
      let reason = componentDetailReason({
        tier: desiredTier,
        projectedDiameterPx: diameterPx,
        partCount,
        quality,
        selected,
      });
      if (desiredTier !== currentTier) {
        if (running || part.ambientHeatBindings?.length) {
          this.pendingTransitions++;
          reason = running
            ? "deferred:simulation-running"
            : "deferred:thermal-binding";
        } else {
          rebuildComponentVisual(root, desiredTier);
          this.transitionCount++;
        }
      }
      this.entries.set(part.id, {
        id: part.id,
        tier: root.userData.visualDetailTier || currentTier,
        desiredTier,
        reason,
        projectedDiameterPx: Math.round(diameterPx * 10) / 10,
        selected,
      });
    }
    for (const id of this.entries.keys())
      if (!activeIds.has(id)) this.entries.delete(id);
  }

  snapshot() {
    const counts = { hero: 0, standard: 0, performance: 0 };
    for (const entry of this.entries.values()) counts[entry.tier]++;
    return {
      policyVersion: COMPONENT_DETAIL_POLICY_VERSION,
      counts,
      pendingTransitions: this.pendingTransitions,
      transitions: this.transitionCount,
      selected: [...this.entries.values()]
        .filter((entry) => entry.selected)
        .map((entry) => ({ ...entry })),
    };
  }
}
