import { deepFreeze } from "./primitives.js";

const IDENTITY = Object.freeze([0, 0, 0, 1]);
const FLIP_Z = Object.freeze([0, 1, 0, 0]);
const AXIAL_Z_TO_Y = Object.freeze([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);

const constantPosition = (value) => ({ kind: "constant-v1", value });
const sizeFraction = (value) => ({ kind: "size-fraction-v1", value });
const configScalarAxis = (field, axis, factor = 1) => ({
  kind: "config-scalar-axis-v1",
  field,
  axis,
  factor,
});
const flexibleEndpoint = (endpoint) => ({
  kind: "flexible-endpoint-v1",
  endpoint,
});
const mechanismReferenceEndpoint = (endpoint) => ({
  kind: "mechanism-reference-endpoint-v1",
  endpoint,
});
const frame = (position, orientation = IDENTITY) => ({
  position,
  orientation,
});
const face = (axis, sign) => {
  const fraction = [0, 0, 0];
  fraction[axis] = sign / 2;
  const directions = [
    sign < 0
      ? [0, -Math.SQRT1_2, 0, Math.SQRT1_2]
      : [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    sign < 0
      ? [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
      : [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    sign < 0 ? FLIP_Z : IDENTITY,
  ];
  return frame(sizeFraction(fraction), directions[axis]);
};

const boxGeometry = {
  kind: "box-v1",
  fullSize: { kind: "config-vector-v1", field: "size" },
};
const primitive = (id, geometry, options = {}) => ({
  id,
  frame: options.frame || frame(constantPosition([0, 0, 0])),
  geometry,
  semanticKey: options.semanticKey || id,
  materialKey: options.materialKey || "generic-structure",
  contactRole: options.contactRole || "structure",
  approximationOf: options.approximationOf || null,
});

function ordinary({
  ports,
  bodyPrimitives = [primitive("body", boxGeometry)],
  collisionPrimitives = [primitive("collision", boxGeometry)],
  physicalFeatures = [],
  geometryClass = "rigid-static-v1",
  dimensionalScalingPolicy = "axis-aligned-affine-v1",
}) {
  return {
    schemaVersion: 1,
    kind: "primitive-component-geometry-v1",
    geometryClass,
    dimensionalScalingPolicy,
    portFrames: ports,
    collisionPrimitives,
    bodyPrimitives,
    physicalFeatures,
  };
}

function shapedOrdinary({ ports, id, geometry, orientation = IDENTITY }) {
  return ordinary({
    ports,
    bodyPrimitives: [
      primitive(id, geometry, {
        frame: frame(constantPosition([0, 0, 0]), orientation),
      }),
    ],
    collisionPrimitives: [
      primitive("collision", boxGeometry, { approximationOf: id }),
    ],
  });
}

function mechanism({
  ports,
  geometryClass = "rigid-static-v1",
  deformationContract = null,
}) {
  return {
    schemaVersion: 1,
    kind: "mechanism-component-geometry-v1",
    geometryClass,
    dimensionalScalingPolicy: "fixed-authored-size-v1",
    portFrames: ports,
    collisionPrimitives: { kind: "mechanism-collision-regions-v1" },
    bodyPrimitives: { kind: "mechanism-collision-regions-v1" },
    physicalFeatures: [],
    deformationContract,
  };
}

const genericFaces = (ids) =>
  Object.fromEntries(
    ids.map((id, index) => {
      const faces = [
        face(0, -1),
        face(0, 1),
        face(1, 1),
        face(1, -1),
        face(2, 1),
        face(2, -1),
      ];
      return [id, faces[index % faces.length]];
    }),
  );

const mechanismFrames = {
  axle: {
    LEFT: frame(constantPosition([0, 0, -1]), FLIP_Z),
    RIGHT: frame(constantPosition([0, 0, 1])),
    JOURNAL: frame(constantPosition([0, 0, 0])),
  },
  bearing: {
    MOUNT: frame(constantPosition([0, 0, -0.17]), FLIP_Z),
    SHAFT: frame(constantPosition([0, 0, 0])),
  },
  hinge: {
    // A revolute joint has one physical pivot line. BASE and ARM are distinct
    // attachment roles with opposing normals, not two translated pivots.
    BASE: frame(constantPosition([0, 0, 0]), FLIP_Z),
    ARM: frame(constantPosition([0, 0, 0])),
  },
  spring: {
    END_A: frame(mechanismReferenceEndpoint("a"), FLIP_Z),
    END_B: frame(mechanismReferenceEndpoint("b")),
  },
  damper: {
    END_A: frame(constantPosition([0, 0, -0.5]), FLIP_Z),
    END_B: frame(constantPosition([0, 0, 0.5])),
  },
  "release-coupler": {
    FLANGE_A: frame(constantPosition([0, 0, -0.1]), FLIP_Z),
    FLANGE_B: frame(constantPosition([0, 0, 0.1])),
  },
  "linear-guide": {
    BASE: frame(constantPosition([0, 0, -0.5]), FLIP_Z),
    SLIDER: frame(constantPosition([0, 0, 0.5])),
  },
  "linear-actuator": {
    BASE: frame(constantPosition([0, 0, -0.55]), FLIP_Z),
    ROD: frame(constantPosition([0, 0, 0.55])),
  },
  wheel: {
    AXLE: frame(constantPosition([0, 0, 0])),
    SURFACE: frame(constantPosition([0, 0.65, 0]), [
      -Math.SQRT1_2,
      0,
      0,
      Math.SQRT1_2,
    ]),
    AIR: frame(constantPosition([0, 0, 0.21])),
  },
};

const axialDeformation = (primitiveIds) => ({
  kind: "mechanism-deformation-v1",
  coordinates: [
    {
      id: "axial-extension",
      telemetryField: "axialScale",
      projection: "anchor-local-z-scale-v1",
      primitiveIds,
      referenceValue: 1,
      allowedRange: { minimum: 0.25, maximum: 2 },
    },
  ],
});

const gearDefinition = ordinary({
  ports: {
    AXLE: frame(constantPosition([0, 0, 0])),
    MESH: {
      ...frame(configScalarAxis("radius", 0)),
      clearanceM: 0.0275,
    },
  },
  collisionPrimitives: [
    primitive("collision", {
      kind: "cylinder-v1",
      radius: { kind: "config-scalar-v1", field: "radius" },
      axialLengthM: 0.22,
    }),
  ],
  bodyPrimitives: [
    primitive("gear-body", {
      kind: "cylinder-v1",
      radius: { kind: "config-scalar-v1", field: "radius" },
      axialLengthM: 0.22,
    }),
  ],
});

const radialRotorDefinition = {
  schemaVersion: 1,
  kind: "radial-rotor-component-geometry-v1",
  geometryClass: "rigid-static-v1",
  dimensionalScalingPolicy: "fixed-authored-size-v1",
  portFrames: {
    SHAFT: frame(configScalarAxis("hubThicknessM", 2, -0.5), FLIP_Z),
  },
  collisionPrimitives: { kind: "radial-rotor-hub-v1" },
  bodyPrimitives: { kind: "radial-rotor-body-v1" },
  physicalFeatures: [],
};

export const COMPONENT_GEOMETRY_DEFINITIONS = deepFreeze({
  beam: ordinary({
    ports: { A: face(0, -1), B: face(0, 1), SURFACE: face(1, 1) },
  }),
  plate: ordinary({ ports: { TOP: face(1, 1), BOTTOM: face(1, -1) } }),
  cargo: ordinary({
    ports: genericFaces(["MOUNT A", "MOUNT B", "MOUNT C", "MOUNT D"]),
  }),
  nosecone: ordinary({
    ports: { BASE: face(1, -1) },
    bodyPrimitives: [
      primitive(
        "nosecone-body",
        {
          kind: "cone-v1",
          startRadiusM: 0.46,
          endRadiusM: 0,
          axialLengthM: 1.28,
        },
        {
          frame: frame(constantPosition([0, 0.04, 0]), [
            -Math.SQRT1_2,
            0,
            0,
            Math.SQRT1_2,
          ]),
        },
      ),
    ],
    collisionPrimitives: [
      primitive("collision", boxGeometry, { approximationOf: "nosecone-body" }),
    ],
  }),
  heatshield: ordinary({
    ports: { BACK: face(1, 1) },
    bodyPrimitives: [
      primitive(
        "heatshield-body",
        {
          kind: "cone-v1",
          startRadiusM: 0.58,
          endRadiusM: 0.48,
          axialLengthM: 0.3,
        },
        {
          frame: frame(constantPosition([0, 0, 0]), [
            -Math.SQRT1_2,
            0,
            0,
            Math.SQRT1_2,
          ]),
        },
      ),
    ],
    collisionPrimitives: [
      primitive("collision", boxGeometry, {
        approximationOf: "heatshield-body",
      }),
    ],
  }),
  fin: ordinary({ ports: { ROOT: face(0, -1) } }),
  axle: mechanism({ ports: mechanismFrames.axle }),
  bearing: mechanism({ ports: mechanismFrames.bearing }),
  gear12: gearDefinition,
  gear24: gearDefinition,
  motor: ordinary({
    ports: {
      MOUNT: frame(constantPosition([0, 0, -0.5]), FLIP_Z),
      SHAFT: frame(constantPosition([0, 0, 0.92])),
    },
    bodyPrimitives: [
      primitive("motor-housing", {
        kind: "cylinder-v1",
        radiusM: 0.48,
        axialLengthM: 1,
      }),
    ],
    collisionPrimitives: [
      primitive("collision", boxGeometry, { approximationOf: "motor-housing" }),
    ],
    physicalFeatures: [
      {
        id: "shaft",
        primitive: "cylinder-v1",
        anchor: { kind: "port-frame-v1", portId: "SHAFT", offsetM: [0, 0, 0] },
        dimensions: { radiusM: 0.11, lengthM: 0.48 },
        axialOrigin: "end-v1",
        role: "physical-interface",
        materialKey: "steel",
      },
    ],
  }),
  rotor: radialRotorDefinition,
  hinge: mechanism({ ports: mechanismFrames.hinge }),
  lever: ordinary({ ports: { PIVOT: face(1, -1), LINK: face(1, 1) } }),
  spring: mechanism({
    ports: mechanismFrames.spring,
    geometryClass: "mechanism-deformed-v1",
    deformationContract: axialDeformation(["housing"]),
  }),
  rope: {
    schemaVersion: 1,
    kind: "flexible-line-component-geometry-v1",
    geometryClass: "runtime-flexible-v1",
    dimensionalScalingPolicy: "fixed-authored-size-v1",
    portFrames: {
      END_A: frame(flexibleEndpoint("a"), FLIP_Z),
      END_B: frame(flexibleEndpoint("b")),
    },
    collisionPrimitives: [],
    bodyPrimitives: [],
    physicalFeatures: [],
  },
  damper: mechanism({
    ports: mechanismFrames.damper,
    geometryClass: "mechanism-deformed-v1",
    deformationContract: axialDeformation(["housing"]),
  }),
  "release-coupler": mechanism({ ports: mechanismFrames["release-coupler"] }),
  "linear-guide": mechanism({ ports: mechanismFrames["linear-guide"] }),
  "linear-actuator": mechanism({
    ports: mechanismFrames["linear-actuator"],
    geometryClass: "mechanism-deformed-v1",
    deformationContract: axialDeformation(["housing"]),
  }),
  wheel: mechanism({ ports: mechanismFrames.wheel }),
  aircompressor: ordinary({
    ports: genericFaces(["MOUNT", "POWER", "CONTROL", "AIR"]),
  }),
  airreservoir: shapedOrdinary({
    ports: genericFaces(["MOUNT", "AIR"]),
    id: "reservoir-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.375, axialLengthM: 1.1 },
  }),
  pneumaticvalve: ordinary({
    ports: genericFaces(["MOUNT", "POWER", "CONTROL", "SUPPLY", "TIRE"]),
  }),
  computer: ordinary({ ports: { MOUNT: face(1, -1) } }),
  receiver: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "receiver-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.25, axialLengthM: 0.22 },
    orientation: AXIAL_Z_TO_Y,
  }),
  navsensor: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "navigation-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.275, axialLengthM: 0.2 },
    orientation: AXIAL_Z_TO_Y,
  }),
  rangesensor: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "rangefinder-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.21, axialLengthM: 0.52 },
    orientation: AXIAL_Z_TO_Y,
  }),
  sensor: shapedOrdinary({
    ports: {
      MOUNT: face(2, 1),
      SHAFT: frame(constantPosition([0, 0, -0.14]), FLIP_Z),
    },
    id: "rotation-sensor-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.225, axialLengthM: 0.28 },
  }),
  imu: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "imu-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.25, axialLengthM: 0.18 },
    orientation: AXIAL_Z_TO_Y,
  }),
  contactsensor: shapedOrdinary({
    ports: { MOUNT: face(1, 1) },
    id: "contact-pad-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.24, axialLengthM: 0.16 },
    orientation: AXIAL_Z_TO_Y,
  }),
  thermalprobe: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "thermal-probe-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.14, axialLengthM: 0.5 },
    orientation: AXIAL_Z_TO_Y,
  }),
  pressureprobe: shapedOrdinary({
    ports: { MOUNT: face(2, 1) },
    id: "air-data-probe-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.15, axialLengthM: 0.65 },
  }),
  tirepressureprobe: ordinary({
    ports: genericFaces(["MOUNT", "POWER", "SIGNAL", "AIR"]),
  }),
  loadcell: shapedOrdinary({
    ports: { A: face(1, -1), B: face(1, 1) },
    id: "load-cell-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.275, axialLengthM: 0.22 },
    orientation: AXIAL_Z_TO_Y,
  }),
  gyro: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "reaction-wheel-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.325, axialLengthM: 0.3 },
  }),
  battery: ordinary({ ports: { MOUNT: face(1, -1) } }),
  propellanttank: ordinary({
    ports: { MOUNT: face(1, 1), OUTLET: face(1, -1) },
    bodyPrimitives: [
      primitive(
        "tank-body",
        {
          kind: "capsule-v1",
          radiusM: 0.53,
          cylinderLengthM: 1.25,
        },
        {
          frame: frame(constantPosition([0, 0, 0]), [
            -Math.SQRT1_2,
            0,
            0,
            Math.SQRT1_2,
          ]),
        },
      ),
    ],
    collisionPrimitives: [
      primitive("collision", boxGeometry, { approximationOf: "tank-body" }),
    ],
  }),
  powerbus: ordinary({ ports: { MOUNT: face(1, -1) } }),
  headlight: shapedOrdinary({
    ports: { MOUNT: face(2, 1) },
    id: "lamp-housing",
    geometry: { kind: "cylinder-v1", radiusM: 0.21, axialLengthM: 0.34 },
  }),
  rocket: shapedOrdinary({
    ports: { MOUNT: face(1, 1), PROPELLANT: face(1, 1) },
    id: "thruster-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.4, axialLengthM: 1.15 },
    orientation: AXIAL_Z_TO_Y,
  }),
  rcs: shapedOrdinary({
    ports: { MOUNT: face(1, -1), PROPELLANT: face(1, 1) },
    id: "rcs-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.36, axialLengthM: 0.42 },
    orientation: AXIAL_Z_TO_Y,
  }),
});

export const REGISTERED_COMPONENT_GEOMETRY_TYPES = Object.freeze(
  Object.keys(COMPONENT_GEOMETRY_DEFINITIONS),
);
