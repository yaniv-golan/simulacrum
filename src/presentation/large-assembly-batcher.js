import * as THREE from "three";
import {
  disposeObject3D,
  sharePrimitiveGeometry,
  trackOwnedRenderResource,
} from "./render-resources.js";
import { sharedSurfaceTextures } from "./mesh-primitives.js";

const IDENTITY = [0, 0, 0, 1];

function canonicalBeamBatchDescriptor(part) {
  const geometry = part.mesh.userData.geometryDescriptor,
    visual = part.mesh.userData.visualDescriptor,
    body = geometry?.bodyPrimitives;
  if (
    body?.length !== 1 ||
    body[0].geometry.kind !== "box-v1" ||
    body[0].framePart.positionM.some((value) => value !== 0) ||
    body[0].framePart.orientation.some(
      (value, index) => value !== IDENTITY[index],
    ) ||
    !visual
  )
    return null;
  const sizeM = body[0].geometry.fullSizeM,
    color = visual.color;
  return {
    sizeM,
    color,
    key: `${sizeM.join(",")}:${color}`,
  };
}

/**
 * Draws repeated structural beams as low-detail instances for very large edit
 * scenes. Authoritative part roots remain in place for transforms, selection,
 * ports, serialization, and physics; only their presentation is substituted.
 */
export class LargeAssemblyBatcher {
  constructor({ machine, threshold = 128, minimumGroupSize = 4 }) {
    this.machine = machine;
    this.threshold = threshold;
    this.minimumGroupSize = minimumGroupSize;
    this.batches = [];
    this.hiddenParts = new Set();
    this.signature = "";
    this.inverseMachineWorld = new THREE.Matrix4();
    this.instanceMatrix = new THREE.Matrix4();
  }

  sync(parts, { enabled = true } = {}) {
    const eligible = enabled && parts.length > this.threshold,
      signature = eligible
        ? parts
            .filter((part) => part.type === "beam")
            .map((part) => {
              const descriptor = canonicalBeamBatchDescriptor(part);
              return `${part.id}:${descriptor?.key || "ineligible"}`;
            })
            .join("|")
        : "";
    if (signature === this.signature) return;
    this.disposeBatches();
    this.signature = signature;
    if (!signature) return;

    const groups = new Map();
    for (const part of parts) {
      if (part.type !== "beam") continue;
      const descriptor = canonicalBeamBatchDescriptor(part);
      if (!descriptor) continue;
      const { color, key, sizeM } = descriptor;
      if (!groups.has(key)) groups.set(key, { color, sizeM, parts: [] });
      groups.get(key).parts.push(part);
    }
    for (const group of groups.values()) {
      if (group.parts.length < this.minimumGroupSize) continue;
      const material = trackOwnedRenderResource(
          new THREE.MeshStandardMaterial({
            color: group.color,
            metalness: 0.58,
            roughness: 0.38,
            roughnessMap: sharedSurfaceTextures.microRoughness,
          }),
          "batchColorMaterials",
        ),
        mesh = new THREE.InstancedMesh(
          sharePrimitiveGeometry(new THREE.BoxGeometry(...group.sizeM)),
          material,
          group.parts.length,
        );
      mesh.name = "largeAssemblyBeamBatch";
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.partIds = group.parts.map((part) => part.id);
      this.machine.add(mesh);
      this.batches.push({ mesh, parts: group.parts });
      for (const part of group.parts) {
        part.mesh.visible = false;
        part.mesh.userData.largeAssemblyBatched = true;
        this.hiddenParts.add(part);
      }
    }
    this.update();
  }

  update() {
    if (!this.batches.length) return;
    this.machine.updateWorldMatrix(true, false);
    this.inverseMachineWorld.copy(this.machine.matrixWorld).invert();
    for (const batch of this.batches) {
      for (let index = 0; index < batch.parts.length; index++) {
        const part = batch.parts[index];
        part.mesh.visible = false;
        part.mesh.updateWorldMatrix(true, false);
        this.instanceMatrix
          .copy(this.inverseMachineWorld)
          .multiply(part.mesh.matrixWorld);
        batch.mesh.setMatrixAt(index, this.instanceMatrix);
      }
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.computeBoundingBox();
      batch.mesh.computeBoundingSphere();
    }
  }

  snapshot() {
    return {
      active: this.batches.length > 0,
      batches: this.batches.length,
      instances: this.batches.reduce(
        (sum, batch) => sum + batch.parts.length,
        0,
      ),
    };
  }

  disposeBatches() {
    for (const part of this.hiddenParts) {
      part.mesh.visible = true;
      delete part.mesh.userData.largeAssemblyBatched;
    }
    this.hiddenParts.clear();
    for (const batch of this.batches) disposeObject3D(batch.mesh);
    this.batches.length = 0;
  }

  dispose() {
    this.signature = "";
    this.disposeBatches();
  }
}
