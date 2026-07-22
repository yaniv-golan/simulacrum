import { authoredComponentFields } from "./component-authoring.js";
import {
  completeConnectionContract,
  CONNECTION_CAPACITIES,
} from "./connection-contracts.js";
import { BlueprintAcquisition } from "./blueprint-acquisition.js";
import { mechanismComponentDefinition } from "./mechanism-component-definitions.js";
import { quaternionFromEulerXYZ } from "./primitives.js";
import { DEFAULT_VISUAL_PROGRAM } from "./visual-logic.js";
import {
  createLocalSubassemblyRecord,
  createSubassemblyTemplate,
} from "./subassemblies.js";
import { validatePortConnection } from "./ports.js";

const EPOCH = new Date(0).toISOString();

class MechanismAssetBuilder {
  constructor(name, accent) {
    this.name = name;
    this.accent = accent;
    this.parts = [];
    this.connections = [];
  }

  add(
    type,
    pos,
    {
      euler = [0, 0, 0],
      scale = [1, 1, 1],
      authored = {},
      controller = null,
    } = {},
  ) {
    const fields = authoredComponentFields(type, authored),
      part = {
        id: this.parts.length + 1,
        type,
        pos: [...pos],
        orientation: quaternionFromEulerXYZ(euler),
        scale: { x: scale[0], y: scale[1], z: scale[2] },
        ...fields,
        ...(controller ? structuredClone(controller) : {}),
        ...(type === "computer" && !controller?.controllerBindings
          ? { controllerBindings: [] }
          : {}),
        ...(type === "battery"
          ? { storedEnergyWh: fields.config.capacityWh }
          : {}),
      };
    this.parts.push(part);
    return part;
  }

  connect(
    left,
    portA,
    right,
    portB,
    kind = "mechanical",
    capacity = CONNECTION_CAPACITIES.reinforced,
  ) {
    const connection = completeConnectionContract(
      {
        id: `connection-${this.connections.length + 1}`,
        a: left.id,
        b: right.id,
        kind,
        portA,
        portB,
      },
      left,
      right,
      { capacity: kind === "mechanical" || kind === "mesh" ? capacity : null },
    );
    validatePortConnection(
      left,
      portA,
      right,
      portB,
      this.connections,
      undefined,
      connection,
    );
    this.connections.push(connection);
    return connection;
  }

  build() {
    const asset = createSubassemblyTemplate(
      { parts: this.parts, connections: this.connections },
      this.parts.map((part) => part.id),
      { name: this.name, accent: this.accent, origin: [0, 0, 0] },
    );
    return createLocalSubassemblyRecord(asset, {
      origin: {
        kind: BlueprintAcquisition.BUILT_IN,
        sourceFingerprint: null,
      },
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  }
}

function tunedSpring(stiffnessNPerM = 9_000) {
  const mechanism = structuredClone(mechanismComponentDefinition("spring"));
  mechanism.config.referenceLaw.freeLengthM = 1.05;
  mechanism.config.elasticLaw.stiffnessNPerM = stiffnessNPerM;
  mechanism.config.dampingLaw.dampingNsPerM = 0;
  mechanism.config.lengthRangeM = { lower: 0.5, upper: 1.5 };
  return mechanism;
}

function tunedDamper(dampingNsPerM = 1_600) {
  const mechanism = structuredClone(mechanismComponentDefinition("damper"));
  mechanism.config.dampingLaw.dampingNsPerM = dampingNsPerM;
  mechanism.config.lengthRangeM = { lower: 0.5, upper: 1.5 };
  return mechanism;
}

function tunedGuide() {
  const mechanism = structuredClone(
    mechanismComponentDefinition("linear-guide"),
  );
  mechanism.config.referenceCoordinateM = 0.3;
  mechanism.config.travelRangeM = { lower: 0, upper: 0.6 };
  return mechanism;
}

const EMPTY_WAT_CONTROLLER = `(module
  (func (export "tick") (param $dt f32)
    (drop (local.get $dt))))`;

function levelingControllerSource(direction) {
  return `type InputBinding = 'imu.roll' | 'imu.rate';
type OutputBinding = 'actuator.left' | 'actuator.right';
interface ControlAPI {
  read(binding: InputBinding): number;
  write(binding: OutputBinding, value: number): void;
}
const clamp = (value: number): number => Math.max(0.15, Math.min(0.85, value));
function tick(api: ControlAPI, dt: number): void {
  void dt;
  const roll = api.read('imu.roll');
  const rate = api.read('imu.rate');
  const target = clamp(0.325 + (${direction}) * (roll * 0.018 + rate * 0.06));
  api.write('actuator.left', target);
  api.write('actuator.right', target);
}`;
}

function levelingController(direction) {
  return {
    scriptLanguage: "typescript",
    scriptSources: {
      typescript: levelingControllerSource(direction),
      visual: structuredClone(DEFAULT_VISUAL_PROGRAM),
      wat: EMPTY_WAT_CONTROLLER,
    },
  };
}

function addWheelStation(builder, carrier, position, axlePort = "RIGHT") {
  const bearing = builder.add("bearing", position),
    axle = builder.add("axle", position),
    wheel = builder.add("wheel", [
      position[0],
      position[1],
      position[2] + (axlePort === "RIGHT" ? 1 : -1),
    ]);
  builder.connect(carrier, "SURFACE", bearing, "MOUNT");
  builder.connect(bearing, "SHAFT", axle, "JOURNAL");
  builder.connect(axle, axlePort, wheel, "AXLE");
  return { bearing, axle, wheel };
}

function addParallelSpringDamper(builder, fixed, moving, x = 0, z = 0) {
  const spring = builder.add("spring", [x + 0.28, 1.1, z], {
      euler: [Math.PI / 2, 0, 0],
      authored: tunedSpring(),
    }),
    damper = builder.add("damper", [x - 0.28, 1.1, z + 0.2], {
      euler: [Math.PI / 2, 0, 0],
      authored: tunedDamper(),
    });
  builder.connect(fixed, "TOP", spring, "END_A");
  builder.connect(spring, "END_B", moving, "SURFACE");
  builder.connect(fixed, "TOP", damper, "END_A");
  builder.connect(damper, "END_B", moving, "SURFACE");
}

function addActiveCorner(builder, chassis, battery, controller, x, z) {
  const wheel = builder.add("wheel", [x, 0.65, z]),
    hub = builder.add("motor", [x, 0.65, z], {
      authored: { power: 1 },
    }),
    actuator = builder.add("linear-actuator", [x, 1.15, z], {
      euler: [Math.PI / 2, 0, 0],
    }),
    spring = builder.add("spring", [x, 1.15, z + 0.14], {
      euler: [Math.PI / 2, 0, 0],
      authored: tunedSpring(),
    }),
    damper = builder.add("damper", [x, 1.15, z - 0.14], {
      euler: [Math.PI / 2, 0, 0],
      authored: tunedDamper(),
    });
  builder.connect(chassis, "TOP", actuator, "BASE");
  builder.connect(actuator, "ROD", hub, "MOUNT");
  builder.connect(chassis, "TOP", spring, "END_A");
  builder.connect(spring, "END_B", hub, "MOUNT");
  builder.connect(chassis, "TOP", damper, "END_A");
  builder.connect(damper, "END_B", hub, "MOUNT");
  builder.connect(hub, "SHAFT", wheel, "AXLE");
  builder.connect(battery, "POWER", actuator, "POWER", "power");
  builder.connect(battery, "POWER", hub, "POWER", "power");
  builder.connect(controller, "OUT", actuator, "CONTROL", "signal");
  return actuator;
}

function rigidAxleAsset() {
  const builder = new MechanismAssetBuilder("Rigid axle suspension", "#70e0c4"),
    chassis = builder.add("plate", [0, 1.6, 0]),
    guide = builder.add("linear-guide", [0, 1.15, 0], {
      euler: [Math.PI / 2, 0, 0],
      authored: tunedGuide(),
    }),
    carrier = builder.add("beam", [0, 0.65, 0]),
    bearing = builder.add("bearing", [0, 0.65, 0]),
    axle = builder.add("axle", [0, 0.65, 0]),
    leftWheel = builder.add("wheel", [0, 0.65, -1]),
    rightWheel = builder.add("wheel", [0, 0.65, 1]);
  builder.connect(chassis, "TOP", guide, "BASE");
  builder.connect(guide, "SLIDER", carrier, "SURFACE");
  builder.connect(carrier, "SURFACE", bearing, "MOUNT");
  builder.connect(bearing, "SHAFT", axle, "JOURNAL");
  builder.connect(axle, "LEFT", leftWheel, "AXLE");
  builder.connect(axle, "RIGHT", rightWheel, "AXLE");
  addParallelSpringDamper(builder, chassis, carrier);
  return builder.build();
}

function trailingArmAsset() {
  const builder = new MechanismAssetBuilder(
      "Trailing arm suspension",
      "#efb969",
    ),
    chassis = builder.add("plate", [-0.8, 1.5, 0]),
    pivot = builder.add("hinge", [-0.85, 1, 0]),
    arm = builder.add("beam", [0, 0.75, 0]);
  builder.connect(chassis, "TOP", pivot, "BASE");
  builder.connect(pivot, "ARM", arm, "A");
  addWheelStation(builder, arm, [0.9, 0.65, 0]);
  addParallelSpringDamper(builder, chassis, arm, 0.35);
  return builder.build();
}

function doubleWishboneAsset() {
  const builder = new MechanismAssetBuilder(
      "Double wishbone corner",
      "#8fb5ff",
    ),
    chassis = builder.add("plate", [-0.9, 1.2, 0]),
    upperInner = builder.add("hinge", [-0.55, 1.45, 0]),
    upperArm = builder.add("beam", [0, 1.35, 0]),
    upperOuter = builder.add("hinge", [0.55, 1.25, 0]),
    lowerInner = builder.add("hinge", [-0.55, 0.65, 0]),
    lowerArm = builder.add("beam", [0, 0.65, 0]),
    lowerOuter = builder.add("hinge", [0.55, 0.75, 0]),
    hub = builder.add("beam", [0.85, 1, 0], {
      euler: [0, 0, Math.PI / 2],
    });
  builder.connect(chassis, "TOP", upperInner, "BASE");
  builder.connect(upperInner, "ARM", upperArm, "A");
  builder.connect(upperArm, "B", upperOuter, "BASE");
  builder.connect(upperOuter, "ARM", hub, "SURFACE");
  builder.connect(chassis, "TOP", lowerInner, "BASE");
  builder.connect(lowerInner, "ARM", lowerArm, "A");
  builder.connect(lowerArm, "B", lowerOuter, "BASE");
  builder.connect(lowerOuter, "ARM", hub, "SURFACE");
  addWheelStation(builder, hub, [0.9, 1, 0]);
  addParallelSpringDamper(builder, chassis, lowerArm, 0.1);
  return builder.build();
}

function rockerBogieAsset() {
  const builder = new MechanismAssetBuilder(
      "Rocker-bogie suspension",
      "#d8a6ff",
    ),
    chassis = builder.add("plate", [-0.8, 1.5, 0]),
    rockerPivot = builder.add("hinge", [-0.65, 1.1, 0]),
    rocker = builder.add("beam", [0, 0.95, 0]),
    bogiePivot = builder.add("hinge", [0.45, 0.9, 0]),
    bogie = builder.add("beam", [1.1, 0.75, 0]);
  builder.connect(chassis, "TOP", rockerPivot, "BASE");
  builder.connect(rockerPivot, "ARM", rocker, "A");
  builder.connect(rocker, "SURFACE", bogiePivot, "BASE");
  builder.connect(bogiePivot, "ARM", bogie, "A");
  addWheelStation(builder, rocker, [-0.9, 0.65, 0]);
  addWheelStation(builder, bogie, [0.45, 0.65, 0]);
  addWheelStation(builder, bogie, [1.85, 0.65, 0]);
  return builder.build();
}

function activeLevelingAsset() {
  const builder = new MechanismAssetBuilder(
      "Active leveling suspension",
      "#ff8fb8",
    ),
    chassis = builder.add("plate", [0, 1.56, 0]),
    battery = builder.add("battery", [0, 2.02, 0]),
    imu = builder.add("imu", [0, 1.84, 0]),
    negativeController = builder.add("computer", [-0.5, 1.84, -0.45], {
      controller: levelingController(-1),
    }),
    positiveController = builder.add("computer", [0.5, 1.84, 0.45], {
      controller: levelingController(1),
    });
  builder.connect(chassis, "TOP", battery, "MOUNT");
  builder.connect(chassis, "TOP", imu, "MOUNT");
  builder.connect(battery, "POWER", imu, "POWER", "power");
  for (const controller of [negativeController, positiveController]) {
    builder.connect(chassis, "TOP", controller, "MOUNT");
    builder.connect(battery, "POWER", controller, "POWER", "power");
    builder.connect(imu, "SIGNAL", controller, "IN A", "signal");
  }
  const negativeActuators = [],
    positiveActuators = [];
  for (const x of [-1.32, 1.32]) {
    negativeActuators.push(
      addActiveCorner(builder, chassis, battery, negativeController, x, -0.78),
    );
    positiveActuators.push(
      addActiveCorner(builder, chassis, battery, positiveController, x, 0.78),
    );
  }
  for (const [controller, actuators] of [
    [negativeController, negativeActuators],
    [positiveController, positiveActuators],
  ])
    controller.controllerBindings = [
      {
        id: "imu.roll",
        direction: "input",
        endpointPartId: imu.id,
        endpointPortId: "SIGNAL",
        reading: "imu_roll_deg",
      },
      {
        id: "imu.rate",
        direction: "input",
        endpointPartId: imu.id,
        endpointPortId: "SIGNAL",
        reading: "imu_rate_x",
      },
      ...actuators.map((actuator, index) => ({
        id: index === 0 ? "actuator.left" : "actuator.right",
        direction: "output",
        endpointPartId: actuator.id,
        endpointPortId: "CONTROL",
        channel: "linear_target",
      })),
    ];
  return builder.build();
}

let cached = null;

/** Ordinary strict subassembly assets; runtime behavior remains topology-derived. */
export function builtInMechanismSubassemblies() {
  cached ||= [
    rigidAxleAsset(),
    trailingArmAsset(),
    doubleWishboneAsset(),
    rockerBogieAsset(),
    activeLevelingAsset(),
  ];
  return structuredClone(cached);
}
