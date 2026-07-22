import * as THREE from "three";
import { disposeObject3D, sharePrimitiveGeometry } from "./render-resources.js";

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
    this.geometry = sharePrimitiveGeometry(
      new THREE.BoxGeometry(2.4, 0.34, 0.34),
    );
  }

  sync(parts, { enabled = true } = {}) {
    const eligible = enabled && parts.length > this.threshold,
      signature = eligible
        ? parts
            .filter((part) => part.type === "beam")
            .map((part) => `${part.id}:${part.customColor ?? "default"}`)
            .join("|")
        : "";
    if (signature === this.signature) return;
    this.disposeBatches();
    this.signature = signature;
    if (!signature) return;

    const groups = new Map();
    for (const part of parts) {
      if (part.type !== "beam") continue;
      const color = part.customColor ?? part.config?.color ?? 0x668fa3,
        key = String(color);
      if (!groups.has(key)) groups.set(key, { color, parts: [] });
      groups.get(key).parts.push(part);
    }
    for (const group of groups.values()) {
      if (group.parts.length < this.minimumGroupSize) continue;
      const material = new THREE.MeshStandardMaterial({
          color: group.color,
          metalness: 0.68,
          roughness: 0.28,
        }),
        mesh = new THREE.InstancedMesh(
          this.geometry,
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
    for (const part of this.hiddenParts) part.mesh.visible = true;
    this.hiddenParts.clear();
    for (const batch of this.batches) disposeObject3D(batch.mesh);
    this.batches.length = 0;
  }

  dispose() {
    this.signature = "";
    this.disposeBatches();
  }
}
