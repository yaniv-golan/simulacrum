import { deepFreeze } from "./primitives.js";

const IDENTITY = Object.freeze([0, 0, 0, 1]);
const FLIP_Z = Object.freeze([0, 1, 0, 0]);

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
  computer: ordinary({ ports: { MOUNT: face(1, -1) } }),
  receiver: ordinary({ ports: { MOUNT: face(1, -1) } }),
  navsensor: ordinary({ ports: { MOUNT: face(1, -1) } }),
  rangesensor: ordinary({ ports: { MOUNT: face(1, -1) } }),
  sensor: ordinary({
    ports: {
      MOUNT: face(2, 1),
      SHAFT: frame(constantPosition([0, 0, -0.14]), FLIP_Z),
    },
  }),
  imu: ordinary({ ports: { MOUNT: face(1, -1) } }),
  contactsensor: ordinary({ ports: { MOUNT: face(1, 1) } }),
  thermalprobe: ordinary({ ports: { MOUNT: face(1, -1) } }),
  pressureprobe: ordinary({ ports: { MOUNT: face(2, 1) } }),
  loadcell: ordinary({ ports: { A: face(1, -1), B: face(1, 1) } }),
  gyro: ordinary({ ports: { MOUNT: face(1, -1) } }),
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
  headlight: ordinary({ ports: { MOUNT: face(2, 1) } }),
  rocket: ordinary({ ports: { MOUNT: face(1, 1), PROPELLANT: face(1, 1) } }),
  rcs: ordinary({ ports: { MOUNT: face(1, -1), PROPELLANT: face(1, 1) } }),
});

export const REGISTERED_COMPONENT_GEOMETRY_TYPES = Object.freeze(
  Object.keys(COMPONENT_GEOMETRY_DEFINITIONS),
);
