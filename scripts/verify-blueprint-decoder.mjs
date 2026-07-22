import assert from "node:assert/strict";
import fs from "node:fs";
import {
  decodeBlueprint,
  decodeBlueprintOrThrow,
} from "../src/model/blueprint-decoder.js";
import { normalizeBlueprint } from "../src/model/blueprints.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { resolveWireComponentConfig } from "../src/model/component-resolver.js";

const fixture = JSON.parse(
  fs.readFileSync(
    "test/fixtures/strict-current-contract/blueprint.spec.json",
    "utf8",
  ),
);

function rejection(mutator, code) {
  const candidate = structuredClone(fixture);
  mutator(candidate);
  const result = decodeBlueprint(candidate);
  assert.equal(result.ok, false, `${code} fixture was accepted`);
  assert.equal(result.errors[0].code, code);
  assert.equal(result.value, null);
}

for (const version of [undefined, 0, 2])
  rejection((candidate) => {
    if (version === undefined) delete candidate.version;
    else candidate.version = version;
  }, "UNSUPPORTED_BLUEPRINT_VERSION");

for (const field of [
  "remoteControls",
  "remoteProfile",
  "scriptSource",
  "scriptSources",
  "scriptControllerId",
  "selection",
  "programTrust",
])
  rejection((candidate) => {
    candidate[field] = field === "remoteControls" ? {} : null;
  }, "WIRE_SCHEMA_VIOLATION");

rejection(
  (candidate) => (candidate.parts[0].position = [0, 0, 0]),
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => (candidate.parts[0].rotation = [0, 0, 0]),
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => delete candidate.parts[0].orientation,
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => (candidate.parts[0].orientation = [0, 0, 0, 2]),
  "NON_UNIT_QUATERNION",
);
rejection(
  (candidate) => (candidate.parts[0].orientation = [0, 0, 0, -1]),
  "NONCANONICAL_QUATERNION",
);
rejection(
  (candidate) => (candidate.parts[0].energy = 1),
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => (candidate.parts[0].config.future = 1),
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => (candidate.parts[0].config.teeth = 12),
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => delete candidate.parts[0].config.mass,
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => delete candidate.connections[0].portA,
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => delete candidate.connections[0].capacity,
  "MISSING_CONNECTION_CAPACITY",
);
rejection(
  (candidate) => (candidate.connections[0].strength = 100),
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => (candidate.connections[0].failed = true),
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => (candidate.connections[0].portA = "UNKNOWN"),
  "UNKNOWN_PORT",
);
rejection(
  (candidate) => (candidate.connections[0].b = 999),
  "DANGLING_CONNECTION",
);
rejection((candidate) => (candidate.connections[0].b = 1), "SELF_CONNECTION");
rejection(
  (candidate) => candidate.parts.push(structuredClone(candidate.parts[0])),
  "DUPLICATE_PART_ID",
);
rejection(
  (candidate) =>
    candidate.connections.push(structuredClone(candidate.connections[0])),
  "DUPLICATE_CONNECTION_ID",
);
rejection(
  (candidate) => (candidate.name = " padded "),
  "INVALID_BLUEPRINT_NAME",
);
rejection(
  (candidate) => (candidate.created = "not-a-date"),
  "INVALID_BLUEPRINT_TIMESTAMP",
);
rejection(
  (candidate) => (candidate.defaultRemoteProfile = "missing"),
  "UNKNOWN_DEFAULT_REMOTE_PROFILE",
);

const battery = structuredClone(fixture);
battery.parts = [
  {
    id: 10,
    type: "battery",
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    config: resolveWireComponentConfig({
      type: "battery",
      config: { capacityWh: 10 },
    }),
    storedEnergyWh: 10,
  },
];
battery.connections = [];
assert.equal(decodeBlueprint(battery).ok, true);
rejection((candidate) => {
  candidate.parts = structuredClone(battery.parts);
  candidate.parts[0].storedEnergyWh = 11;
  candidate.connections = [];
}, "BATTERY_CHARGE_EXCEEDS_CAPACITY");

const computer = builtInDemo("gearbox").blueprint;
assert.equal(decodeBlueprint(computer).ok, true);
for (const [name, mutate, code] of [
  [
    "missing bindings",
    (controller) => delete controller.controllerBindings,
    "WIRE_SCHEMA_VIOLATION",
  ],
  [
    "unknown binding field",
    (controller) => (controller.controllerBindings[0].future = true),
    "WIRE_SCHEMA_VIOLATION",
  ],
  [
    "duplicate binding alias",
    (controller) =>
      (controller.controllerBindings[1].id =
        controller.controllerBindings[0].id),
    "DUPLICATE_CONTROLLER_BINDING",
  ],
  [
    "missing endpoint",
    (controller) => (controller.controllerBindings[0].endpointPartId = 999),
    "MISSING_CONTROLLER_ENDPOINT",
  ],
  [
    "missing endpoint port",
    (controller) =>
      (controller.controllerBindings[0].endpointPortId = "MISSING"),
    "MISSING_CONTROLLER_ENDPOINT_PORT",
  ],
  [
    "offline endpoint route",
    (controller, candidate) => {
      const endpointId = controller.controllerBindings[0].endpointPartId;
      candidate.connections = candidate.connections.filter(
        (connection) =>
          connection.a !== endpointId && connection.b !== endpointId,
      );
    },
    "OFFLINE_CONTROLLER_INPUT_ROUTE",
  ],
  [
    "unsupported input reading",
    (controller) => {
      controller.controllerBindings.find(
        (binding) => binding.direction === "input",
      ).reading = "telepathy";
    },
    "UNSUPPORTED_CONTROLLER_READING",
  ],
  [
    "unsupported output channel",
    (controller) => {
      controller.controllerBindings.find(
        (binding) => binding.direction === "output",
      ).channel = "teleport";
    },
    "UNSUPPORTED_CONTROLLER_CHANNEL",
  ],
]) {
  const candidate = structuredClone(builtInDemo("mission").blueprint),
    controller = candidate.parts.find(
      (part) => part.type === "computer" && part.controllerBindings.length > 1,
    );
  mutate(controller, candidate);
  assert.equal(
    decodeBlueprint(candidate).errors[0].code,
    code,
    `${name} controller binding was accepted`,
  );
}
const mechanismBlueprint = builtInDemo("cart").blueprint,
  mechanismPartIndex = mechanismBlueprint.parts.findIndex(
    (part) => part.type === "wheel",
  );
for (const [mutator, code] of [
  [
    (candidate) => (candidate.parts[mechanismPartIndex].config = {}),
    "WIRE_SCHEMA_VIOLATION",
  ],
  [
    (candidate) => delete candidate.parts[mechanismPartIndex].mechanism,
    "WIRE_SCHEMA_VIOLATION",
  ],
  [
    (candidate) =>
      (candidate.parts[mechanismPartIndex].mechanism.componentType = "axle"),
    "WIRE_SCHEMA_VIOLATION",
  ],
  [
    (candidate) =>
      (candidate.parts[mechanismPartIndex].scale = { x: 1, y: 2, z: 1 }),
    "MECHANISM_SCALE_FORBIDDEN",
  ],
]) {
  const candidate = structuredClone(mechanismBlueprint);
  mutator(candidate);
  assert.equal(
    decodeBlueprint(candidate).errors[0].code,
    code,
    `${code} mechanism boundary was accepted`,
  );
}
for (const [mutator, code] of [
  [
    (candidate) =>
      (candidate.parts.find(
        (part) => part.type === "computer",
      ).scriptSources.typescript = "😀".repeat(20_000)),
    "SCRIPT_SIZE_LIMIT",
  ],
  [
    (candidate) =>
      (candidate.parts.find(
        (part) => part.type === "computer",
      ).scriptSources.visual.version = 2),
    "UNSUPPORTED_VISUAL_PROGRAM_VERSION",
  ],
  [
    (candidate) =>
      (candidate.parts.find(
        (part) => part.type === "computer",
      ).scriptSources.visual = {
        version: 1,
        name: "Broken",
        nodes: [{ id: "broken", type: "unknown" }],
        links: [],
      }),
    "INVALID_VISUAL_PROGRAM",
  ],
]) {
  const candidate = structuredClone(computer);
  mutator(candidate);
  assert.equal(decodeBlueprint(candidate).errors[0].code, code);
}

const mission = builtInDemo("mission").blueprint,
  overfilledTank = structuredClone(mission),
  tankPart = overfilledTank.parts.find(
    (part) => part.type === "propellanttank",
  );
tankPart.config.initialUsableMassKg = tankPart.config.capacityKg + 1;
assert.equal(
  decodeBlueprint(overfilledTank).errors[0].code,
  "INVALID_INITIAL_MATERIAL_MASS",
);
const programOnBeam = structuredClone(fixture);
programOnBeam.parts[0].scriptLanguage = "wat";
programOnBeam.parts[0].scriptSources = {
  visual: { version: 1, name: "Empty", nodes: [], links: [] },
  typescript: "",
  wat: "",
};
assert.equal(
  decodeBlueprint(programOnBeam).errors[0].code,
  "WIRE_SCHEMA_VIOLATION",
);

const range = structuredClone(fixture.remoteProfiles.operator.controls),
  originalActions = structuredClone(
    fixture.remoteProfiles.operator.actionBindings,
  );
fixture.remoteProfiles.operator.controls = [
  {
    id: "throttle",
    label: "Throttle",
    channel: "throttle",
    type: "range",
    targetId: null,
    defaultValue: 0,
    hotkey: null,
    min: -1,
    max: 1,
    step: 0.1,
  },
];
fixture.remoteProfiles.operator.actionBindings = {
  forward: {
    controlId: "throttle",
    pressedValue: 1,
    releasedValue: 0,
  },
};
assert.equal(decodeBlueprint(fixture).ok, true);
for (const [mutator, code] of [
  [
    (candidate) =>
      candidate.remoteProfiles.operator.controls.push(
        structuredClone(candidate.remoteProfiles.operator.controls[0]),
      ),
    "DUPLICATE_CONTROL_ID",
  ],
  [
    (candidate) => delete candidate.remoteProfiles.operator.controls[0].min,
    "INVALID_RANGE_CONTROL",
  ],
  [
    (candidate) =>
      (candidate.remoteProfiles.operator.controls[0].defaultValue = 2),
    "CONTROL_DEFAULT_OUT_OF_RANGE",
  ],
  [
    (candidate) => {
      const value = candidate.remoteProfiles.operator.controls[0];
      value.type = "toggle";
    },
    "UNEXPECTED_RANGE_FIELDS",
  ],
  [
    (candidate) => {
      const value = candidate.remoteProfiles.operator.controls[0];
      value.type = "toggle";
      value.defaultValue = 2;
      delete value.min;
      delete value.max;
      delete value.step;
    },
    "INVALID_TOGGLE_DEFAULT",
  ],
  [
    (candidate) => {
      const value = candidate.remoteProfiles.operator.controls[0];
      value.type = "hold";
      value.defaultValue = 1;
      delete value.min;
      delete value.max;
      delete value.step;
    },
    "INVALID_MOMENTARY_DEFAULT",
  ],
]) {
  const candidate = structuredClone(fixture);
  mutator(candidate);
  assert.equal(decodeBlueprint(candidate).errors[0].code, code);
}
for (const [mutator, code] of [
  [
    (candidate) => delete candidate.remoteProfiles.operator.actionBindings,
    "WIRE_SCHEMA_VIOLATION",
  ],
  [
    (candidate) =>
      (candidate.remoteProfiles.operator.actionBindings.fly = {
        controlId: "throttle",
        pressedValue: 1,
        releasedValue: 0,
      }),
    "WIRE_SCHEMA_VIOLATION",
  ],
  [
    (candidate) =>
      (candidate.remoteProfiles.operator.actionBindings.forward.controlId =
        "missing"),
    "UNKNOWN_REMOTE_ACTION_CONTROL",
  ],
  [
    (candidate) =>
      (candidate.remoteProfiles.operator.actionBindings.lights = {
        controlId: "throttle",
      }),
    "REMOTE_ACTION_CONTROL_TYPE_MISMATCH",
  ],
  [
    (candidate) =>
      (candidate.remoteProfiles.operator.actionBindings.forward.pressedValue = 2),
    "REMOTE_ACTION_VALUE_OUT_OF_RANGE",
  ],
  [
    (candidate) =>
      (candidate.remoteProfiles.operator.actionBindings.brake = {
        controlId: "throttle",
        pressedValue: 1,
        releasedValue: 0,
      }),
    "REMOTE_ACTION_CONTROL_CONFLICT",
  ],
]) {
  const candidate = structuredClone(fixture);
  mutator(candidate);
  assert.equal(decodeBlueprint(candidate).errors[0].code, code);
}
fixture.remoteProfiles.operator.controls = range;
fixture.remoteProfiles.operator.actionBindings = originalActions;

for (const [mutator, code] of [
  [
    (candidate) => (candidate.connections[0].portA = "SURFACE"),
    "MISSING_SURFACE_ANCHOR",
  ],
  [
    (candidate) => (candidate.connections[0].anchorA = [0, 0, 0]),
    "UNEXPECTED_SURFACE_ANCHOR",
  ],
  [
    (candidate) => {
      candidate.connections[0].kind = "power";
      candidate.connections[0].capacity = {
        ultimateForceN: 1,
        ultimateTorqueNm: 1,
      };
    },
    "NETWORK_CAPACITY_FORBIDDEN",
  ],
]) {
  const candidate = structuredClone(fixture);
  mutator(candidate);
  assert.equal(decodeBlueprint(candidate).errors[0].code, code);
}

const normalized = normalizeBlueprint(fixture);
assert.deepEqual(normalizeBlueprint(normalized), normalized);
assert.deepEqual(
  decodeBlueprintOrThrow(JSON.stringify(normalized)).wire,
  normalized,
);
assert.throws(
  () => decodeBlueprintOrThrow({ version: 2 }),
  (error) => error.code === "UNSUPPORTED_BLUEPRINT_VERSION",
);

console.log("strict blueprint v1 decoder and rejection contract passed");
