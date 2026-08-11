import assert from "node:assert/strict";
import { createCommandCandidateReader } from "../src/application/command-candidate-reader.js";
import { createControllerLifecycleFeature } from "../src/application/controller-lifecycle-feature.js";
import { advanceFailureEvidenceReplayControllers } from "../src/application/failure-evidence-replay.js";
import { ControllerRuntimeReadModel } from "../src/application/controller-runtime-read-model.js";
import { pointContactWrenchAllocatorProgram } from "../src/model/autonomous-controller-programs.js";
import { poweredIdEvidenceSet } from "../src/model/powered-id-evidence.js";
import {
  controllerSensorFrameKey,
  controllerSensorFrameForId,
  controllerSensorFrameRecord,
  setControllerSensorFrame,
} from "../src/model/controller-sensor-frame-evidence.js";
import { TYPES } from "../src/model/component-catalog.js";
import { controllerBindingManifest } from "../src/model/controller-bindings.js";
import { ControllerTraceBuffer } from "../src/model/controller-debugger.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { preparePhysicsTypeScriptController } from "../src/application/controller-physics-compilers.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { CommandReceiverSystem } from "../src/simulation/systems/command-receiver-system.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const axes = ["x", "y", "z"],
  contactIds = ["alpha", "bravo"],
  part = (id, type, config = {}, extra = {}) => ({
    id,
    type,
    config,
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }),
  targetForceBindingIds = axes.map((axis) => `target.force.${axis}`),
  targetMomentBindingIds = axes.map((axis) => `target.moment.${axis}`),
  targetBindingIds = [...targetForceBindingIds, ...targetMomentBindingIds],
  targetValues = new Map([
    [targetForceBindingIds[0], 0],
    [targetForceBindingIds[1], 100],
    [targetForceBindingIds[2], 0],
    ...targetMomentBindingIds.map((id) => [id, 0]),
  ]),
  targetReceivers = new Map(
    targetBindingIds.map((bindingId) => [
      bindingId,
      part(`target-receiver-${bindingId}`, "receiver"),
    ]),
  ),
  contactSensors = new Map(
    contactIds.map((contactId) => [
      contactId,
      part(`contact-sensor-${contactId}`, "contactsensor"),
    ]),
  ),
  contactBindings = new Map(
    contactIds.map((contactId) => [
      contactId,
      {
        point: axes.map((axis) => `${contactId}.point.${axis}`),
        normal: axes.map((axis) => `${contactId}.normal.${axis}`),
        friction: `${contactId}.friction`,
      },
    ]),
  ),
  diagnosticOutputBindingIds = {
    authorityValid: "allocation.authority-valid",
    solverConverged: "allocation.solver-converged",
    accepted: "allocation.accepted",
    rejectionCode: "allocation.rejection-code",
    forceResidualNormN: "allocation.force-residual-norm-n",
    momentResidualNormNm: "allocation.moment-residual-norm-nm",
    saturated: "allocation.saturated",
    residualClipped: "allocation.residual-clipped",
  },
  forceOutputBindingIds = new Map(
    contactIds.map((contactId) => [
      contactId,
      axes.map((axis) => `${contactId}.force-world-${axis}-n`),
    ]),
  ),
  outputBindingIds = [
    ...Object.values(diagnosticOutputBindingIds),
    ...contactIds.flatMap((contactId) => forceOutputBindingIds.get(contactId)),
  ],
  demandReceivers = new Map(
    outputBindingIds.map((bindingId) => [
      bindingId,
      part(`demand-receiver-${bindingId}`, "receiver"),
    ]),
  ),
  sourceController = part("target-source", "computer"),
  allocatorController = part("wrench-allocator", "computer"),
  consumerController = part("demand-observer", "computer"),
  offlineController = part(
    "offline-controller",
    "computer",
    {},
    {
      controllerBindings: [],
    },
  ),
  battery = part(
    "fixture-battery",
    "battery",
    {
      capacityWh: 1_000,
      maxOutputWatts: 1_000_000,
      dischargeEfficiency: 1,
    },
    { storedEnergyWh: 1_000 },
  );

assert.deepEqual(poweredIdEvidenceSet([]), new Set());
assert.deepEqual(
  poweredIdEvidenceSet([7, "7", "controller-alpha"]),
  new Set([7, "7", "controller-alpha"]),
  "power evidence collapsed distinct canonical ID types",
);
for (const invalidEvidence of [
  undefined,
  null,
  "7",
  {},
  [null],
  [1.5],
  [Number.MAX_SAFE_INTEGER + 1],
  [""],
  [7, 7],
  ["7", "7"],
  [7, ""],
  [7, Number.MAX_SAFE_INTEGER + 1],
])
  assert.equal(
    poweredIdEvidenceSet(invalidEvidence),
    null,
    `power evidence accepted ${JSON.stringify(invalidEvidence)}`,
  );
const typedControllerFrames = controllerSensorFrameRecord([
  [7, { marker: "number-seven" }],
  ["7", { marker: "string-seven" }],
]);
assert.equal(
  controllerSensorFrameForId(typedControllerFrames, 7).marker,
  "number-seven",
);
assert.equal(
  controllerSensorFrameForId(typedControllerFrames, "7").marker,
  "string-seven",
);
assert.equal(
  controllerSensorFrameForId({ 7: { marker: "untyped" } }, 7),
  null,
  "untyped controller sensor frames crossed the authority boundary",
);
const callableEvidence = () => {};
for (const invalidFrames of [undefined, null, "frames", [], callableEvidence])
  assert.throws(
    () => setControllerSensorFrame(invalidFrames, 7, {}),
    /frames must be a record/,
  );
for (const invalidFrame of [undefined, null, "frame", [], callableEvidence])
  assert.throws(
    () => setControllerSensorFrame({}, 7, invalidFrame),
    /frame must be a record/,
  );
assert.throws(
  () => setControllerSensorFrame(typedControllerFrames, 7, {}),
  /frame ID is duplicated/,
);
for (const invalidFrames of [undefined, null, "frames", []])
  assert.equal(controllerSensorFrameForId(invalidFrames, 7), null);
const numericFrameKey = controllerSensorFrameKey(7);
const callableFrames = () => {};
callableFrames[numericFrameKey] = typedControllerFrames[numericFrameKey];
assert.equal(
  controllerSensorFrameForId(callableFrames, 7),
  null,
  "a callable sensor-frame container granted authority",
);
const callableFrame = () => {};
callableFrame.__controllerIdentity = numericFrameKey;
callableFrame.marker = "forged-callable-frame";
for (const invalidFrame of [
  undefined,
  null,
  "frame",
  [],
  callableFrame,
  {},
  { __controllerIdentity: "string:1:7" },
])
  assert.equal(
    controllerSensorFrameForId({ [numericFrameKey]: invalidFrame }, 7),
    null,
  );
let replayTypedMarker = null;
const replayTypedIdentityManager = new ControllerRuntimeManager();
replayTypedIdentityManager.attach(7, {
  instantiate: () => ({
    tick: (_dt, sensors) => {
      replayTypedMarker = sensors.marker;
      return new Map();
    },
    dispose() {},
  }),
});
advanceFailureEvidenceReplayControllers(replayTypedIdentityManager, 1 / 120, {
  poweredControllerIds: [7],
  controllers: typedControllerFrames,
});
assert.equal(
  replayTypedMarker,
  "number-seven",
  "replay dispatched a same-spelling sensor frame from another ID type",
);
replayTypedIdentityManager.disposeAll();

sourceController.controllerBindings = targetBindingIds.map((bindingId) => ({
  id: bindingId,
  direction: "output",
  endpointPartId: targetReceivers.get(bindingId).id,
  endpointPortId: "CONTROL",
  channel: "command",
}));
allocatorController.controllerBindings = [
  ...targetBindingIds.map((bindingId) => ({
    id: bindingId,
    direction: "input",
    endpointPartId: targetReceivers.get(bindingId).id,
    endpointPortId: "SIGNAL",
    reading: "command",
  })),
  ...contactIds.flatMap((contactId) => {
    const sensor = contactSensors.get(contactId),
      bindings = contactBindings.get(contactId);
    return [
      ...bindings.point.map((bindingId, axis) => ({
        id: bindingId,
        direction: "input",
        endpointPartId: sensor.id,
        endpointPortId: "SIGNAL",
        reading: `contact_resultant_point_world_${axes[axis]}_m`,
      })),
      ...bindings.normal.map((bindingId, axis) => ({
        id: bindingId,
        direction: "input",
        endpointPartId: sensor.id,
        endpointPortId: "SIGNAL",
        reading: `contact_resultant_normal_world_${axes[axis]}`,
      })),
      {
        id: bindings.friction,
        direction: "input",
        endpointPartId: sensor.id,
        endpointPortId: "SIGNAL",
        reading: "contact_min_friction_coefficient",
      },
    ];
  }),
  ...outputBindingIds.map((bindingId) => ({
    id: bindingId,
    direction: "output",
    endpointPartId: demandReceivers.get(bindingId).id,
    endpointPortId: "CONTROL",
    channel: "command",
  })),
];
consumerController.controllerBindings = outputBindingIds.map((bindingId) => ({
  id: `observed.${bindingId}`,
  direction: "input",
  endpointPartId: demandReceivers.get(bindingId).id,
  endpointPortId: "SIGNAL",
  reading: "command",
}));

const poweredParts = [
    sourceController,
    allocatorController,
    consumerController,
    ...targetReceivers.values(),
    ...demandReceivers.values(),
  ],
  parts = [
    battery,
    sourceController,
    allocatorController,
    consumerController,
    offlineController,
    ...targetReceivers.values(),
    ...contactSensors.values(),
    ...demandReceivers.values(),
  ],
  connections = [
    ...poweredParts.map((poweredPart) => ({
      id: `power-${poweredPart.id}`,
      a: battery.id,
      b: poweredPart.id,
      kind: "power",
      portA: "POWER",
      portB: "POWER",
    })),
    ...targetBindingIds.flatMap((bindingId) => {
      const receiver = targetReceivers.get(bindingId);
      return [
        {
          id: `source-to-${receiver.id}`,
          a: sourceController.id,
          b: receiver.id,
          kind: "signal",
          portA: "OUT",
          portB: "CONTROL",
        },
        {
          id: `${receiver.id}-to-allocator`,
          a: receiver.id,
          b: allocatorController.id,
          kind: "signal",
          portA: "SIGNAL",
          portB: "IN A",
        },
      ];
    }),
    ...contactIds.map((contactId) => ({
      id: `${contactSensors.get(contactId).id}-to-allocator`,
      a: contactSensors.get(contactId).id,
      b: allocatorController.id,
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN A",
    })),
    ...outputBindingIds.flatMap((bindingId) => {
      const receiver = demandReceivers.get(bindingId);
      return [
        {
          id: `allocator-to-${receiver.id}`,
          a: allocatorController.id,
          b: receiver.id,
          kind: "signal",
          portA: "OUT",
          portB: "CONTROL",
        },
        {
          id: `${receiver.id}-to-consumer`,
          a: receiver.id,
          b: consumerController.id,
          kind: "signal",
          portA: "SIGNAL",
          portB: "IN A",
        },
      ];
    }),
  ],
  sourceManifest = controllerBindingManifest(
    sourceController,
    parts,
    connections,
  ),
  allocatorManifest = controllerBindingManifest(
    allocatorController,
    parts,
    connections,
  ),
  consumerManifest = controllerBindingManifest(
    consumerController,
    parts,
    connections,
  ),
  allocationSpec = {
    version: 1,
    targetFrame: {
      frameId: "fixture/world",
      positionWorldM: [0, 0, 0],
      quaternionWorldFromFrame: [0, 0, 0, 1],
    },
    targetWrenchBindings: {
      forceN: targetForceBindingIds,
      momentNm: targetMomentBindingIds,
    },
    contacts: contactIds.map((contactId) => ({
      contactId,
      pointWorldBindings: contactBindings.get(contactId).point,
      normalWorldBindings: contactBindings.get(contactId).normal,
      frictionCoefficientBinding: contactBindings.get(contactId).friction,
      normalForceLimitN: 100,
      tangentialForceLimitN: 100,
    })),
    acceptance: {
      forceResidualToleranceN: 1e-6,
      momentResidualToleranceNm: 1e-6,
      momentReferenceLengthM: 1,
    },
    solver: {
      maxIterations: 256,
      projectedGradientToleranceN: 1e-7,
    },
  },
  allocatorSource = pointContactWrenchAllocatorProgram({
    allocationSpec,
    diagnosticOutputBindingIds,
    contactForceOutputs: contactIds.map((contactId) => ({
      contactId,
      forceWorldOutputBindingIds: forceOutputBindingIds.get(contactId),
    })),
    bindingManifest: allocatorManifest,
  }),
  sourceProgram = `interface ControlAPI {
  write(binding: string, value: number): void;
}
function tick(api: ControlAPI, dt: number): void {
  void dt;
${[...targetValues]
  .map(
    ([bindingId, value]) =>
      `  api.write(${JSON.stringify(bindingId)}, ${value});`,
  )
  .join("\n")}
}`,
  [preparedSource, preparedAllocator] = await Promise.all([
    preparePhysicsTypeScriptController(sourceProgram, sourceManifest),
    preparePhysicsTypeScriptController(allocatorSource, allocatorManifest),
  ]),
  runtimeReadModel = new ControllerRuntimeReadModel(),
  runtimeManager = new ControllerRuntimeManager({
    onStatus: (controllerId, status, ready) =>
      runtimeReadModel.setStatus(controllerId, status, ready),
    onCommands: (controllerId, outputs) =>
      runtimeReadModel.setCommands(controllerId, outputs),
  });

runtimeManager.attach(sourceController.id, preparedSource, "TARGET SOURCE");
runtimeManager.attach(
  allocatorController.id,
  preparedAllocator,
  "WRENCH ALLOCATOR",
);
runtimeManager.tick(sourceController.id, 1 / 120, {});

const baseCandidateReader = createCommandCandidateReader({
    getState: () => ({
      remoteControls: { default: [] },
      remoteProfile: "default",
      parts,
    }),
    runtimeManager,
    runtimeReadModel,
  }),
  session = new SimulationSession({
    systems: [
      new PowerSystem(),
      new SignalSystem(),
      new CommandRoutingSystem(),
      new CommandReceiverSystem(),
      new TelemetrySystem(),
    ],
  });
let commandMode = "normal";
session.start(
  { parts, connections },
  {
    catalog: TYPES,
    readCommandCandidates: () => {
      const candidates = baseCandidateReader();
      return {
        ...candidates,
        scripts: candidates.scripts
          .filter(
            (candidate) =>
              commandMode !== "target-silent" ||
              candidate.controllerId !== sourceController.id,
          )
          .map((candidate) => {
            if (
              commandMode === "allocator-route-loss" &&
              candidate.controllerId === allocatorController.id
            )
              return { ...candidate, endpointPortId: "SIGNAL" };
            if (
              commandMode === "allocator-power-loss" &&
              candidate.controllerId === allocatorController.id
            )
              return { ...candidate, controllerId: offlineController.id };
            return candidate;
          }),
      };
    },
  },
);

const identityPose = {
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  },
  contactSample = (contactId, tick) => {
    const x = contactId === "alpha" ? -0.5 : 0.5;
    return {
      tick,
      contactId: `row-${contactId}`,
      normalForceValid: true,
      frictionCoefficientValid: true,
      frictionCoefficient: 0.8,
      observationFrame: identityPose,
      point: { x, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      forceN: 50,
      forceWorldN: { x: 0, y: 50, z: 0 },
      materialKey: "generic-structure",
      otherMaterialKey: "workshop-steel",
      shapeId: `shape-${contactId}`,
      otherShapeId: `support-${contactId}`,
      validity: "measured",
    };
  };
let missingContactId = null;
const bodySnapshot = (snapshotTick) => {
    const bodyParts = [
      ...contactSensors.values(),
      ...targetReceivers.values(),
      ...demandReceivers.values(),
    ];
    return {
      tick: snapshotTick,
      bodies: bodyParts.map((bodyPart) => {
        const contactId = contactIds.find(
          (candidate) => contactSensors.get(candidate).id === bodyPart.id,
        );
        return {
          bodyId: `body-${bodyPart.id}`,
          partIds: [bodyPart.id],
          bound: true,
          detached: false,
          pose: identityPose,
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          acceleration: { x: 0, y: 0, z: 0 },
          contacts:
            contactId && contactId !== missingContactId
              ? [contactSample(contactId, snapshotTick)]
              : [],
          loads: [],
          thermal: {},
        };
      }),
      bodyByPart: bodyParts.map((bodyPart) => ({
        partId: bodyPart.id,
        bodyId: `body-${bodyPart.id}`,
      })),
    };
  },
  sensorBank = new ControllerSensorBank(),
  captureWithBodyTick = (controllerId, tick) => {
    const telemetry = session.telemetry();
    const bodies = bodySnapshot(tick);
    if (tick === undefined) delete bodies.tick;
    else bodies.tick = tick;
    return controllerSensorFrameForId(
      sensorBank.capture({
        parts,
        connections,
        bodies,
        signals: telemetry.systems.signals,
        commandReceivers: telemetry.systems.commandReceivers,
        fixedDt: 1 / 120,
        time: telemetry.time,
      }),
      controllerId,
    );
  },
  capture = (controllerId) =>
    captureWithBodyTick(controllerId, session.telemetry().tick),
  observed = (frame, bindingId) => frame[`observed.${bindingId}`],
  observedValid = (frame, bindingId) =>
    frame.__validity[`observed.${bindingId}`],
  advanceAllocation = () => {
    const frame = capture(allocatorController.id);
    assert.equal(
      runtimeManager.tick(allocatorController.id, 1 / 120, frame),
      true,
      JSON.stringify(runtimeManager.status(allocatorController.id)),
    );
    session.stepFixed();
    return { frame, observed: capture(consumerController.id) };
  };

session.stepFixed();
let result = advanceAllocation();
assert.equal(result.frame.__snapshotTick + 1, result.observed.__snapshotTick);
assert.equal(result.frame.__snapshotTick, session.telemetry().tick - 1);
const staleReceiverFrame = captureWithBodyTick(
  allocatorController.id,
  result.frame.__snapshotTick - 1,
);
assert.ok(
  targetBindingIds.every(
    (bindingId) => staleReceiverFrame.__validity[bindingId] === 0,
  ),
  "receiver telemetry from another body tick retained authority",
);
assert.equal(captureWithBodyTick(allocatorController.id, 0).__snapshotTick, 0);
for (const invalidTick of [-1, 0.5, undefined])
  assert.equal(
    Object.hasOwn(
      captureWithBodyTick(allocatorController.id, invalidTick),
      "__snapshotTick",
    ),
    false,
  );
assert.equal(observed(result.observed, diagnosticOutputBindingIds.accepted), 1);
assert.equal(
  observedValid(result.observed, diagnosticOutputBindingIds.accepted),
  1,
);
for (const contactId of contactIds)
  assert.ok(
    Math.abs(
      observed(result.observed, forceOutputBindingIds.get(contactId)[1]) - 50,
    ) <= 1e-6,
  );

missingContactId = "alpha";
result = advanceAllocation();
assert.equal(
  observed(result.observed, diagnosticOutputBindingIds.authorityValid),
  0,
);
assert.equal(
  observed(result.observed, diagnosticOutputBindingIds.rejectionCode),
  1,
);
for (const bindingId of contactIds.flatMap((contactId) =>
  forceOutputBindingIds.get(contactId),
))
  assert.equal(observed(result.observed, bindingId), 0);

missingContactId = null;
result = advanceAllocation();
assert.equal(
  observed(result.observed, diagnosticOutputBindingIds.accepted),
  1,
  "contact recovery required sequence state or a controller restart",
);

commandMode = "target-silent";
session.stepFixed();
result = advanceAllocation();
assert.ok(
  targetBindingIds.every(
    (bindingId) => result.frame.__validity[bindingId] === 0,
  ),
);
assert.equal(
  observed(result.observed, diagnosticOutputBindingIds.rejectionCode),
  1,
);
commandMode = "normal";
session.stepFixed();
result = advanceAllocation();
assert.equal(
  observed(result.observed, diagnosticOutputBindingIds.accepted),
  1,
  "target-source recovery required sequence state",
);

for (const mode of ["allocator-route-loss", "allocator-power-loss"]) {
  commandMode = mode;
  session.stepFixed();
  let unavailable = capture(consumerController.id);
  for (const bindingId of outputBindingIds) {
    assert.equal(observed(unavailable, bindingId), 0);
    assert.equal(
      observedValid(unavailable, bindingId),
      0,
      `${mode} was laundered into valid zero demand`,
    );
  }
  const rejections = session
    .telemetry()
    .systems.commands.rejections.filter((entry) =>
      outputBindingIds.includes(entry.bindingId),
    );
  assert.equal(rejections.length, outputBindingIds.length);
  assert.ok(
    rejections.every((entry) =>
      mode === "allocator-route-loss"
        ? entry.reason === "binding has no powered directed signal route"
        : entry.reason === "controller has no allocated power",
    ),
  );
  commandMode = "normal";
  session.stepFixed();
  unavailable = capture(consumerController.id);
  for (const bindingId of outputBindingIds)
    assert.equal(
      observedValid(unavailable, bindingId),
      1,
      `${mode} did not recover through the ordinary receiver path`,
    );
}

let lifecycleCompilePowered = true;
const lifecycleNotifications = [],
  lifecycleStatusTransitions = [];
const lifecycleStatus = {
    textContent: "",
    value: allocatorSource,
    classList: {
      toggle: (_name, online) => lifecycleStatusTransitions.push(online),
      remove() {},
    },
  },
  lifecycleWorkspace = {
    parts,
    connections,
    selected: allocatorController.id,
    scriptControllerId: allocatorController.id,
    scriptLanguage: "typescript",
    scriptSources: { wat: "", typescript: allocatorSource, visual: {} },
  },
  lifecycle = createControllerLifecycleFeature({
    workspace: lifecycleWorkspace,
    channels: ["command"],
    defaultSources: () => ({ wat: "", typescript: "", visual: {} }),
    traceBuffer: new ControllerTraceBuffer(),
    sensorBank: new ControllerSensorBank(),
    power: { isPowered: () => lifecycleCompilePowered },
    trust: {
      current: () => ({
        refresh: async () => ({ allowed: true }),
        render() {},
      }),
    },
    telemetry: { time: () => 0, conflicts: () => [] },
    environment: { sampleWind: () => ({ x: 0, y: 0, z: 0 }) },
    view: {
      query: () => lifecycleStatus,
      queryAll: () => [],
      workbench: () => null,
      refreshDebug() {},
      pauseForBreakpoint() {},
      notify: (message) => lifecycleNotifications.push(message),
    },
  });
assert.deepEqual(
  lifecycle.normalizeCommands([["force", 500_000]]),
  { force: 500_000 },
  "lifecycle introduced an undeclared force clamp",
);
assert.deepEqual(
  lifecycle.normalizeCommands([
    ["", 1],
    ["invalid", Number.NaN],
  ]),
  {},
  "lifecycle accepted an unnamed or non-finite command",
);
await lifecycle.compile(allocatorController);
assert.equal(
  lifecycle.runtimeManager.ready(allocatorController.id),
  true,
  `a powered compile did not install the requested executable: ${JSON.stringify(
    lifecycle.runtimeReadModel.get(allocatorController.id),
  )}`,
);
lifecycle.runtimeManager.disposeAll();
lifecycle.runtimeManager.attach(
  allocatorController.id,
  preparedAllocator,
  "WRENCH ALLOCATOR",
);
assert.equal(lifecycle.runtimeManager.ready(allocatorController.id), true);
assert.equal(lifecycle.runtimeManager.suspend("missing-controller"), false);
lifecycleCompilePowered = false;
const transitionCountBeforePowerLoss = lifecycleStatusTransitions.length,
  notificationCountBeforePowerLoss = lifecycleNotifications.length;
await lifecycle.compile(allocatorController);
assert.equal(
  lifecycleStatusTransitions.length,
  transitionCountBeforePowerLoss + 1,
  "compile-time power loss published duplicate or missing status evidence",
);
assert.equal(lifecycleStatusTransitions.at(-1), false);
assert.deepEqual(
  lifecycleNotifications.slice(notificationCountBeforePowerLoss),
  ["Logic Controller needs a charged power connection"],
);
assert.ok(
  lifecycle.runtimeManager.ids().includes(allocatorController.id),
  "compile-time power loss disposed the attached executable",
);
assert.equal(lifecycle.runtimeManager.ready(allocatorController.id), false);
assert.deepEqual(
  lifecycle.runtimeManager.commands(allocatorController.id),
  new Map(),
);
const notificationCountBeforeInactiveCompile = lifecycleNotifications.length;
await lifecycle.compile(offlineController);
assert.equal(
  lifecycleNotifications.length,
  notificationCountBeforeInactiveCompile,
  "an inactive controller's power loss changed the active editor UI",
);
assert.equal(
  lifecycle.runtimeReadModel.get(offlineController.id).ready,
  false,
  "an uncompiled controller without power was reported executable",
);
lifecycleCompilePowered = true;
const lifecycleFrame = capture(allocatorController.id),
  lifecycleControllerFrames = controllerSensorFrameRecord([
    [allocatorController.id, lifecycleFrame],
  ]);
lifecycle.tick(1 / 120, {
  poweredControllerIds: [allocatorController.id],
  controllers: lifecycleControllerFrames,
});
assert.equal(
  lifecycle.runtimeManager
    .commands(allocatorController.id)
    .get(diagnosticOutputBindingIds.accepted),
  1,
);
const lifecycleTickBeforePowerLoss = lifecycle.runtimeManager.status(
  allocatorController.id,
).tick;
const invalidPoweredControllerEvidence = [
  undefined,
  null,
  String(allocatorController.id),
  [allocatorController.id, null],
  [allocatorController.id, allocatorController.id],
  [""],
  [Number.MAX_SAFE_INTEGER + 1],
];
lifecycle.tick(1 / 120, {
  poweredControllerIds: [],
  controllers: lifecycleControllerFrames,
});
assert.ok(lifecycle.runtimeManager.ids().includes(allocatorController.id));
assert.equal(lifecycle.runtimeManager.ready(allocatorController.id), false);
assert.equal(
  lifecycle.runtimeReadModel.get(allocatorController.id).ready,
  false,
);
assert.equal(
  lifecycle.runtimeManager.suspend(
    allocatorController.id,
    "OFFLINE: CONTROLLER LOST POWER",
  ),
  true,
);
assert.deepEqual(
  lifecycle.runtimeManager.commands(allocatorController.id),
  new Map(),
);
assert.equal(
  lifecycle.runtimeManager.status(allocatorController.id).tick,
  lifecycleTickBeforePowerLoss,
  "suspended controller advanced without power",
);
for (const invalidPowerEvidence of invalidPoweredControllerEvidence) {
  lifecycle.tick(1 / 120, {
    poweredControllerIds: invalidPowerEvidence,
    controllers: lifecycleControllerFrames,
  });
  assert.equal(
    lifecycle.runtimeManager.ready(allocatorController.id),
    false,
    "live lifecycle treated invalid power evidence as authority",
  );
  assert.deepEqual(
    lifecycle.runtimeManager.commands(allocatorController.id),
    new Map(),
    "live lifecycle published commands from invalid power evidence",
  );
  assert.equal(
    lifecycle.runtimeManager.status(allocatorController.id).tick,
    lifecycleTickBeforePowerLoss,
    "live lifecycle advanced from invalid power evidence",
  );
}
const suspendedCheckpoint = lifecycle.runtimeManager.exportState(),
  suspensionStatusEvents = [],
  suspendedRestore = new ControllerRuntimeManager({
    onStatus: (controllerId, status, ready) =>
      suspensionStatusEvents.push({ controllerId, status, ready }),
  });
suspendedRestore.attach(
  allocatorController.id,
  preparedAllocator,
  "WRENCH ALLOCATOR",
);
suspendedRestore.importState(suspendedCheckpoint);
assert.equal(suspendedRestore.ready(allocatorController.id), false);
assert.deepEqual(suspensionStatusEvents.at(-1), {
  controllerId: allocatorController.id,
  status: "OFFLINE: CONTROLLER LOST POWER",
  ready: false,
});
assert.equal(
  suspendedRestore.tick(allocatorController.id, 1 / 120, lifecycleFrame),
  true,
  "checkpointed suspension could not recover from current evidence",
);
assert.equal(suspendedRestore.ready(allocatorController.id), true);
suspendedRestore.disposeAll();

const trapAfterSuspensionManager = new ControllerRuntimeManager(),
  trapAfterSuspensionPrepared = Object.freeze({
    ...preparedAllocator,
    instantiate() {
      const engine = preparedAllocator.instantiate();
      return Object.freeze({
        ...engine,
        tick() {
          throw new Error("suspended recovery trap");
        },
      });
    },
  });
trapAfterSuspensionManager.attach(
  allocatorController.id,
  trapAfterSuspensionPrepared,
  "TRAP AFTER SUSPENSION",
);
assert.equal(trapAfterSuspensionManager.suspend(allocatorController.id), true);
assert.equal(
  trapAfterSuspensionManager.tick(
    allocatorController.id,
    1 / 120,
    lifecycleFrame,
  ),
  false,
);
assert.equal(
  trapAfterSuspensionManager.exportState()[0].suspended,
  false,
  "a trapped recovery remained misclassified as suspended",
);
trapAfterSuspensionManager.disposeAll();
lifecycle.tick(1 / 120, {
  poweredControllerIds: [allocatorController.id],
  controllers: lifecycleControllerFrames,
});
assert.equal(lifecycle.runtimeManager.ready(allocatorController.id), true);
assert.equal(
  lifecycle.runtimeReadModel.get(allocatorController.id).ready,
  true,
);
assert.equal(
  lifecycle.runtimeManager
    .commands(allocatorController.id)
    .get(diagnosticOutputBindingIds.accepted),
  1,
  "ordinary lifecycle power restoration required recompilation",
);
lifecycle.runtimeManager.disposeAll();

const replayRuntimeManager = new ControllerRuntimeManager();
replayRuntimeManager.attach(
  allocatorController.id,
  preparedAllocator,
  "REPLAY WRENCH ALLOCATOR",
);
advanceFailureEvidenceReplayControllers(replayRuntimeManager, 1 / 120, {
  poweredControllerIds: [allocatorController.id],
  controllers: lifecycleControllerFrames,
});
assert.equal(replayRuntimeManager.ready(allocatorController.id), true);
assert.equal(
  replayRuntimeManager
    .commands(allocatorController.id)
    .get(diagnosticOutputBindingIds.accepted),
  1,
  "failure-evidence replay discarded current controller sensor evidence",
);
const replayTickBeforePowerLoss = replayRuntimeManager.status(
  allocatorController.id,
).tick;
advanceFailureEvidenceReplayControllers(replayRuntimeManager, 1 / 120, {
  poweredControllerIds: [],
  controllers: lifecycleControllerFrames,
});
assert.ok(
  replayRuntimeManager.ids().includes(allocatorController.id),
  "failure-evidence replay destroyed a controller on power loss",
);
assert.equal(replayRuntimeManager.ready(allocatorController.id), false);
assert.deepEqual(
  replayRuntimeManager.commands(allocatorController.id),
  new Map(),
  "failure-evidence replay retained commands through power loss",
);
assert.equal(
  replayRuntimeManager.status(allocatorController.id).tick,
  replayTickBeforePowerLoss,
  "failure-evidence replay advanced a controller without power",
);
for (const invalidPowerEvidence of invalidPoweredControllerEvidence) {
  advanceFailureEvidenceReplayControllers(replayRuntimeManager, 1 / 120, {
    poweredControllerIds: invalidPowerEvidence,
    controllers: lifecycleControllerFrames,
  });
  assert.equal(
    replayRuntimeManager.ready(allocatorController.id),
    false,
    "failure-evidence replay treated invalid power evidence as authority",
  );
  assert.deepEqual(
    replayRuntimeManager.commands(allocatorController.id),
    new Map(),
    "failure-evidence replay published commands from invalid power evidence",
  );
  assert.equal(
    replayRuntimeManager.status(allocatorController.id).tick,
    replayTickBeforePowerLoss,
    "failure-evidence replay advanced from invalid power evidence",
  );
}
advanceFailureEvidenceReplayControllers(replayRuntimeManager, 1 / 120, {
  poweredControllerIds: [allocatorController.id],
  controllers: lifecycleControllerFrames,
});
assert.equal(
  replayRuntimeManager.ready(allocatorController.id),
  true,
  "failure-evidence replay required controller recreation after power restoration",
);
assert.equal(
  replayRuntimeManager.status(allocatorController.id).tick,
  replayTickBeforePowerLoss + 1,
  "failure-evidence replay did not resume the retained controller",
);
assert.equal(
  replayRuntimeManager
    .commands(allocatorController.id)
    .get(diagnosticOutputBindingIds.accepted),
  1,
  "failure-evidence replay resumed without current controller sensor evidence",
);
replayRuntimeManager.disposeAll();

const checkpoint = runtimeManager.exportState(),
  restoredReadModel = new ControllerRuntimeReadModel(),
  restoredManager = new ControllerRuntimeManager({
    onStatus: (controllerId, status, ready) =>
      restoredReadModel.setStatus(controllerId, status, ready),
    onCommands: (controllerId, outputs) =>
      restoredReadModel.setCommands(controllerId, outputs),
  });
restoredManager.attach(sourceController.id, preparedSource, "TARGET SOURCE");
restoredManager.attach(
  allocatorController.id,
  preparedAllocator,
  "WRENCH ALLOCATOR",
);
const allocatorCheckpoint = checkpoint.find(
  (record) => record.controllerId === allocatorController.id,
);
assert.equal(
  allocatorCheckpoint.policyVersion,
  preparedAllocator.policyVersion,
);
assert.equal(
  allocatorCheckpoint.hostAbiIdentity,
  preparedAllocator.hostAbiIdentity,
);
for (const [field, value] of [
  ["policyVersion", `${preparedAllocator.policyVersion}-forged`],
  ["hostAbiIdentity", `${preparedAllocator.hostAbiIdentity}-forged`],
]) {
  const mismatchedCheckpoint = structuredClone(checkpoint);
  mismatchedCheckpoint.find(
    (record) => record.controllerId === allocatorController.id,
  )[field] = value;
  assert.throws(
    () => restoredManager.validateState(JSON.stringify(mismatchedCheckpoint)),
    /identity mismatch/,
    `${field} was absent from checkpoint identity`,
  );
}
restoredManager.importState(checkpoint);
assert.equal(
  restoredManager.tick(
    allocatorController.id,
    1 / 120,
    capture(allocatorController.id),
  ),
  true,
);
assert.equal(
  restoredManager
    .commands(allocatorController.id)
    .get(diagnosticOutputBindingIds.accepted),
  1,
  "checkpoint restart did not recompute from current physical evidence",
);

session.dispose();
runtimeManager.disposeAll();
restoredManager.disposeAll();
assert.equal(
  consumerManifest.filter((binding) => binding.direction === "input").length,
  outputBindingIds.length,
);
console.log(
  "point-contact wrench controller relay passed (ordinary sensor inputs, target receivers, route/power/contact loss, checkpoint recovery)",
);
