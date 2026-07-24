import * as CANNON from "cannon-es";
import {
  CONTACT_MATERIAL_PAIRS,
  contactMaterialPair,
} from "../model/contact-material-pairs.js";
import { DomainValidationError } from "../model/primitives.js";

/** Installs authored model contact laws for every available Cannon material. */
export class CannonMaterialAdapter {
  constructor(world, entries = []) {
    this.world = world;
    this.materials = new Map(entries);
  }

  register(materialKey, material = new CANNON.Material(materialKey)) {
    if (!materialKey || this.materials.has(materialKey))
      throw new DomainValidationError(
        "DUPLICATE_CANNON_MATERIAL_KEY",
        `Cannon material ${String(materialKey)} is already registered`,
      );
    material.name = materialKey;
    this.materials.set(materialKey, material);
    return material;
  }

  materialForKey(materialKey) {
    const material = this.materials.get(materialKey);
    if (!material)
      throw new DomainValidationError(
        "UNKNOWN_CANNON_MATERIAL_KEY",
        `No Cannon material is registered for ${String(materialKey)}`,
      );
    return material;
  }

  install() {
    for (const pair of CONTACT_MATERIAL_PAIRS) {
      const [leftKey, rightKey] = pair.materials,
        left = this.materials.get(leftKey),
        right = this.materials.get(rightKey);
      if (!left || !right) continue;
      const law = contactMaterialPair(leftKey, rightKey);
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(left, right, {
          friction: Math.min(
            law.longitudinalFrictionCoefficient,
            law.lateralFrictionCoefficient,
          ),
          restitution: law.restitutionCoefficient,
          contactEquationStiffness: law.foundationStiffnessNPerM || 1e8,
          contactEquationRelaxation: law.foundationStiffnessNPerM ? 4 : 3,
          frictionEquationStiffness: 1e8,
          frictionEquationRelaxation: 3,
        }),
      );
    }
    return this;
  }
}
