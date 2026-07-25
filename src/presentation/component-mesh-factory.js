import * as THREE from "three";
import { componentVisualDescriptor } from "./component-visual-descriptor.js";
import {
  buildBeam,
  buildCargo,
  buildFin,
  buildHeatShield,
  buildNosecone,
  buildPlate,
} from "./component-visual-builders/structural-builders.js";
import {
  buildCanonicalMechanism,
  buildLever,
  buildSpurGear,
  gearShape,
} from "./component-visual-builders/mechanism-builders.js";
import {
  buildBattery,
  buildContactSensor,
  buildGyroscope,
  buildHeadlight,
  buildInertialSensor,
  buildLoadCell,
  buildLogicComputer,
  buildMotor,
  buildPressureProbe,
  buildRangeSensor,
  buildRotationSensor,
  buildThermalProbe,
} from "./component-visual-builders/electronics-builders.js";
import {
  buildFixedPitchRotor,
  buildPressureNozzle,
  buildPropellantTank,
  buildRcsCluster,
} from "./component-visual-builders/propulsion-builders.js";
import { buildGenericGeometry } from "./component-visual-builders/generic-builder.js";
import { buildFlexibleLine } from "./component-visual-builders/flexible-line-builder.js";

export { gearShape };

const VISUAL_BUILDERS = Object.freeze({
  beam: buildBeam,
  plate: buildPlate,
  cargo: buildCargo,
  nosecone: buildNosecone,
  heatshield: buildHeatShield,
  fin: buildFin,
  mechanism: buildCanonicalMechanism,
  lever: buildLever,
  gear: buildSpurGear,
  motor: buildMotor,
  gyro: buildGyroscope,
  imu: buildInertialSensor,
  computer: buildLogicComputer,
  rangesensor: buildRangeSensor,
  sensor: buildRotationSensor,
  contactsensor: buildContactSensor,
  thermalprobe: buildThermalProbe,
  pressureprobe: buildPressureProbe,
  loadcell: buildLoadCell,
  headlight: buildHeadlight,
  propellanttank: buildPropellantTank,
  battery: buildBattery,
  rcs: buildRcsCluster,
  rocket: buildPressureNozzle,
  rotor: buildFixedPitchRotor,
  generic: buildGenericGeometry,
  "flexible-line": buildFlexibleLine,
});

export function componentMesh(type, customColor) {
  const visualDescriptor = componentVisualDescriptor(type, customColor),
    vertexColors = visualDescriptor.kind === "beam",
    g = new THREE.Group(),
    accent = new THREE.MeshStandardMaterial({
      color: vertexColors ? 0xffffff : visualDescriptor.color,
      vertexColors,
      metalness: 0.7,
      roughness: 0.24,
    }),
    builder = VISUAL_BUILDERS[visualDescriptor.kind];
  if (!builder)
    throw new Error(`No visual builder for ${visualDescriptor.kind}`);
  const root =
    builder({
      g,
      accent,
      visualDescriptor,
      geometryDescriptor: visualDescriptor.geometry,
    }) || g;
  root.userData.geometryDescriptor = visualDescriptor.geometry;
  root.userData.visualDescriptor = visualDescriptor;
  root.userData.renderResourceOwnership = "object3d-tree-v1";
  return root;
}
