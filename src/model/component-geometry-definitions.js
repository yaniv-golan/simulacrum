import { deepFreeze } from "./primitives.js";

const IDENTITY = Object.freeze([0, 0, 0, 1]);
const FLIP_Z = Object.freeze([0, 1, 0, 0]);
const AXIAL_Z_TO_Y = Object.freeze([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
const AXIAL_Z_TO_X = Object.freeze([0, Math.SQRT1_2, 0, Math.SQRT1_2]);

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
const roundedBoxGeometry = {
  kind: "rounded-box-v1",
  fullSize: { kind: "config-vector-v1", field: "size" },
  radiusM: 0.035,
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
  bodyPrimitives = [primitive("body", roundedBoxGeometry)],
  collisionPrimitives = [
    primitive("collision", boxGeometry, {
      approximationOf: bodyPrimitives[0].id,
    }),
  ],
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

function shapedOrdinary({
  ports,
  id,
  geometry,
  orientation = IDENTITY,
  bodyPrimitives = null,
  physicalFeatures = [],
  dimensionalScalingPolicy = "axis-aligned-affine-v1",
}) {
  const resolvedBodyPrimitives = bodyPrimitives || [
    primitive(id, geometry, {
      frame: frame(constantPosition([0, 0, 0]), orientation),
    }),
  ];
  return ordinary({
    ports,
    bodyPrimitives: resolvedBodyPrimitives,
    collisionPrimitives: [
      primitive("collision", boxGeometry, {
        approximationOf: resolvedBodyPrimitives[0].id,
      }),
    ],
    physicalFeatures,
    dimensionalScalingPolicy,
  });
}

function mechanism({
  ports,
  bodyPrimitives,
  geometryClass = "rigid-static-v1",
  deformationContract = null,
  collisionApproximationOf = null,
}) {
  return {
    schemaVersion: 1,
    kind: "mechanism-component-geometry-v1",
    geometryClass,
    dimensionalScalingPolicy: "fixed-authored-size-v1",
    portFrames: ports,
    collisionPrimitives: {
      kind: "mechanism-collision-regions-v1",
      approximationOf: collisionApproximationOf,
    },
    bodyPrimitives,
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
    "JOURNAL LEFT": frame(constantPosition([0, 0, -0.62]), FLIP_Z),
    "JOURNAL RIGHT": frame(constantPosition([0, 0, 0.62])),
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

const mechanismDeformation = (projections) => ({
  kind: "mechanism-deformation-v1",
  coordinates: [
    {
      id: "axial-extension",
      projections,
      referenceCoordinateM: 1,
      referenceBodyLengthM: 1,
      allowedCoordinateRangeM: { minimum: 0.25, maximum: 2 },
    },
  ],
});

const axialScaleDeformation = (primitiveIds) =>
  mechanismDeformation([
    {
      id: "axial-scale",
      kind: "anchor-local-z-scale-v1",
      primitiveIds,
    },
  ]);

const opposedEndpointDeformation = (primitiveIdsA, primitiveIdsB) =>
  mechanismDeformation([
    {
      id: "endpoint-a-translation",
      kind: "local-z-translation-v1",
      primitiveIds: Array.isArray(primitiveIdsA)
        ? primitiveIdsA
        : [primitiveIdsA],
      gainMPerM: -0.5,
    },
    {
      id: "endpoint-b-translation",
      kind: "local-z-translation-v1",
      primitiveIds: Array.isArray(primitiveIdsB)
        ? primitiveIdsB
        : [primitiveIdsB],
      gainMPerM: 0.5,
    },
  ]);

const mechanismBody = {
  axle: [
    primitive("shaft", {
      kind: "cylinder-v1",
      radiusM: 0.09,
      axialLengthM: 2,
    }),
  ],
  bearing: [
    primitive(
      "bearing-housing",
      {
        kind: "rounded-box-v1",
        fullSizeM: [0.72, 0.58, 0.34],
        radiusM: 0.08,
      },
      { materialKey: "workshop-steel" },
    ),
    primitive(
      "bearing-ring",
      { kind: "cylinder-v1", radiusM: 0.24, axialLengthM: 0.38 },
      { materialKey: "workshop-steel" },
    ),
  ],
  hinge: [
    primitive(
      "hinge-pin",
      { kind: "cylinder-v1", radiusM: 0.055, axialLengthM: 0.28 },
      { materialKey: "workshop-steel" },
    ),
    ...[-0.1, 0.1].map((offsetM, index) =>
      primitive(
        `hinge-knuckle-${index + 1}`,
        { kind: "cylinder-v1", radiusM: 0.105, axialLengthM: 0.08 },
        {
          frame: frame(constantPosition([0, 0, offsetM])),
          materialKey: "workshop-steel",
        },
      ),
    ),
  ],
  spring: [
    primitive(
      "spring-coil",
      {
        kind: "helical-spring-v1",
        meanCoilRadiusM: 0.16,
        wireRadiusM: 0.018,
        activeTurns: 7,
        endTreatment: "closed-ground-v1",
        referenceAxialLengthM: 1.1,
      },
      {
        semanticKey: "spring-coil:non-evidentiary-manufacturing-profile-v1",
        materialKey: "workshop-steel",
      },
    ),
  ],
  damper: [
    primitive(
      "damper-tube",
      { kind: "cylinder-v1", radiusM: 0.13, axialLengthM: 0.62 },
      {
        frame: frame(constantPosition([0, 0, -0.19])),
        materialKey: "workshop-steel",
      },
    ),
    primitive(
      "damper-rod",
      { kind: "cylinder-v1", radiusM: 0.055, axialLengthM: 0.55 },
      {
        frame: frame(constantPosition([0, 0, 0.225])),
        materialKey: "workshop-steel",
      },
    ),
    primitive(
      "damper-seal",
      { kind: "cylinder-v1", radiusM: 0.13, axialLengthM: 0.04 },
      {
        frame: frame(constantPosition([0, 0, 0.1])),
        materialKey: "tire-rubber",
      },
    ),
    primitive(
      "damper-end-cap",
      { kind: "cylinder-v1", radiusM: 0.13, axialLengthM: 0.035 },
      {
        frame: frame(constantPosition([0, 0, -0.48])),
        materialKey: "workshop-steel",
      },
    ),
    ...[-0.5, 0.5].map((offsetM, index) =>
      primitive(
        `damper-flange-${index + 1}`,
        { kind: "cylinder-v1", radiusM: 0.13, axialLengthM: 0.035 },
        {
          frame: frame(
            constantPosition([0, 0, offsetM - Math.sign(offsetM) * 0.0175]),
          ),
          materialKey: "workshop-steel",
        },
      ),
    ),
  ],
  "release-coupler": [
    ...[-0.07, 0.07].map((offsetM, index) =>
      primitive(
        `coupler-flange-${index + 1}`,
        { kind: "cylinder-v1", radiusM: 0.22, axialLengthM: 0.06 },
        {
          frame: frame(constantPosition([0, 0, offsetM])),
          materialKey: "workshop-steel",
        },
      ),
    ),
    primitive(
      "coupler-latch",
      {
        kind: "rounded-box-v1",
        fullSizeM: [0.24, 0.18, 0.12],
        radiusM: 0.025,
      },
      { materialKey: "workshop-steel" },
    ),
  ],
  "linear-guide": [
    ...[-0.34, 0.34].map((offsetM, index) =>
      primitive(
        `guide-rail-${index + 1}`,
        { kind: "box-v1", fullSizeM: [0.12, 0.45, 1] },
        {
          frame: frame(constantPosition([offsetM, 0, 0])),
          materialKey: "workshop-steel",
        },
      ),
    ),
    primitive(
      "guide-slider",
      {
        kind: "rounded-box-v1",
        fullSizeM: [0.82, 0.5, 0.22],
        radiusM: 0.045,
      },
      { materialKey: "workshop-aluminum" },
    ),
    primitive(
      "guide-base-flange",
      {
        kind: "rounded-box-v1",
        fullSizeM: [0.82, 0.5, 0.08],
        radiusM: 0.025,
      },
      {
        frame: frame(constantPosition([0, 0, -0.46])),
        materialKey: "workshop-steel",
      },
    ),
    primitive(
      "guide-slider-flange",
      {
        kind: "rounded-box-v1",
        fullSizeM: [0.82, 0.5, 0.08],
        radiusM: 0.025,
      },
      {
        frame: frame(constantPosition([0, 0, 0.12])),
        materialKey: "workshop-aluminum",
      },
    ),
  ],
  "linear-actuator": [
    primitive(
      "actuator-tube",
      { kind: "cylinder-v1", radiusM: 0.17, axialLengthM: 0.68 },
      {
        frame: frame(constantPosition([0, 0, -0.21])),
        materialKey: "workshop-steel",
      },
    ),
    primitive(
      "actuator-rod",
      { kind: "cylinder-v1", radiusM: 0.075, axialLengthM: 0.6 },
      {
        frame: frame(constantPosition([0, 0, 0.25])),
        materialKey: "workshop-steel",
      },
    ),
    primitive(
      "actuator-seal",
      { kind: "cylinder-v1", radiusM: 0.17, axialLengthM: 0.045 },
      {
        frame: frame(constantPosition([0, 0, 0.115])),
        materialKey: "tire-rubber",
      },
    ),
    primitive(
      "actuator-end-cap",
      { kind: "cylinder-v1", radiusM: 0.17, axialLengthM: 0.035 },
      {
        frame: frame(constantPosition([0, 0, -0.53])),
        materialKey: "workshop-steel",
      },
    ),
    ...[-0.55, 0.55].map((offsetM, index) =>
      primitive(
        `actuator-flange-${index + 1}`,
        { kind: "cylinder-v1", radiusM: 0.17, axialLengthM: 0.035 },
        {
          frame: frame(
            constantPosition([0, 0, offsetM - Math.sign(offsetM) * 0.0175]),
          ),
          materialKey: "workshop-steel",
        },
      ),
    ),
  ],
  wheel: [
    primitive(
      "tire-envelope",
      {
        kind: "rounded-wheel-v1",
        radiusM: 0.65,
        widthM: 0.42,
        shoulderRadiusM: 0.08,
      },
      {
        semanticKey: "tire-envelope",
        materialKey: "tire-rubber",
        contactRole: "tire-envelope",
      },
    ),
    primitive(
      "rim",
      { kind: "cylinder-v1", radiusM: 0.5, axialLengthM: 0.46 },
      {
        semanticKey: "rim",
        materialKey: "workshop-aluminum",
        contactRole: "rim",
      },
    ),
  ],
};

const GEAR_MODULE_M = 0.82 / 12;
const gearDefinition = (
  toothCount,
  boreRadiusM,
  hubRadiusM,
  toothPhaseRad = 0,
) => {
  const pitchRadiusM = (GEAR_MODULE_M * toothCount) / 2;
  return ordinary({
    ports: {
      AXLE: frame(constantPosition([0, 0, 0])),
      MESH: {
        ...frame(configScalarAxis("radius", 0)),
        clearanceM: 0,
      },
    },
    collisionPrimitives: [
      primitive(
        "collision",
        {
          kind: "cylinder-v1",
          radius: { kind: "config-scalar-v1", field: "radius" },
          axialLengthM: 0.22,
        },
        { approximationOf: "gear-body" },
      ),
    ],
    bodyPrimitives: [
      primitive(
        "gear-body",
        {
          kind: "spur-gear-v1",
          toothCount,
          toothPhaseRad,
          pitchRadiusM,
          pressureAngleRad: (20 * Math.PI) / 180,
          moduleM: GEAR_MODULE_M,
          axialThicknessM: 0.22,
          rootRadiusM: pitchRadiusM - 1.25 * GEAR_MODULE_M,
          tipRadiusM: pitchRadiusM + GEAR_MODULE_M,
          boreRadiusM,
          hubRadiusM,
          hubThicknessM: 0.3,
        },
        { materialKey: "workshop-steel" },
      ),
    ],
  });
};

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
  fin: ordinary({
    ports: { ROOT: face(0, -1) },
    bodyPrimitives: [
      primitive("fin-profile", {
        kind: "extruded-profile-v1",
        pointsM: [
          [-0.06, -0.525],
          [0.06, -0.525],
          [0.035, 0.525],
          [-0.055, 0.24],
        ],
        axialThicknessM: 0.72,
      }),
    ],
  }),
  axle: mechanism({
    ports: mechanismFrames.axle,
    bodyPrimitives: mechanismBody.axle,
  }),
  bearing: mechanism({
    ports: mechanismFrames.bearing,
    bodyPrimitives: mechanismBody.bearing,
  }),
  gear12: gearDefinition(12, 0.1, 0.2),
  // At the stock +X/-X pitch contact, pinion tooth zero meets this gear's
  // half-pitch gap. Runtime counter-rotation preserves that engagement phase.
  gear24: gearDefinition(24, 0.14, 0.3, Math.PI / 24),
  motor: ordinary({
    ports: {
      MOUNT: frame(constantPosition([0, 0, -0.5]), FLIP_Z),
      POWER: frame(constantPosition([0.3, 0.28, -0.46]), FLIP_Z),
      CONTROL: frame(constantPosition([-0.3, 0.28, -0.46]), FLIP_Z),
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
  hinge: mechanism({
    ports: mechanismFrames.hinge,
    bodyPrimitives: mechanismBody.hinge,
  }),
  lever: ordinary({ ports: { PIVOT: face(1, -1), LINK: face(1, 1) } }),
  spring: mechanism({
    ports: mechanismFrames.spring,
    bodyPrimitives: mechanismBody.spring,
    geometryClass: "mechanism-deformed-v1",
    deformationContract: axialScaleDeformation(["spring-coil"]),
    collisionApproximationOf: "spring-coil",
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
    bodyPrimitives: mechanismBody.damper,
    geometryClass: "mechanism-deformed-v1",
    deformationContract: opposedEndpointDeformation(
      ["damper-tube", "damper-seal", "damper-end-cap", "damper-flange-1"],
      ["damper-rod", "damper-flange-2"],
    ),
  }),
  "release-coupler": mechanism({
    ports: mechanismFrames["release-coupler"],
    bodyPrimitives: mechanismBody["release-coupler"],
  }),
  "linear-guide": mechanism({
    ports: mechanismFrames["linear-guide"],
    bodyPrimitives: mechanismBody["linear-guide"],
    geometryClass: "mechanism-deformed-v1",
    deformationContract: mechanismDeformation([
      {
        id: "slider-translation",
        kind: "local-z-translation-v1",
        primitiveIds: ["guide-slider", "guide-slider-flange"],
        gainMPerM: 1,
      },
    ]),
  }),
  "linear-actuator": mechanism({
    ports: mechanismFrames["linear-actuator"],
    bodyPrimitives: mechanismBody["linear-actuator"],
    geometryClass: "mechanism-deformed-v1",
    deformationContract: opposedEndpointDeformation(
      [
        "actuator-tube",
        "actuator-seal",
        "actuator-end-cap",
        "actuator-flange-1",
      ],
      ["actuator-rod", "actuator-flange-2"],
    ),
  }),
  wheel: mechanism({
    ports: mechanismFrames.wheel,
    bodyPrimitives: mechanismBody.wheel,
  }),
  aircompressor: ordinary({
    ports: genericFaces(["MOUNT", "POWER", "CONTROL", "AIR"]),
    bodyPrimitives: [
      primitive("body", roundedBoxGeometry),
      primitive(
        "compressor-motor",
        { kind: "cylinder-v1", radiusM: 0.18, axialLengthM: 0.65 },
        {
          frame: frame(constantPosition([0, 0.34, 0]), AXIAL_Z_TO_X),
          semanticKey: "compressor-motor",
          materialKey: "workshop-steel",
        },
      ),
    ],
    collisionPrimitives: [
      primitive("collision", boxGeometry, { approximationOf: "body" }),
      primitive(
        "compressor-motor-collision",
        { kind: "cylinder-v1", radiusM: 0.18, axialLengthM: 0.65 },
        {
          frame: frame(constantPosition([0, 0.34, 0]), AXIAL_Z_TO_X),
          approximationOf: "compressor-motor",
        },
      ),
    ],
  }),
  airreservoir: shapedOrdinary({
    ports: genericFaces(["MOUNT", "AIR"]),
    id: "reservoir-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.375, axialLengthM: 1.1 },
    physicalFeatures: [
      {
        id: "air-neck",
        primitive: "cylinder-v1",
        anchor: { kind: "port-frame-v1", portId: "AIR", offsetM: [0, 0, 0] },
        dimensions: { radiusM: 0.075, lengthM: 0.14 },
        axialOrigin: "start-v1",
        role: "physical-interface",
        materialKey: "workshop-steel",
      },
    ],
  }),
  pneumaticvalve: ordinary({
    ports: genericFaces(["MOUNT", "POWER", "CONTROL", "SUPPLY", "TIRE"]),
    bodyPrimitives: [
      primitive("body", roundedBoxGeometry),
      ...[-0.2, 0.2].map((x, index) =>
        primitive(
          `valve-solenoid-${index + 1}`,
          { kind: "cylinder-v1", radiusM: 0.11, axialLengthM: 0.22 },
          {
            frame: frame(constantPosition([x, 0.3, 0]), AXIAL_Z_TO_Y),
            semanticKey: "valve-solenoid",
            materialKey: "workshop-steel",
          },
        ),
      ),
    ],
    collisionPrimitives: [
      primitive("collision", boxGeometry, { approximationOf: "body" }),
      ...[-0.2, 0.2].map((x, index) =>
        primitive(
          `valve-solenoid-${index + 1}-collision`,
          { kind: "cylinder-v1", radiusM: 0.11, axialLengthM: 0.22 },
          {
            frame: frame(constantPosition([x, 0.3, 0]), AXIAL_Z_TO_Y),
            approximationOf: `valve-solenoid-${index + 1}`,
          },
        ),
      ),
    ],
  }),
  computer: ordinary({
    ports: {
      MOUNT: face(1, -1),
      POWER: frame(constantPosition([-0.3, 0.16, -0.32])),
      "IN A": frame(constantPosition([-0.12, 0.16, 0.32])),
      "IN B": frame(constantPosition([0.12, 0.16, 0.32])),
      OUT: frame(constantPosition([0.3, 0.16, -0.32])),
    },
  }),
  receiver: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "receiver-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.25, axialLengthM: 0.22 },
    orientation: AXIAL_Z_TO_Y,
    bodyPrimitives: [
      primitive(
        "receiver-body",
        { kind: "cylinder-v1", radiusM: 0.25, axialLengthM: 0.22 },
        {
          frame: frame(constantPosition([0, 0, 0]), AXIAL_Z_TO_Y),
        },
      ),
      primitive(
        "receiver-antenna",
        { kind: "cylinder-v1", radiusM: 0.035, axialLengthM: 0.38 },
        {
          frame: frame(constantPosition([0.14, 0.19, 0]), AXIAL_Z_TO_Y),
          semanticKey: "receiver-antenna",
          materialKey: "workshop-steel",
        },
      ),
    ],
  }),
  navsensor: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "navigation-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.275, axialLengthM: 0.2 },
    orientation: AXIAL_Z_TO_Y,
    bodyPrimitives: [
      primitive(
        "navigation-base",
        { kind: "cylinder-v1", radiusM: 0.275, axialLengthM: 0.12 },
        {
          frame: frame(constantPosition([0, -0.04, 0]), AXIAL_Z_TO_Y),
          semanticKey: "navigation-body",
        },
      ),
      primitive(
        "navigation-dome",
        {
          kind: "cone-v1",
          startRadiusM: 0.24,
          endRadiusM: 0.12,
          axialLengthM: 0.14,
        },
        {
          frame: frame(constantPosition([0, 0.09, 0]), AXIAL_Z_TO_Y),
          semanticKey: "navigation-radome",
        },
      ),
    ],
    dimensionalScalingPolicy: "uniform-similarity-v1",
  }),
  rangesensor: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "rangefinder-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.21, axialLengthM: 0.52 },
    orientation: AXIAL_Z_TO_Y,
    bodyPrimitives: [
      primitive(
        "rangefinder-body",
        { kind: "cylinder-v1", radiusM: 0.21, axialLengthM: 0.48 },
        {
          frame: frame(constantPosition([0, -0.02, 0]), AXIAL_Z_TO_Y),
        },
      ),
      primitive(
        "rangefinder-aperture",
        { kind: "cylinder-v1", radiusM: 0.14, axialLengthM: 0.035 },
        {
          frame: frame(constantPosition([0, 0.2375, 0]), AXIAL_Z_TO_Y),
          semanticKey: "sensor-aperture",
          materialKey: "workshop-steel",
        },
      ),
    ],
  }),
  sensor: shapedOrdinary({
    ports: {
      MOUNT: face(2, 1),
      SHAFT: frame(constantPosition([0, 0, -0.14]), FLIP_Z),
      SIGNAL: frame(constantPosition([0, 0.225, 0.08])),
    },
    id: "rotation-sensor-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.225, axialLengthM: 0.28 },
    bodyPrimitives: [
      primitive("rotation-sensor-body", {
        kind: "cylinder-v1",
        radiusM: 0.225,
        axialLengthM: 0.28,
      }),
      primitive(
        "rotation-sensor-flange",
        { kind: "cylinder-v1", radiusM: 0.285, axialLengthM: 0.055 },
        {
          frame: frame(constantPosition([0, 0, -0.1125])),
          semanticKey: "encoder-mounting-flange",
          materialKey: "workshop-steel",
        },
      ),
    ],
    physicalFeatures: [
      {
        id: "encoder-shaft",
        primitive: "cylinder-v1",
        anchor: {
          kind: "port-frame-v1",
          portId: "SHAFT",
          offsetM: [0, 0, 0],
        },
        dimensions: { radiusM: 0.065, lengthM: 0.18 },
        axialOrigin: "start-v1",
        role: "physical-interface",
        materialKey: "steel",
      },
    ],
  }),
  imu: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "imu-body",
    geometry: {
      kind: "rounded-box-v1",
      fullSizeM: [0.48, 0.18, 0.48],
      radiusM: 0.045,
    },
  }),
  contactsensor: shapedOrdinary({
    ports: { MOUNT: face(1, 1) },
    id: "contact-pad-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.24, axialLengthM: 0.16 },
    orientation: AXIAL_Z_TO_Y,
    bodyPrimitives: [
      primitive(
        "contact-pad-body",
        {
          kind: "rounded-box-v1",
          fullSizeM: [0.5, 0.12, 0.5],
          radiusM: 0.055,
        },
        { frame: frame(constantPosition([0, -0.02, 0])) },
      ),
      primitive(
        "contact-button",
        { kind: "cylinder-v1", radiusM: 0.18, axialLengthM: 0.1 },
        {
          frame: frame(constantPosition([0, 0.09, 0]), AXIAL_Z_TO_Y),
          semanticKey: "contact-button",
          materialKey: "tire-rubber",
        },
      ),
    ],
  }),
  thermalprobe: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "thermal-probe-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.14, axialLengthM: 0.5 },
    orientation: AXIAL_Z_TO_Y,
    bodyPrimitives: [
      primitive(
        "thermal-probe-housing",
        { kind: "cylinder-v1", radiusM: 0.14, axialLengthM: 0.18 },
        {
          frame: frame(constantPosition([0, -0.16, 0]), AXIAL_Z_TO_Y),
          semanticKey: "thermal-probe-body",
        },
      ),
      primitive(
        "thermal-probe-stem",
        { kind: "cylinder-v1", radiusM: 0.05, axialLengthM: 0.42 },
        {
          frame: frame(constantPosition([0, 0.14, 0]), AXIAL_Z_TO_Y),
          materialKey: "workshop-steel",
        },
      ),
      primitive(
        "thermal-probe-tip",
        {
          kind: "cone-v1",
          startRadiusM: 0.05,
          endRadiusM: 0.012,
          axialLengthM: 0.12,
        },
        {
          frame: frame(constantPosition([0, 0.41, 0]), AXIAL_Z_TO_Y),
          materialKey: "workshop-steel",
        },
      ),
    ],
    dimensionalScalingPolicy: "uniform-similarity-v1",
  }),
  pressureprobe: shapedOrdinary({
    ports: { MOUNT: face(2, 1) },
    id: "air-data-probe-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.15, axialLengthM: 0.65 },
    bodyPrimitives: [
      primitive(
        "air-data-probe-body",
        { kind: "cylinder-v1", radiusM: 0.15, axialLengthM: 0.42 },
        { frame: frame(constantPosition([0, 0, 0.115])) },
      ),
      primitive(
        "air-data-probe-tip",
        {
          kind: "cone-v1",
          startRadiusM: 0.15,
          endRadiusM: 0.035,
          axialLengthM: 0.23,
        },
        { frame: frame(constantPosition([0, 0, -0.21])) },
      ),
    ],
    dimensionalScalingPolicy: "uniform-similarity-v1",
  }),
  tirepressureprobe: ordinary({
    ports: genericFaces(["MOUNT", "POWER", "SIGNAL", "AIR"]),
  }),
  loadcell: shapedOrdinary({
    ports: { A: face(1, -1), B: face(1, 1) },
    id: "load-cell-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.275, axialLengthM: 0.22 },
    orientation: AXIAL_Z_TO_Y,
    bodyPrimitives: [
      primitive(
        "load-cell-neck",
        { kind: "cylinder-v1", radiusM: 0.16, axialLengthM: 0.22 },
        {
          frame: frame(constantPosition([0, 0, 0]), AXIAL_Z_TO_Y),
          semanticKey: "load-cell-body",
        },
      ),
      ...[-0.09, 0.09].map((y, index) =>
        primitive(
          `load-cell-flange-${index + 1}`,
          { kind: "cylinder-v1", radiusM: 0.275, axialLengthM: 0.06 },
          {
            frame: frame(constantPosition([0, y, 0]), AXIAL_Z_TO_Y),
            materialKey: "workshop-steel",
          },
        ),
      ),
    ],
  }),
  gyro: shapedOrdinary({
    ports: { MOUNT: face(1, -1) },
    id: "reaction-wheel-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.325, axialLengthM: 0.3 },
    bodyPrimitives: [
      primitive("reaction-wheel-body", {
        kind: "cylinder-v1",
        radiusM: 0.325,
        axialLengthM: 0.22,
      }),
      primitive(
        "reaction-wheel-hub",
        { kind: "cylinder-v1", radiusM: 0.115, axialLengthM: 0.36 },
        { materialKey: "workshop-steel" },
      ),
    ],
  }),
  battery: ordinary({
    ports: {
      MOUNT: face(1, -1),
      POWER: frame(constantPosition([0, 0.5, 0])),
    },
  }),
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
    physicalFeatures: [
      {
        id: "propellant-outlet-neck",
        primitive: "cylinder-v1",
        anchor: {
          kind: "port-frame-v1",
          portId: "OUTLET",
          offsetM: [0, 0, 0],
        },
        dimensions: { radiusM: 0.09, lengthM: 0.16 },
        axialOrigin: "start-v1",
        role: "physical-interface",
        materialKey: "workshop-steel",
      },
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
    bodyPrimitives: [
      primitive(
        "thruster-chamber",
        { kind: "cylinder-v1", radiusM: 0.3, axialLengthM: 0.62 },
        { frame: frame(constantPosition([0, 0.235, 0]), AXIAL_Z_TO_Y) },
      ),
      primitive(
        "thruster-nozzle",
        {
          kind: "cone-v1",
          startRadiusM: 0.18,
          endRadiusM: 0.4,
          axialLengthM: 0.53,
        },
        {
          frame: frame(constantPosition([0, -0.34, 0]), AXIAL_Z_TO_Y),
          semanticKey: "propulsion-nozzle",
          materialKey: "workshop-steel",
        },
      ),
    ],
    dimensionalScalingPolicy: "axis-aligned-affine-v1",
  }),
  rcs: shapedOrdinary({
    ports: { MOUNT: face(1, -1), PROPELLANT: face(1, 1) },
    id: "rcs-body",
    geometry: { kind: "cylinder-v1", radiusM: 0.36, axialLengthM: 0.42 },
    orientation: AXIAL_Z_TO_Y,
    bodyPrimitives: [
      primitive("rcs-pod", {
        kind: "rounded-box-v1",
        fullSizeM: [0.64, 0.34, 0.64],
        radiusM: 0.07,
      }),
      primitive(
        "rcs-nozzle",
        {
          kind: "cone-v1",
          startRadiusM: 0.085,
          endRadiusM: 0.16,
          axialLengthM: 0.16,
        },
        {
          frame: frame(constantPosition([0, 0.25, 0]), AXIAL_Z_TO_Y),
          semanticKey: "propulsion-nozzle",
          materialKey: "workshop-steel",
        },
      ),
    ],
    dimensionalScalingPolicy: "uniform-similarity-v1",
  }),
});

export const REGISTERED_COMPONENT_GEOMETRY_TYPES = Object.freeze(
  Object.keys(COMPONENT_GEOMETRY_DEFINITIONS),
);
