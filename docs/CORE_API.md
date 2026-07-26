# Reusable core API

## Availability and workspace setup

`@yaniv-golan/simulacrum-core` is a separately versioned DOM-free workspace
package. It is not published to npm yet. Clone the Simulacrum repository and
build it from the source checkout:

```sh
npm ci
npm run core:build
```

The workspace resolves the package name to the same public facade used by the
game and by the package produced with `npm pack` before a future npm release.

## Assembly and simulation quick start

```js
import {
  AerodynamicSystem,
  AssemblyModel,
  analyzeAssembly,
  analyzeComponentPreflight,
  ChallengeRun,
  challengeReliability,
  compileAssembly,
  compileVisualProgram,
  controllerBindingManifest,
  ControllerSensorBank,
  ControllerTraceBuffer,
  ComponentRelationshipIndex,
  createSubassemblyTemplate,
  EnvironmentBodyRegistry,
  EnvironmentBodySystem,
  FlexibleLineRuntime,
  FlexibleLineStructureSystem,
  FlexibleLineSystem,
  FlexibleLineTelemetrySystem,
  FailureEvent,
  FailureRecorder,
  fingerprintComponentInspectionAssembly,
  instantiateSubassembly,
  MassPropertyCommitSystem,
  MechanismSystem,
  MobilityTelemetrySystem,
  MaterialResourceNetwork,
  MaterialResourceCommitSystem,
  MaterialResourceSystem,
  PneumaticCommitSystem,
  PneumaticNetwork,
  PneumaticSystem,
  MultibodyRuntime,
  PressureNozzleDemandSystem,
  PressureNozzleForceSystem,
  PhysicalAssemblyIndex,
  PhysicalFlightTelemetrySystem,
  ReleaseCouplerSystem,
  RigidBodySystem,
  SimulationSession,
  TestCourseSystem,
  TestSiteTelemetrySystem,
  ThermalSystem,
  PowerSystem,
  ReplayBuffer,
  decodeAuthoredAssemblyContentOrThrow,
  measureEnvironmentProximity,
  TYPES,
} from "@yaniv-golan/simulacrum-core";

const assembly = AssemblyModel.fromBlueprint(blueprint);
const authored = decodeAuthoredAssemblyContentOrThrow(assembly.snapshot());
const authoredFingerprint = await fingerprintComponentInspectionAssembly(
  assembly.snapshot(),
);
const relationships = new ComponentRelationshipIndex(authored);
const selectedPreflight = analyzeComponentPreflight(authored, {
  selectedPartIds: [authored.parts[0]?.id].filter(Number.isSafeInteger),
});
const reusable = createSubassemblyTemplate(assembly.snapshot(), selectedIds, {
  name: "Drive module",
  origin: [0, 0, 0],
});
const instance = instantiateSubassembly(reusable, {
  position: [4, 0, 0],
  nextId: 100,
});
const analysis = analyzeAssembly(assembly.snapshot(), TYPES);
const compiled = compileAssembly(assembly.snapshot(), TYPES);
const materials = new MaterialResourceNetwork(compiled);
const pneumatics = new PneumaticNetwork(compiled);
const mechanisms = new MultibodyRuntime({ world, material, catalog: TYPES });
mechanisms.start(assembly.snapshot());
const flexibleLines = new FlexibleLineRuntime({
  world,
  materialForKey,
  multibodyRuntime: mechanisms,
});
flexibleLines.start(compiled);
const nozzleDemand = new PressureNozzleDemandSystem();

const session = new SimulationSession({
  systems: [
    new PowerSystem(),
    new MaterialResourceSystem(),
    nozzleDemand,
    new ReleaseCouplerSystem(),
    new MechanismSystem(),
    new PneumaticSystem(),
    new FlexibleLineSystem(),
    new PressureNozzleForceSystem(),
    new RigidBodySystem(),
    new FlexibleLineStructureSystem(),
    new FlexibleLineTelemetrySystem(),
    new MaterialResourceCommitSystem(),
    new PneumaticCommitSystem(),
    new MassPropertyCommitSystem(),
  ],
});
session.start(assembly.snapshot(), {
  ...services,
  world,
  worldAdapter: mechanisms.worldAdapter,
  multibodyRuntime: mechanisms,
  flexibleLineRuntime: flexibleLines,
  compiledAssembly: compiled,
  pressureNozzleDemandSystem: nozzleDemand,
});
session.step(1 / 60);
session.stepFixed(); // exactly one 1/120-second phase-ordered tick
const telemetry = session.telemetry();
session.dispose();
flexibleLines.dispose();
mechanisms.dispose();
```

## Physical systems and resources

`flexible-line-v1` is the general distributed-line contract behind the stock
Rope. Compilation emits plural mass/contact entities, unilateral internal
edges, explicit two-end boundaries, and stable discretization identity without
a rigid proxy. `FlexibleLineRuntime` uses the host's Cannon world and ordinary
target bodies; `FlexibleLineSystem`, `FlexibleLineStructureSystem`, and
`FlexibleLineTelemetrySystem` preserve the single integration and completed
telemetry order. `BodyRegistry` and `PhysicalAssemblyIndex` support plural
ownership and split lineage. Checkpoint owner `flexible-line-runtime` restores
entity motion, edge/attachment state, dissipation, and topology exactly. See
[Rope](ROPE.md) and the executable
[`flexible-line.mjs`](../examples/core-extensions/flexible-line.mjs).

Material-resource ports require an exact non-empty `mediumId` match and
opposite-compatible directions. `MaterialResourceNetwork` owns finite store
state and follows live structural partitioning. Pressure-nozzle demand debits
only reachable same-medium stores; force is derived from the delivered flow,
nozzle exit state, ambient pressure, compiled axis, and application point. A
single post-thermal transaction commits material and ablative mass changes for
the next integration tick. Checkpoint v2 restores that complete transaction.

Compressible dry-air ports use the distinct `compressible-gas` behavior and
`dry-air-v1` medium. `PneumaticNetwork` owns each tire chamber's conserved gas
mass, internal energy, and volume; the fixed-step `PneumaticSystem` resolves
powered compressor and three-way-valve transactions before contact, while
`PneumaticCommitSystem` commits pressure-volume work and gas/carcass heat after
integration. The public pure helpers expose the same ideal-gas, chamber-volume,
pressure-support, and choked/subsonic-orifice laws used by production. Gas
state is checkpointed under `pneumatic-gas`, projected into completed mobility
telemetry and pressure-sensor readings, and included in the next-tick wheel
mass property. `MaterialResourceNetwork.allocate()` remains exclusively the
finite one-way store allocator.

Immutable `FailureEvent` records and source-addressed challenge criteria use
completed network and telemetry snapshots. The canonical
`PhysicalAssemblyIndex` and `MobilityTelemetrySystem` publish one record for
each physical component with authored rolling contact while retaining frame
identity, members, split lineage, contacts, solved tire forces, steering,
braking, power, fluid interaction, exact support-material identities and laws,
bounded soft-surface sinkage, rolling-resistance multipliers, and validity.
`TestSiteTelemetrySystem` projects canonical district, surface, terrain,
fluid, and zone state from completed physical poses. `TestCourseSystem`
evaluates ordinary completed telemetry against immutable route contracts; it
does not dispatch on demo identity, vehicle class, wheel count, or rotor count.
Commands stay addressed to exact endpoint parts. See
[Workshop Test Reserve](TEST_GROUND.md) for the host workflow and evidence
rules built around these two systems.

Powered `release-coupler` components compile two authored flange connections
into a load-rated latch and explicit actuator. The actuator consumes resolved
power and authored actuation energy, opens only declared routes, and adds no
hidden separation impulse. `AerodynamicSystem`, `ThermalSystem`, and
`PhysicalFlightTelemetrySystem` consume narrow host services in fixed-step
order without vehicle modes, launch latches, implicit stabilization, or mission
status. Checkpoint v2 stores mutable owner state and derives physical grouping,
forces, impacts, and read models after restore.

## Blueprint boundary

Blueprint input is the exact `simulacrum-blueprint` v1 contract. Parts contain
resolved behavior configuration, computers own their programs, batteries use
`config.capacityWh` plus `storedEnergyWh`, and every connection names explicit
compatible ports. Workspace v1 is a separate local document; selection, active
remote state, UI geometry, executable acquisition, and trust never enter a
portable blueprint. Unsupported formats are rejected rather than migrated.

## Controller tooling

Controller tooling is engine- and renderer-neutral as well:

```js
const snapshot = assembly.snapshot();
const controller = snapshot.parts.find((part) => part.id === controllerId);
const bindingManifest = controllerBindingManifest(
  controller,
  snapshot.parts,
  snapshot.connections,
);
const compiledProgram = compileVisualProgram(serializedGraph, bindingManifest);
const sensors = new ControllerSensorBank();
const traces = new ControllerTraceBuffer({ capacity: 360 });

const completed = session.telemetry();
const previousStepReadings = sensors.capture({
  parts: completed.run.parts,
  connections: completed.run.connections,
  bodies: completed.bodies,
  signals: completed.systems.signals,
  commandReceivers: completed.systems.commandReceivers,
});
traces.ingest({
  controllerId,
  tick,
  time,
  sensors: previousStepReadings[controllerId],
  commands,
});
```

Visual programs compile into typed control IR and the same synchronous,
fuel-metered WebAssembly tier as handwritten TypeScript. Bindings are strict,
controller-local names for one routed physical input or output endpoint; their
canonical manifest is part of executable identity. Sensor reads use the prior
completed step and trace storage is bounded; none of these contracts creates
DOM or Three.js objects. See
[Controller programming and debugging](CONTROLLER_PROGRAMMING.md).

## Environment bodies and sensing

Queryable world objects use the same strict, engine-neutral boundary:

```js
const environmentBodies = new EnvironmentBodyRegistry([
  {
    id: "environment:inspection-target",
    frame: "local-world-v1",
    geometry: { kind: "sphere-v1", radiusM: 2 },
    queryKinds: ["sensing"],
    pose: {
      positionM: [0, 50, 0],
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    velocityMps: [0, 0, 0],
  },
]);
const environmentSystem = new EnvironmentBodySystem();
```

`EnvironmentBodySystem` publishes completed immutable poses in the environment
phase. A compiled Range Sensor measures the nearest sphere surface intersecting
its finite conical beam, including range resolution, FOV, occlusion, relative
velocity, power, physical mounting, and directed signal routing. Controllers
read only the preceding completed snapshot; rendering may mirror registered
poses but never supplies target coordinates to simulation.

## Failure analysis and replay

Failure analysis is also engine- and renderer-neutral:

```js
const failures = new FailureRecorder({ catalog: TYPES });
const replay = new ReplayBuffer({ seconds: 12, sampleHz: 30 });

replay.record(telemetry);
const created = failures.ingest(telemetry);
if (created[0]) replay.pinFailure(created[0].timeS);

const report = failures.report();
const recordedFrame = replay.frame(0);
```

## Challenges

Open construction objectives use the same engine-neutral telemetry contract:

```js
const challenge = new ChallengeRun(contract, assembly.snapshot());
const result = challenge.step(session.telemetry(), 1 / 120);
const history = challengeReliability(attemptRecords, contract.id);
```

`ChallengeRun` classifies physical capabilities rather than stock machine names,
checks payload attachment and every declared criterion, and returns immutable
source-addressed criterion evidence plus a score breakdown without mutating the
assembly or simulation. Strict reference-control setup names existing
profile/control IDs; live power and signal availability remains a completed
telemetry criterion. `challengeReliability()`
summarizes attempts, completions, distinct solution classes, and best score. See
[Open construction challenges](CHALLENGE_LAB.md).

`FailureRecorder` records the first physical failure as the root cause, retains
peak witnessed load and rated capacity, and appends later detachment evidence to
the causal chain. `ingest()` and `report()` expose immutable `FailureEvent`
instances with channel, unit, frame, tick, validity, and provenance. Unknown
physical event kinds fail closed. `ReplayBuffer` stores immutable telemetry in
a fixed-capacity ring. It is a read model only and cannot advance or mutate a
simulation. See
[Failure analysis, exact stepping, and replay](FAILURE_ANALYSIS.md).

## Assembly compilation

`compileAssembly()` is deterministic and engine-neutral: it resolves blueprint
parts and port-to-port connections into bodies, constraints, networks, and
diagnostics. `MultibodyRuntime` is the current Cannon adapter for that output.
This separation allows other solvers, headless tools, and renderers to reuse the
same physical topology. See [General multi-body assembly compiler](ASSEMBLY_COMPILER.md)
for the strict connection and capacity contract.

## Reusable assemblies and engineering analysis

`createSubassemblyTemplate()` extracts one connected selection into a versioned,
ID-independent mini-blueprint. `instantiateSubassembly()` returns fresh part IDs,
fresh connection IDs, and the next available ID without mutating the source.
`analyzeAssembly()` derives center of mass, material-displacement center of
buoyancy, nominal component thrust, and oriented-box interference without a
renderer or physics engine. See [Reusable assemblies and engineering editor](EDITOR_TOOLS.md).

## Portable sharing

Portable design sharing is content-addressed and renderer-neutral:

```js
const shared = await createSharePackage({
  kind: "blueprint",
  asset: blueprint,
  metadata: { title: "Cargo Scout", tags: ["rover", "cargo"] },
});
const received = await decodeSharePackage(JSON.parse(packageText));
if (!received.ok) throw new Error(received.errors[0].message);
const library = new ShareLibrary({ packages: [received.item] });

library.favorite(received.item.fingerprint, true);
library.rate(received.item.fingerprint, 4); // local social state, not package data
```

`createSharePackage()` validates the current asset, derives dependencies and an
asynchronous SHA-256 fingerprint, and preserves valid remix and exact-machine
challenge attribution. `decodeSharePackage()` is a total strict import boundary:
package failures are errors, while unusable optional proofs are omitted with
pathful warnings.
`ShareLibrary` keeps immutable packages separate from per-browser favorites,
ratings, and import origins. Browser file, link, thumbnail, and clipboard
transports intentionally remain outside the core. See
[Blueprint Exchange](BLUEPRINT_SHARING.md).

## Compatibility and release policy

Stable contracts cover assemblies, blueprint normalization, bounded history,
fixed-step systems, command arbitration, immutable telemetry, atmosphere
models, independent controller runtimes, and compiled multi-body topology. The
core never creates DOM, meshes, cameras, CSS, or panels.

The package ships generated declarations and is checked against the committed
API Extractor report before release. See [core extension examples](core-extensions.md)
for executable component, port, system, sensor, challenge, controller, and
telemetry integrations. Public compatibility follows the package's
`SEMVER.md`; every intentional API change also updates its changelog.
