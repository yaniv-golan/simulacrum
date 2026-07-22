import * as THREE from "three";

export { analyzeMissionDesign } from "./mission-design-analyzer.js";

/** @typedef {THREE.Material & { color?: THREE.Color, emissive?: THREE.Color, emissiveIntensity?: number }} HeatMaterial */
/** @typedef {{ temperatureK: number, heatLimit: number }} ThermalState */
/** @typedef {{ object: THREE.Mesh, original: THREE.Material | THREE.Material[], heated: HeatMaterial[] }} HeatBinding */
/** @typedef {{ material: HeatMaterial, color?: THREE.Color, emissive?: THREE.Color, emissiveIntensity: number }} HeatMaterialState */
/**
 * @typedef {{
 *   id: number, mesh: THREE.Object3D, flightThermal?: ThermalState | null,
 *   flightAeroForce?: THREE.Vector3, flightInitialScale?: THREE.Vector3,
 *   flightDetached?: boolean | null,
 *   ambientHeatBindings?: HeatBinding[] | null,
 *   ambientHeatMaterials?: HeatMaterialState[] | null
 * }} AerothermalVisualPart
 */
/**
 * @typedef {{
 *   id: number, thermal: ThermalState, aerodynamicForceN?: number,
 *   scaleY?: number, visible: boolean,
 *   detached?: boolean
 * }} AerothermalPartState
 */
/** @typedef {{ parts?: AerothermalPartState[] }} AerothermalTelemetry */

/**
 * Owns transient heat-material clones and translates per-part aerothermal
 * telemetry into visual state. Simulation never receives meshes or materials.
 *
 * @param {{ parts: () => AerothermalVisualPart[] }} options
 */
export function createAerothermalVisuals({ parts }) {
  function prepare() {
    for (const part of parts()) {
      part.ambientHeatMaterials = [];
      part.ambientHeatBindings = [];
      part.mesh.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !object.material) return;
        const original = object.material,
          heated = (Array.isArray(original) ? original : [original]).map(
            (material) => /** @type {HeatMaterial} */ (material.clone()),
          );
        object.material = Array.isArray(original) ? heated : heated[0];
        part.ambientHeatBindings.push({ object, original, heated });
        for (const material of heated)
          part.ambientHeatMaterials.push({
            material,
            color: material.color?.clone(),
            emissive: material.emissive?.clone(),
            emissiveIntensity: material.emissiveIntensity || 0,
          });
      });
    }
  }

  /** @param {AerothermalVisualPart} part */
  function release(part) {
    for (const binding of part.ambientHeatBindings || []) {
      binding.object.material = binding.original;
      for (const material of binding.heated) material.dispose();
    }
    part.ambientHeatBindings = null;
    part.ambientHeatMaterials = null;
  }

  function dispose() {
    for (const part of parts()) release(part);
  }

  /** @param {AerothermalVisualPart} part */
  function updatePart(part) {
    const thermal = part.flightThermal;
    if (!thermal) return;
    const temperatureC = thermal.temperatureK - 273.15,
      glow = THREE.MathUtils.clamp(
        (temperatureC - 60) / Math.max(180, thermal.heatLimit - 60),
        0,
        1,
      );
    for (const entry of part.ambientHeatMaterials || []) {
      if (entry.material.color && entry.color)
        entry.material.color
          .copy(entry.color)
          .lerp(new THREE.Color(0xff2a08), glow * 0.78);
      if (entry.material.emissive) {
        entry.material.emissive
          .copy(entry.emissive || new THREE.Color())
          .lerp(new THREE.Color(0xff1600), Math.min(1, glow * 1.15));
        entry.material.emissiveIntensity = entry.emissiveIntensity + glow * 5;
      }
    }
  }

  /**
   * @param {AerothermalTelemetry | null | undefined} telemetry
   */
  function present(telemetry) {
    if (!telemetry) return;
    const byId = new Map(parts().map((part) => [part.id, part]));
    for (const partState of telemetry.parts || []) {
      const part = byId.get(partState.id);
      if (!part) continue;
      part.flightThermal = structuredClone(partState.thermal);
      part.flightAeroForce ||= new THREE.Vector3();
      part.flightAeroForce.set(partState.aerodynamicForceN || 0, 0, 0);
      part.mesh.scale.y =
        (part.flightInitialScale?.y || 1) * (partState.scaleY || 1);
      part.mesh.visible = partState.visible;
      if (partState.detached) part.flightDetached = true;
      updatePart(part);
    }
  }

  return { dispose, prepare, present, release, updatePart };
}
