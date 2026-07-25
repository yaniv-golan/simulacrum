import { BLUEPRINT_FORMAT, BLUEPRINT_VERSION } from "./blueprints.js";
import { BlueprintAcquisition } from "./blueprint-acquisition.js";
import { CART_CONTROLLER_TYPESCRIPT } from "./cart-controller-program.js";
import { TYPES } from "./component-catalog.js";
import {
  completeConnectionContract,
  CONNECTION_CAPACITIES,
} from "./connection-contracts.js";
import { portIds, validatePortConnection } from "./ports.js";
import { DEFAULT_VISUAL_PROGRAM } from "./visual-logic.js";
import { resolveWireComponentConfig } from "./component-resolver.js";
import { quaternionFromEulerXYZ } from "./primitives.js";
import {
  isMechanismComponentType,
  mechanismComponentDefinition,
} from "./mechanism-component-definitions.js";
import {
  createLocalSubassemblyRecord,
  createSubassemblyTemplate,
} from "./subassemblies.js";

const STANDARD_CAPACITY = CONNECTION_CAPACITIES.standard,
  GEAR_CAPACITY = CONNECTION_CAPACITIES.gear,
  REINFORCED_CAPACITY = CONNECTION_CAPACITIES.reinforced,
  STEERING_CORNER_CAPACITY = Object.freeze({
    ultimateForceN: 120_000,
    ultimateTorqueNm: 50_000,
  });

function controllerSources(typescript = "", wat = "") {
  return {
    visual: structuredClone(DEFAULT_VISUAL_PROGRAM),
    typescript,
    wat,
  };
}

function control(label, channel, type, target, options = {}) {
  return {
    label,
    channel,
    type,
    defaultValue: options.value ?? 0,
    hotkey: options.hotkey ?? null,
    targetId: target?.id ?? null,
    ...(options.min == null ? {} : { min: options.min }),
    ...(options.max == null ? {} : { max: options.max }),
    ...(options.step == null ? {} : { step: options.step }),
  };
}

function poweredHingeMechanism({
  lowerDeg = -90,
  upperDeg = 90,
  maximumTorqueNm = 120,
  viscousNms = 8,
} = {}) {
  const mechanism = structuredClone(mechanismComponentDefinition("hinge")),
    lower = (lowerDeg * Math.PI) / 180,
    upper = (upperDeg * Math.PI) / 180;
  mechanism.config.angleRangeRad = { lower, upper };
  mechanism.config.friction = {
    kind: "coulomb-viscous-v1",
    coulombTorqueNm: 0,
    viscousNms,
  };
  mechanism.config.actuation = {
    ...mechanism.config.actuation,
    commandRangeRad: { lower, upper },
    maximumTorqueNm,
    stiffnessNmPerRad: maximumTorqueNm * 5,
    dampingNmsPerRad: maximumTorqueNm * 0.4,
    powerLaw: {
      ...mechanism.config.actuation.powerLaw,
      maximumMechanicalMotoringPowerW: maximumTorqueNm * 4,
    },
  };
  return mechanism;
}

class BlueprintBuilder {
  constructor(kind) {
    this.kind = kind;
    this.parts = [];
    this.connections = [];
    this.nextId = 1;
  }

  add(type, pos, options = {}) {
    if (isMechanismComponentType(type) && options.config)
      throw new Error(
        `${type} must be authored through its strict mechanism contract`,
      );
    const part = {
      id: this.nextId++,
      type,
      pos,
      orientation: quaternionFromEulerXYZ(options.eulerRotation || [0, 0, 0]),
      scale: options.scale
        ? { x: options.scale[0], y: options.scale[1], z: options.scale[2] }
        : { x: 1, y: 1, z: 1 },
      ...(isMechanismComponentType(type)
        ? {
            mechanism: structuredClone(
              options.mechanism || mechanismComponentDefinition(type),
            ),
          }
        : {
            config: resolveWireComponentConfig({
              type,
              config: options.config || {},
            }),
          }),
      ...(type === "battery"
        ? {
            storedEnergyWh:
              options.storedEnergyWh ??
              options.config?.capacityWh ??
              TYPES.battery.capacityWh,
          }
        : {}),
      ...(options.rigRole ? { rigRole: options.rigRole } : {}),
      ...(options.scriptLanguage
        ? { scriptLanguage: options.scriptLanguage }
        : {}),
      ...(options.scriptSources
        ? { scriptSources: options.scriptSources }
        : {}),
      ...(type === "computer"
        ? {
            controllerBindings: structuredClone(
              options.controllerBindings || [],
            ),
          }
        : {}),
    };
    this.parts.push(part);
    return part;
  }

  connect(a, b, kind, options) {
    if (!options?.portA || !options?.portB)
      throw new Error(
        `Built-in ${this.kind} connection ${a.type}->${b.type} requires explicit ports`,
      );
    const physical = kind === "mechanical" || kind === "mesh";
    if (physical && !options.capacity)
      throw new Error(
        `Built-in ${this.kind} ${kind} connection requires force and torque capacity`,
      );
    if (!physical && options.capacity)
      throw new Error(
        `${kind} network connections cannot carry joint capacity`,
      );
    let connection = {
      id: `demo-${this.kind}-${this.connections.length + 1}`,
      a: a.id,
      b: b.id,
      kind,
      portA: options.portA,
      portB: options.portB,
      ...(options.releaseCouplerPartId == null
        ? {}
        : { releaseCouplerPartId: options.releaseCouplerPartId }),
    };
    connection = completeConnectionContract(connection, a, b, {
      capacity: options.capacity,
    });
    validatePortConnection(
      a,
      options.portA,
      b,
      options.portB,
      this.connections,
      TYPES,
      connection,
    );
    this.connections.push(connection);
    return connection;
  }

  power(source, target, sourcePort = "POWER", targetPort = "POWER") {
    return this.connect(source, target, "power", {
      portA: sourcePort,
      portB: targetPort,
    });
  }

  command(controller, target) {
    const targetPort = portIds(target).includes("CONTROL")
      ? "CONTROL"
      : "SIGNAL";
    return this.connect(controller, target, "signal", {
      portA: "OUT",
      portB: targetPort,
    });
  }

  sensor(sensor, controller, input = "IN A") {
    return this.connect(sensor, controller, "signal", {
      portA: "SIGNAL",
      portB: input,
    });
  }

  resource(source, target, sourcePort = "OUTLET", targetPort = "PROPELLANT") {
    return this.connect(source, target, "resource", {
      portA: sourcePort,
      portB: targetPort,
    });
  }

  wireController(battery, controller, targets) {
    this.power(battery, controller);
    for (const target of targets) this.command(controller, target);
  }

  build(meta) {
    const controls = (meta.controls || []).map((entry, index) => ({
      id: `${this.kind}-${index + 1}`,
      ...structuredClone(entry),
    }));
    return {
      blueprint: {
        format: BLUEPRINT_FORMAT,
        version: BLUEPRINT_VERSION,
        name: meta.name,
        created: new Date(0).toISOString(),
        demo: this.kind,
        parts: this.parts,
        connections: this.connections,
        remoteProfiles: {
          [this.kind]: {
            design: {
              title: meta.title || meta.name,
              style: this.kind === "cart" ? "drive-pad" : "compact-grid",
              accent: "#70e0c4",
            },
            controls,
            actionBindings: structuredClone(meta.actionBindings || {}),
          },
        },
        defaultRemoteProfile: this.kind,
      },
      meta,
    };
  }
}

function gearbox() {
  const b = new BlueprintBuilder("gearbox"),
    plate = b.add("plate", [0, 0.2, 0]),
    motor = b.add("motor", [-2, 0.9, 0]),
    inputGear = b.add("gear12", [-2, 0.9, 0.82]),
    outputGear = b.add("gear24", [-0.645, 0.9, 0.82]),
    outputAxle = b.add("axle", [-0.645, 0.9, 0.82]),
    outputBearing = b.add("bearing", [-0.645, 0.9, 0.48]),
    sensor = b.add("sensor", [-0.645, 0.9, 1.14]),
    battery = b.add("battery", [-2, 0.75, -1.4]),
    controller = b.add("computer", [-0.8, 0.55, -1.35], {
      scriptLanguage: "visual",
      scriptSources: controllerSources(),
    });
  b.power(battery, motor);
  b.wireController(battery, controller, [motor]);
  for (const part of [motor, outputBearing, sensor, battery, controller])
    b.connect(plate, part, "mechanical", {
      portA: "TOP",
      portB: "MOUNT",
      capacity: STANDARD_CAPACITY,
    });
  b.connect(motor, inputGear, "mechanical", {
    portA: "SHAFT",
    portB: "AXLE",
    capacity: STANDARD_CAPACITY,
  });
  b.connect(outputBearing, outputAxle, "mechanical", {
    portA: "SHAFT",
    portB: "JOURNAL",
    capacity: STANDARD_CAPACITY,
  });
  b.connect(inputGear, outputGear, "mesh", {
    portA: "MESH",
    portB: "MESH",
    capacity: GEAR_CAPACITY,
  });
  b.connect(outputAxle, outputGear, "mechanical", {
    portA: "JOURNAL",
    portB: "AXLE",
    capacity: STANDARD_CAPACITY,
  });
  b.connect(outputAxle, sensor, "mechanical", {
    portA: "JOURNAL",
    portB: "SHAFT",
    capacity: STANDARD_CAPACITY,
  });
  b.sensor(sensor, controller);
  return b.build({
    name: "Powered Gearbox",
    title: "STAGE 1 · POWERED GEARBOX",
    description:
      "Start simulation to validate powered 2:1 torque reduction and opposite output rotation.",
    selectedType: "motor",
    controls: [
      control("Motor throttle", "throttle", "range", motor, {
        min: -1,
        max: 1,
        step: 0.05,
        value: 1,
      }),
      control("Shaft brake", "brake", "hold", motor),
    ],
  });
}

function cart() {
  const b = new BlueprintBuilder("cart"),
    suspensionSpring = () => {
      const mechanism = structuredClone(mechanismComponentDefinition("spring"));
      mechanism.config.referenceLaw.freeLengthM = 1.13;
      mechanism.config.elasticLaw.stiffnessNPerM = 9_000;
      mechanism.config.dampingLaw.dampingNsPerM = 0;
      mechanism.config.lengthRangeM = { lower: 0.72, upper: 1.35 };
      return mechanism;
    },
    suspensionDamper = () => {
      const mechanism = structuredClone(mechanismComponentDefinition("damper"));
      mechanism.config.dampingLaw.dampingNsPerM = 1_600;
      mechanism.config.lengthRangeM = { lower: 0.72, upper: 1.35 };
      return mechanism;
    },
    suspensionGuide = ({ narrowTrack = false } = {}) => {
      const mechanism = structuredClone(
        mechanismComponentDefinition("linear-guide"),
      );
      mechanism.config.referenceCoordinateM = 0.3;
      mechanism.config.travelRangeM = { lower: 0, upper: 0.6 };
      if (narrowTrack)
        for (const [railIndex, region] of mechanism.collisionRegions.entries())
          region.localFramePart.positionM[0] = railIndex === 0 ? -0.1 : 0.1;
      return mechanism;
    },
    chassis = b.add("plate", [0, 1.56, 0]),
    railA = b.add("beam", [0, 1.82, -0.65]),
    railB = b.add("beam", [0, 1.82, 0.65]),
    battery = b.add("battery", [0, 2.02, 0]),
    controller = b.add("computer", [0, 1.84, -0.45], {
      scriptLanguage: "typescript",
      scriptSources: controllerSources(CART_CONTROLLER_TYPESCRIPT),
    }),
    receivers = {
      drive: b.add("receiver", [-0.72, 1.88, 0.35]),
      steering: b.add("receiver", [-0.24, 1.88, 0.35]),
      brake: b.add("receiver", [0.24, 1.88, 0.35]),
      lights: b.add("receiver", [0.72, 1.88, 0.35]),
    },
    lamps = [
      b.add("headlight", [-0.72, 1.86, -1.18]),
      b.add("headlight", [0.72, 1.86, -1.18]),
    ],
    wheels = [
      b.add("wheel", [-1.32, 0.65, -0.78], {
        eulerRotation: [0, Math.PI / 2, 0],
      }),
      b.add("wheel", [1.32, 0.65, -0.78], {
        eulerRotation: [0, Math.PI / 2, 0],
      }),
      b.add("wheel", [-1.32, 0.65, 0.78], {
        eulerRotation: [0, Math.PI / 2, 0],
      }),
      b.add("wheel", [1.32, 0.65, 0.78], {
        eulerRotation: [0, Math.PI / 2, 0],
      }),
    ],
    motors = wheels.map((wheel) =>
      b.add("motor", [...wheel.pos], {
        eulerRotation: [0, Math.PI / 2, 0],
        // The wheel contract has a local +Z axle and the authored transform
        // maps it to world +X. Each hub motor is authored on that same frame;
        // the compiler never rotates or translates the shaft implicitly.
        config: { power: 1 },
      }),
    ),
    guides = wheels.map((wheel, index) =>
      b.add("linear-guide", [wheel.pos[0], 1.15, wheel.pos[2]], {
        eulerRotation: [Math.PI / 2, 0, 0],
        // The stock guide's wide rail spacing is useful for exposed slides,
        // but a front outboard rail would intersect the turning knuckle and
        // hub motor. This ordinary narrow-track variant preserves real
        // self-collision while giving the steering corner sweep clearance.
        mechanism: suspensionGuide({ narrowTrack: index < 2 }),
      }),
    ),
    springs = wheels.map((wheel) =>
      b.add("spring", [wheel.pos[0], 1.15, wheel.pos[2] + 0.14], {
        eulerRotation: [Math.PI / 2, 0, 0],
        mechanism: suspensionSpring(),
      }),
    ),
    dampers = wheels.map((wheel) =>
      b.add("damper", [wheel.pos[0], 1.15, wheel.pos[2] - 0.14], {
        eulerRotation: [Math.PI / 2, 0, 0],
        mechanism: suspensionDamper(),
      }),
    ),
    steeringHinges = wheels.slice(0, 2).map((wheel) =>
      b.add(
        "hinge",
        [wheel.pos[0] - Math.sign(wheel.pos[0]) * 0.87, 0.65, wheel.pos[2]],
        {
          eulerRotation: [-Math.PI / 2, 0, 0],
          mechanism: poweredHingeMechanism({
            lowerDeg: -14,
            upperDeg: 14,
            maximumTorqueNm: 1800,
          }),
        },
      ),
    ),
    steeringKnuckles = wheels.slice(0, 2).map((wheel) =>
      b.add(
        "plate",
        [wheel.pos[0] - Math.sign(wheel.pos[0]) * 0.42, 0.65, wheel.pos[2]],
        {
          // Turn the plate upright so its structural-surface normal shares the
          // steering hinge's authored vertical axis. The compiler validates
          // this transform exactly as it would for a player-built knuckle.
          eulerRotation: [Math.PI / 2, 0, 0],
          // The upright clears the tire envelope; contact is therefore
          // generated only where authored solids actually overlap.
          scale: [0.1, 0.35, 0.25],
        },
      ),
    );
  controller.controllerBindings = [
    ...Object.entries(receivers).map(([key, receiver]) => ({
      id: `pilot.${key}`,
      direction: "input",
      endpointPartId: receiver.id,
      endpointPortId: "SIGNAL",
      reading: "command",
    })),
    ...motors.flatMap((driveMotor, index) => [
      {
        id: `motor.${index}.throttle`,
        direction: "output",
        endpointPartId: driveMotor.id,
        endpointPortId: "CONTROL",
        channel: "throttle",
      },
      {
        id: `motor.${index}.brake`,
        direction: "output",
        endpointPartId: driveMotor.id,
        endpointPortId: "CONTROL",
        channel: "brake",
      },
    ]),
    ...steeringHinges.map((hinge, index) => ({
      id: `steering.${index}.target`,
      direction: "output",
      endpointPartId: hinge.id,
      endpointPortId: "CONTROL",
      channel: "joint_target",
    })),
    ...lamps.map((lamp, index) => ({
      id: `lamp.${index}.lights`,
      direction: "output",
      endpointPartId: lamp.id,
      endpointPortId: "SIGNAL",
      channel: "lights",
    })),
  ];
  for (let index = 0; index < steeringHinges.length; index++)
    guides[index].pos[0] = steeringHinges[index].pos[0];
  for (const powered of [
    ...motors,
    ...lamps,
    ...steeringHinges,
    ...Object.values(receivers),
  ])
    b.power(battery, powered);
  b.wireController(battery, controller, [
    ...motors,
    ...lamps,
    ...steeringHinges,
  ]);
  for (const receiver of Object.values(receivers))
    b.sensor(receiver, controller);
  for (const part of [
    railA,
    railB,
    battery,
    controller,
    ...lamps,
    ...Object.values(receivers),
  ]) {
    const targetPort = portIds(part).includes("MOUNT") ? "MOUNT" : "A";
    b.connect(chassis, part, "mechanical", {
      portA: "TOP",
      portB: targetPort,
      capacity: STANDARD_CAPACITY,
    });
  }
  for (let index = 0; index < wheels.length; index++) {
    b.connect(chassis, guides[index], "mechanical", {
      portA: "TOP",
      portB: "BASE",
      capacity:
        index < steeringHinges.length
          ? STEERING_CORNER_CAPACITY
          : REINFORCED_CAPACITY,
    });
    if (index < steeringHinges.length) {
      b.connect(guides[index], steeringHinges[index], "mechanical", {
        portA: "SLIDER",
        portB: "BASE",
        capacity: STEERING_CORNER_CAPACITY,
      });
      b.connect(steeringHinges[index], steeringKnuckles[index], "mechanical", {
        portA: "ARM",
        portB: "TOP",
        capacity: STEERING_CORNER_CAPACITY,
      });
      b.connect(steeringKnuckles[index], motors[index], "mechanical", {
        portA: "TOP",
        portB: "MOUNT",
        capacity: STEERING_CORNER_CAPACITY,
      });
    } else
      b.connect(guides[index], motors[index], "mechanical", {
        portA: "SLIDER",
        portB: "MOUNT",
        capacity: REINFORCED_CAPACITY,
      });
    b.connect(chassis, springs[index], "mechanical", {
      portA: "TOP",
      portB: "END_A",
      capacity: STANDARD_CAPACITY,
    });
    b.connect(
      springs[index],
      index < steeringKnuckles.length ? steeringKnuckles[index] : motors[index],
      "mechanical",
      {
        portA: "END_B",
        portB: index < steeringKnuckles.length ? "TOP" : "MOUNT",
        capacity: STANDARD_CAPACITY,
      },
    );
    b.connect(chassis, dampers[index], "mechanical", {
      portA: "TOP",
      portB: "END_A",
      capacity: STANDARD_CAPACITY,
    });
    b.connect(
      dampers[index],
      index < steeringKnuckles.length ? steeringKnuckles[index] : motors[index],
      "mechanical",
      {
        portA: "END_B",
        portB: index < steeringKnuckles.length ? "TOP" : "MOUNT",
        capacity: STANDARD_CAPACITY,
      },
    );
    b.connect(motors[index], wheels[index], "mechanical", {
      portA: "SHAFT",
      portB: "AXLE",
      capacity: REINFORCED_CAPACITY,
    });
  }
  return b.build({
    name: "Passive Suspension Rover",
    title: "ROVER READY",
    description:
      "Press Start, then hold W/S to drive, Space to brake, and L for lights. Four authored spring-damper struts keep every tire in contact.",
    selectedType: "motor",
    controls: [
      control("Drive throttle", "command", "range", receivers.drive, {
        min: -1,
        max: 1,
        step: 0.05,
      }),
      control("Steering", "command", "range", receivers.steering, {
        min: -1,
        max: 1,
        step: 0.05,
      }),
      control("Brake", "command", "hold", receivers.brake),
      control("Headlights", "command", "toggle", receivers.lights),
    ],
    actionBindings: {
      forward: { controlId: "cart-1", pressedValue: 1, releasedValue: 0 },
      reverse: { controlId: "cart-1", pressedValue: -1, releasedValue: 0 },
      left: { controlId: "cart-2", pressedValue: 1, releasedValue: 0 },
      right: { controlId: "cart-2", pressedValue: -1, releasedValue: 0 },
      brake: { controlId: "cart-3", pressedValue: 1, releasedValue: 0 },
      lights: { controlId: "cart-4" },
    },
  });
}

function humanoid() {
  const b = new BlueprintBuilder("humanoid"),
    rig = (type, pos, rigRole, eulerRotation = [0, 0, 0], scale = [1, 1, 1]) =>
      b.add(type, pos, { rigRole, eulerRotation, scale }),
    pelvis = rig("plate", [0, 2.5, 0], "pelvis", [0, 0, 0], [0.48, 1, 0.32]),
    torso = rig(
      "beam",
      [0, 3.42, 0],
      "torso",
      [0, 0, Math.PI / 2],
      [0.62, 1, 1.15],
    ),
    head = rig("sensor", [0, 4.42, 0], "head"),
    limbs = [
      rig(
        "beam",
        [-0.32, 1.78, 0],
        "thighL",
        [0, Math.PI / 2, Math.PI / 2],
        [0.43, 1, 1],
      ),
      rig(
        "beam",
        [0.32, 1.78, 0],
        "thighR",
        [0, Math.PI / 2, Math.PI / 2],
        [0.43, 1, 1],
      ),
      rig(
        "beam",
        [-0.32, 0.78, 0],
        "shinL",
        [0, Math.PI / 2, Math.PI / 2],
        [0.4, 1, 1],
      ),
      rig(
        "beam",
        [0.32, 0.78, 0],
        "shinR",
        [0, Math.PI / 2, Math.PI / 2],
        [0.4, 1, 1],
      ),
      rig(
        "plate",
        [-0.32, 0.2, 0.18],
        "footL",
        [0, Math.PI / 2, 0],
        [0.35, 1, 0.2],
      ),
      rig(
        "plate",
        [0.32, 0.2, 0.18],
        "footR",
        [0, Math.PI / 2, 0],
        [0.35, 1, 0.2],
      ),
      rig(
        "beam",
        [-0.9, 3.48, 0],
        "upperArmL",
        [0, Math.PI / 2, Math.PI / 2],
        [0.3, 1, 1],
      ),
      rig(
        "beam",
        [0.9, 3.48, 0],
        "upperArmR",
        [0, Math.PI / 2, Math.PI / 2],
        [0.3, 1, 1],
      ),
      rig(
        "beam",
        [-0.9, 2.75, 0],
        "forearmL",
        [0, Math.PI / 2, Math.PI / 2],
        [0.26, 1, 1],
      ),
      rig(
        "beam",
        [0.9, 2.75, 0],
        "forearmR",
        [0, Math.PI / 2, Math.PI / 2],
        [0.26, 1, 1],
      ),
    ],
    battery = b.add("battery", [-0.28, 3.45, -0.62]),
    controller = b.add("computer", [0.28, 3.45, -0.65], {
      scriptLanguage: "visual",
      scriptSources: controllerSources(),
    }),
    imu = b.add("imu", [0, 3.9, 0.28]),
    gyro = b.add("gyro", [0, 2.55, 0.32], {
      rigRole: "reactionWheel",
      config: {
        maxTorqueNm: 1_500,
        momentumCapacityNms: 600,
        power: 80,
      },
    }),
    motor = b.add("motor", [0, 2.42, -0.3]),
    jointRoles = [
      "hipL",
      "hipR",
      "kneeL",
      "kneeR",
      "ankleL",
      "ankleR",
      "shoulderL",
      "shoulderR",
      "elbowL",
      "elbowR",
    ],
    jointPos = [
      [-0.32, 2.28, 0],
      [0.32, 2.28, 0],
      [-0.32, 1.28, 0],
      [0.32, 1.28, 0],
      [-0.32, 0.28, 0],
      [0.32, 0.28, 0],
      [-0.78, 3.82, 0],
      [0.78, 3.82, 0],
      [-0.9, 3.1, 0],
      [0.9, 3.1, 0],
    ],
    joints = jointRoles.map((role, index) =>
      b.add("hinge", jointPos[index], {
        rigRole: role,
        eulerRotation: [0, Math.PI / 2, 0],
        mechanism: poweredHingeMechanism({
          maximumTorqueNm: index < 6 ? 2_000 : 120,
          viscousNms: index < 6 ? 80 : 12,
          lowerDeg: index < 6 ? -105 : -90,
          upperDeg: index < 6 ? 105 : 90,
        }),
      }),
    ),
    limbByRole = new Map(limbs.map((part) => [part.rigRole, part])),
    jointByRole = new Map(joints.map((part) => [part.rigRole, part]));
  for (const powered of [motor, gyro, imu, ...joints])
    b.power(battery, powered);
  b.wireController(battery, controller, [motor, gyro, ...joints]);
  b.sensor(imu, controller);
  for (const [base, mounted, portA, portB] of [
    [pelvis, torso, "TOP", "A"],
    [torso, head, "SURFACE", "MOUNT"],
    [torso, battery, "SURFACE", "MOUNT"],
    [torso, controller, "SURFACE", "MOUNT"],
    [torso, imu, "SURFACE", "MOUNT"],
    [pelvis, gyro, "TOP", "MOUNT"],
    [pelvis, motor, "TOP", "MOUNT"],
  ])
    b.connect(base, mounted, "mechanical", {
      portA,
      portB,
      capacity: STANDARD_CAPACITY,
    });
  for (const [role, base, arm, basePort, armPort] of [
    ["hipL", pelvis, limbByRole.get("thighL"), "TOP", "A"],
    ["hipR", pelvis, limbByRole.get("thighR"), "TOP", "A"],
    ["kneeL", limbByRole.get("thighL"), limbByRole.get("shinL"), "B", "A"],
    ["kneeR", limbByRole.get("thighR"), limbByRole.get("shinR"), "B", "A"],
    ["ankleL", limbByRole.get("shinL"), limbByRole.get("footL"), "B", "TOP"],
    ["ankleR", limbByRole.get("shinR"), limbByRole.get("footR"), "B", "TOP"],
    ["shoulderL", torso, limbByRole.get("upperArmL"), "SURFACE", "A"],
    ["shoulderR", torso, limbByRole.get("upperArmR"), "SURFACE", "A"],
    [
      "elbowL",
      limbByRole.get("upperArmL"),
      limbByRole.get("forearmL"),
      "B",
      "A",
    ],
    [
      "elbowR",
      limbByRole.get("upperArmR"),
      limbByRole.get("forearmR"),
      "B",
      "A",
    ],
  ]) {
    const joint = jointByRole.get(role);
    b.connect(base, joint, "mechanical", {
      portA: basePort,
      portB: "BASE",
      capacity: STANDARD_CAPACITY,
    });
    b.connect(joint, arm, "mechanical", {
      portA: "ARM",
      portB: armPort,
      capacity: STANDARD_CAPACITY,
    });
  }
  return b.build({
    name: "Atlas Humanoid",
    title: "ATLAS HUMANOID",
    description:
      "A constrained rigid-body robot: enable gait and balance, then simulate.",
    selectedType: "computer",
    controls: [
      control("Walk speed", "gait_speed", "range", motor, {
        min: 0,
        max: 1,
        step: 0.05,
      }),
      control("Stride length", "stride", "range", joints[0], {
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.5,
      }),
      control("Balance assist", "balance", "toggle", gyro, { value: 1 }),
      control("Crouch", "crouch", "hold", joints[0]),
      control("Emergency stop", "brake", "toggle", motor),
    ],
  });
}

function drone(sources = {}) {
  const b = new BlueprintBuilder("drone"),
    deck = b.add("plate", [0, 1.35, 0]),
    positions = [
      [-1.35, 0.95, -1.35],
      [1.35, 0.95, -1.35],
      [-1.35, 0.95, 1.35],
      [1.35, 0.95, 1.35],
    ],
    arms = positions.map(([x, , z]) =>
      b.add("beam", [x * 0.5, 1.45, z * 0.5], {
        eulerRotation: [0, -Math.atan2(z, x), 0],
      }),
    ),
    battery = b.add("battery", [0, 1.9, 0], {
      config: {
        mass: 95,
        size: [1.2, 0.7, 0.85],
        capacityWh: 21_000,
        maxOutputWatts: 240_000,
        dischargeEfficiency: 0.96,
      },
      storedEnergyWh: 21_000,
    }),
    controller = b.add("computer", [0, 2.45, 0], {
      scriptLanguage: "typescript",
      scriptSources: controllerSources(sources.droneTypescript || ""),
    }),
    imu = b.add("imu", [0, 2.82, 0]),
    navigation = b.add("navsensor", [0.62, 2.42, 0]),
    receivers = {
      collective: b.add("receiver", [-0.85, 1.82, -0.5]),
      yaw: b.add("receiver", [-0.43, 1.82, -0.5]),
      pitch: b.add("receiver", [0, 1.82, -0.5]),
      roll: b.add("receiver", [0.43, 1.82, -0.5]),
      altitudeHold: b.add("receiver", [0.85, 1.82, -0.5]),
    },
    handedness = [1, -1, -1, 1],
    motors = positions.map(([x, , z], index) =>
      b.add("motor", [x, 1.95, z], {
        eulerRotation: [-Math.PI / 2, 0, 0],
        config: {
          mass: 24,
          rpm: 2_400,
          power: 50,
          direction: handedness[index],
          electricalEfficiency: 0.92,
        },
      }),
    ),
    rotors = positions.map(([x, , z], index) =>
      b.add("rotor", [x, 2.83, z], {
        eulerRotation: [-Math.PI / 2, 0, 0],
        config: {
          radiusM: 0.95,
          bladeChordM: 0.13,
          fixedPitchDeg: 15,
          // Cannon's revolute coordinate is opposite the authored motor drive
          // sign, so blade twist mirrors the drive sign to make positive local
          // rotor-axis thrust at the commanded forward rotation.
          handedness: -handedness[index],
        },
      }),
    );
  controller.controllerBindings = [
    ...Object.entries(receivers).map(([key, receiver]) => ({
      id: `pilot.${key === "altitudeHold" ? "altitude_hold" : key}`,
      direction: "input",
      endpointPartId: receiver.id,
      endpointPortId: "SIGNAL",
      reading: "command",
    })),
    {
      id: "nav.altitude",
      direction: "input",
      endpointPartId: navigation.id,
      endpointPortId: "SIGNAL",
      reading: "altitude",
    },
    ...[
      ["imu.roll", "imu_roll_deg"],
      ["imu.pitch", "imu_pitch_deg"],
      ["imu.yaw", "imu_yaw_deg"],
      ["imu.rate_x", "imu_rate_x"],
      ["imu.rate_y", "imu_rate_y"],
      ["imu.rate_z", "imu_rate_z"],
    ].map(([id, reading]) => ({
      id,
      direction: "input",
      endpointPartId: imu.id,
      endpointPortId: "SIGNAL",
      reading,
    })),
    ...motors.map((motor, index) => ({
      id: `motor.${index}.throttle`,
      direction: "output",
      endpointPartId: motor.id,
      endpointPortId: "CONTROL",
      channel: "throttle",
    })),
  ];
  for (const powered of [imu, navigation, ...Object.values(receivers)])
    b.power(battery, powered);
  for (const motor of motors) b.power(battery, motor);
  b.wireController(battery, controller, motors);
  for (const sensor of [imu, navigation, ...Object.values(receivers)])
    b.sensor(sensor, controller);
  for (const arm of arms)
    b.connect(deck, arm, "mechanical", {
      portA: "TOP",
      portB: "A",
      capacity: REINFORCED_CAPACITY,
    });
  for (const part of [
    battery,
    controller,
    imu,
    navigation,
    ...Object.values(receivers),
  ])
    b.connect(deck, part, "mechanical", {
      portA: "TOP",
      portB: "MOUNT",
      capacity: REINFORCED_CAPACITY,
    });
  for (let index = 0; index < motors.length; index++) {
    b.connect(arms[index], motors[index], "mechanical", {
      portA: "B",
      portB: "MOUNT",
      capacity: REINFORCED_CAPACITY,
    });
    b.connect(motors[index], rotors[index], "mechanical", {
      portA: "SHAFT",
      portB: "SHAFT",
      capacity: REINFORCED_CAPACITY,
    });
  }
  return b.build({
    name: "Quad Drone",
    title: "QUAD DRONE",
    description:
      "Four independently powered fixed-pitch rotors and a powered IMU close the attitude-control loop.",
    selectedType: "computer",
    autorunScript: true,
    controls: [
      control("Collective thrust", "command", "range", receivers.collective, {
        min: 0,
        max: 1,
        step: 0.02,
      }),
      control("Yaw", "command", "range", receivers.yaw, {
        min: -1,
        max: 1,
        step: 0.05,
      }),
      control("Pitch", "command", "range", receivers.pitch, {
        min: -1,
        max: 1,
        step: 0.05,
      }),
      control("Roll", "command", "range", receivers.roll, {
        min: -1,
        max: 1,
        step: 0.05,
      }),
      control("Altitude hold", "command", "toggle", receivers.altitudeHold),
    ],
  });
}

function mission(sources) {
  const stageInterfaceY = 3.73,
    flangeOffsetY = 0.15,
    plateHalfHeight = TYPES.plate.size[1] / 2,
    beamHalfLength = TYPES.beam.size[0] / 2,
    noseHalfHeight = TYPES.nosecone.size[1] / 2,
    heatShieldHalfHeight = TYPES.heatshield.size[1] / 2,
    stageSpineOffsetY = flangeOffsetY + plateHalfHeight + beamHalfLength,
    lowerSpineY = stageInterfaceY - stageSpineOffsetY,
    upperSpineY = stageInterfaceY + stageSpineOffsetY,
    upperNoseY = upperSpineY + beamHalfLength + noseHalfHeight,
    upperHeatShieldY = upperNoseY + noseHalfHeight + heatShieldHalfHeight,
    b = new BlueprintBuilder("mission"),
    engine = b.add("rocket", [0, 0.58, 0]),
    spineA = b.add("beam", [0, lowerSpineY, 0], {
      eulerRotation: [0, 0, Math.PI / 2],
    }),
    spineB = b.add("beam", [0, upperSpineY, 0], {
      eulerRotation: [0, 0, Math.PI / 2],
    }),
    tank = b.add("propellanttank", [0, lowerSpineY, 0], {
      config: { capacityKg: 700, initialUsableMassKg: 700 },
    }),
    lowerFlange = b.add("plate", [0, stageInterfaceY - flangeOffsetY, 0], {
      scale: [0.72, 1, 0.72],
    }),
    upperFlange = b.add("plate", [0, stageInterfaceY + flangeOffsetY, 0], {
      scale: [0.72, 1, 0.72],
    }),
    coupler = b.add("release-coupler", [0, stageInterfaceY, 0], {
      eulerRotation: [Math.PI / 2, 0, 0],
    }),
    battery = b.add("battery", [0.86, 4.55, 0]),
    rcsTank = b.add("propellanttank", [-0.86, upperSpineY, 0], {
      config: { capacityKg: 80, initialUsableMassKg: 80 },
    }),
    controller = b.add("computer", [0, 5.15, 0], {
      scriptLanguage: "typescript",
      scriptSources: controllerSources(sources.typescript, sources.wat),
    }),
    navigation = b.add("navsensor", [0.52, 4.95, 0]),
    proximity = b.add("rangesensor", [-0.52, 4.95, 0]),
    airData = b.add("pressureprobe", [0.58, 5.42, 0]),
    thermalProbe = b.add("thermalprobe", [-0.58, 5.42, 0]),
    receivers = {
      arm: b.add("receiver", [-0.82, stageInterfaceY + 0.39, 0]),
      launch: b.add("receiver", [-0.48, stageInterfaceY + 0.39, 0]),
      throttle: b.add("receiver", [-0.14, stageInterfaceY + 0.39, 0]),
      targetAltitude: b.add("receiver", [0.2, stageInterfaceY + 0.39, 0]),
      targetX: b.add("receiver", [0.54, stageInterfaceY + 0.39, 0]),
      targetZ: b.add("receiver", [0.88, stageInterfaceY + 0.39, 0]),
      stage: b.add("receiver", [-0.36, 4.25, 0]),
      abort: b.add("receiver", [0.36, 4.25, 0]),
    },
    nose = b.add("nosecone", [0, upperNoseY, 0]),
    heatShield = b.add("heatshield", [0, upperHeatShieldY, 0]),
    rcsPods = [
      b.add("rcs", [0.62, 4.45, 0], {
        eulerRotation: [0, 0, -Math.PI / 2],
      }),
      b.add("rcs", [-0.62, 4.45, 0], {
        eulerRotation: [0, 0, Math.PI / 2],
      }),
      b.add("rcs", [0, 4.45, 0.62], {
        eulerRotation: [Math.PI / 2, 0, 0],
      }),
      b.add("rcs", [0, 4.45, -0.62], {
        eulerRotation: [-Math.PI / 2, 0, 0],
      }),
    ],
    fins = [
      b.add("fin", [0.42, 1.08, 0]),
      b.add("fin", [-0.42, 1.08, 0], {
        eulerRotation: [0, Math.PI, 0],
      }),
      b.add("fin", [0, 1.08, 0.42], {
        eulerRotation: [0, -Math.PI / 2, 0],
      }),
      b.add("fin", [0, 1.08, -0.42], {
        eulerRotation: [0, Math.PI / 2, 0],
      }),
    ];
  b.power(battery, controller);
  for (const target of [...rcsPods, coupler]) b.command(controller, target);
  b.connect(controller, engine, "signal", {
    portA: "OUT",
    portB: "SIGNAL",
    releaseCouplerPartId: coupler.id,
  });
  b.power(battery, coupler);
  for (const sensor of [navigation, proximity, ...Object.values(receivers)]) {
    b.power(battery, sensor);
    b.sensor(sensor, controller);
  }
  for (const sensor of [airData, thermalProbe]) b.sensor(sensor, controller);
  b.resource(tank, engine);
  for (const thruster of rcsPods) b.resource(rcsTank, thruster);
  controller.controllerBindings = [
    ...[
      "altitude",
      "position_x",
      "position_z",
      "velocity_x",
      "velocity_z",
      "wind_x",
      "wind_z",
    ].map((reading) => ({
      id: `nav.${reading}`,
      direction: "input",
      endpointPartId: navigation.id,
      endpointPortId: "SIGNAL",
      reading,
    })),
    ...Object.entries(receivers).map(([key, receiver]) => ({
      id: `pilot.${
        key === "targetAltitude"
          ? "target_altitude"
          : key === "targetX"
            ? "target_x"
            : key === "targetZ"
              ? "target_z"
              : key
      }`,
      direction: "input",
      endpointPartId: receiver.id,
      endpointPortId: "SIGNAL",
      reading: "command",
    })),
    ...[
      ["target.detected", "proximity_detected"],
      ["target.range", "proximity_range_m"],
      ["target.range_rate", "proximity_range_rate_mps"],
    ].map(([id, reading]) => ({
      id,
      direction: "input",
      endpointPartId: proximity.id,
      endpointPortId: "SIGNAL",
      reading,
    })),
    {
      id: "air.dynamic_pressure",
      direction: "input",
      endpointPartId: airData.id,
      endpointPortId: "SIGNAL",
      reading: "dynamic_pressure_pa",
    },
    {
      id: "thermal.temperature",
      direction: "input",
      endpointPartId: thermalProbe.id,
      endpointPortId: "SIGNAL",
      reading: "temperature_c",
    },
    {
      id: "engine.throttle",
      direction: "output",
      endpointPartId: engine.id,
      endpointPortId: "SIGNAL",
      channel: "throttle",
    },
    {
      id: "engine.gimbal",
      direction: "output",
      endpointPartId: engine.id,
      endpointPortId: "SIGNAL",
      channel: "gimbal_x",
    },
    {
      id: "coupler.release",
      direction: "output",
      endpointPartId: coupler.id,
      endpointPortId: "CONTROL",
      channel: "release",
    },
    ...rcsPods.map((pod, index) => ({
      id: `rcs.${index}.throttle`,
      direction: "output",
      endpointPartId: pod.id,
      endpointPortId: "SIGNAL",
      channel: "throttle",
    })),
  ];
  for (const [a, target, portA, portB] of [
    [engine, spineA, "MOUNT", "A"],
    [spineA, lowerFlange, "B", "BOTTOM"],
    [upperFlange, spineB, "TOP", "A"],
    [spineA, tank, "SURFACE", "MOUNT"],
    [spineB, battery, "SURFACE", "MOUNT"],
    [spineB, rcsTank, "SURFACE", "MOUNT"],
    [spineB, controller, "SURFACE", "MOUNT"],
    [spineB, navigation, "SURFACE", "MOUNT"],
    [spineB, proximity, "SURFACE", "MOUNT"],
    [spineB, airData, "SURFACE", "MOUNT"],
    [spineB, thermalProbe, "SURFACE", "MOUNT"],
    ...Object.values(receivers).map((receiver) => [
      spineB,
      receiver,
      "SURFACE",
      "MOUNT",
    ]),
    [spineB, nose, "B", "BASE"],
    [spineB, heatShield, "SURFACE", "BACK"],
  ])
    b.connect(a, target, "mechanical", {
      portA,
      portB,
      capacity: REINFORCED_CAPACITY,
    });
  b.connect(lowerFlange, coupler, "mechanical", {
    portA: "TOP",
    portB: "FLANGE_A",
    capacity: REINFORCED_CAPACITY,
  });
  b.connect(coupler, upperFlange, "mechanical", {
    portA: "FLANGE_B",
    portB: "BOTTOM",
    capacity: REINFORCED_CAPACITY,
  });
  for (const pod of rcsPods)
    b.connect(spineB, pod, "mechanical", {
      portA: "SURFACE",
      portB: "MOUNT",
      capacity: REINFORCED_CAPACITY,
    });
  for (const fin of fins)
    b.connect(spineA, fin, "mechanical", {
      portA: "SURFACE",
      portB: "ROOT",
      capacity: REINFORCED_CAPACITY,
    });
  return b.build({
    name: "Orbital Missile",
    title: "ORBITAL MISSILE",
    description:
      "Arm, set throttle, launch, stage, or abort from the Space Mission remote.",
    selectedType: "computer",
    autorunScript: true,
    controls: [
      control("Arm vehicle", "command", "toggle", receivers.arm),
      control("Launch", "command", "pulse", receivers.launch),
      control("Main throttle", "command", "range", receivers.throttle, {
        min: 0,
        max: 1,
        step: 0.02,
      }),
      control("Target altitude", "command", "range", receivers.targetAltitude, {
        min: 100,
        max: 150000,
        step: 1000,
        value: 100000,
      }),
      control("Target lateral X", "command", "range", receivers.targetX, {
        min: -200,
        max: 200,
        step: 5,
        value: -100,
      }),
      control("Target lateral Z", "command", "range", receivers.targetZ, {
        min: -200,
        max: 200,
        step: 5,
      }),
      control("Stage", "command", "pulse", receivers.stage),
      control("Abort mission", "command", "hold", receivers.abort),
    ],
  });
}

export function builtInDemo(kind, sources = {}) {
  const factories = { gearbox, cart, humanoid, drone };
  if (kind === "mission") return mission(sources);
  const factory = factories[kind];
  if (!factory) throw new Error(`Unknown demo ${kind}`);
  return factory(sources);
}

/** The ordinary orbital machine packaged through the same reusable-asset path. */
export function builtInMissionStageSubassembly(sources = {}) {
  const { blueprint } = mission(sources),
    asset = createSubassemblyTemplate(
      { parts: blueprint.parts, connections: blueprint.connections },
      blueprint.parts.map((part) => part.id),
      {
        name: "Scripted orbital staging assembly",
        accent: "#e0a84c",
        origin: [0, 0, 0],
      },
    ),
    epoch = new Date(0).toISOString();
  return createLocalSubassemblyRecord(asset, {
    origin: {
      kind: BlueprintAcquisition.BUILT_IN,
      sourceFingerprint: null,
    },
    createdAt: epoch,
    updatedAt: epoch,
  });
}
