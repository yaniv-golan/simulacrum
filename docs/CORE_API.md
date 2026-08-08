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

## Minimal runnable session

After building Core, save this example as `quick-start.mjs` in the repository
root and run `node quick-start.mjs`:

```js
import {
  AssemblyModel,
  SensorSystem,
  SimulationSession,
  TelemetrySystem,
} from "@yaniv-golan/simulacrum-core";

const assembly = AssemblyModel.fromBlueprint({
  format: "simulacrum-blueprint",
  version: 1,
  name: "Empty machine",
  created: new Date().toISOString(),
  parts: [],
  connections: [],
  remoteProfiles: {},
  defaultRemoteProfile: null,
});

const session = new SimulationSession({
  systems: [new SensorSystem(), new TelemetrySystem()],
});

session.start(assembly.snapshot());
session.stepFixed(); // exactly one 1/120-second phase-ordered tick
console.log(session.telemetry());
session.dispose();
```

This intentionally starts with an empty valid blueprint so the required public
inputs are visible and the example needs no host-owned physics services. For
complete component, system, controller, sensor, challenge, and telemetry
integrations, run `npm run examples:core` and follow the
[executable extension guide](core-extensions.md). Those examples provide the
host services required by each advanced subsystem instead of relying on
undeclared placeholder variables.

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
the next integration tick. Allocation v2 permits exactly one atomic commit per
network and fixed tick, persists its sequence and last committed tick, and
rejects duplicate or stale direct calls. Checkpoint v2 restores that complete
transaction. The 20-owner integrity cutover uses owner version 2 for every
owner except `flexible-line-runtime` and `release-couplers`, whose existing
exact projections remain version 1. Restore purely validates every owner first,
reconstructs target mass, COM, and inertia from the target material, pneumatic,
and aerothermal payloads, and only then starts the rollback-protected
owner-first commit.

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

`PowerNetwork`, `SignalNetwork`, and `MaterialResourceNetwork` retain bounded,
immutable route indexes during their authoritative resolve/allocation work.
Call `evidenceIndex()` to obtain the result digest, then pass that digest with a
version-1 query to `routeWitness()`. A witness proves endpoint reachability;
power paths do not claim which edge carried watts, and resource paths report an
authoritative debit separately from the non-flow route. Live callers use
`SimulationSession.routeEvidence(token, query, expectedIdentity)` with the
opaque token and exact identity from completed telemetry. Tokens are
session-local capabilities and are stripped from checkpoints and portable
playback.

Electric rotary drives reserve their current power allocation on the motor
constraint row before the one Cannon solve. `MotorEnergySettlementSystem`
then debits the exact positive row work once, after integration, and publishes
electrical work, mechanical work, absorbed work, conversion loss, and rejected
heat. Fixed-pitch `rotor` components are ordinary one-port shaft loads:
`rotorAerodynamicPerformance()` derives thrust and opposing torque from shaft
speed, atmosphere, inflow, authored geometry, handedness, and a closed profile
registry. `RotorPropulsionSystem` applies those forces before integration;
there is no demo or vehicle-mode dispatch.

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
compatible ports. Rotor v1 configuration requires identity scale, positive
hub/blade dimensions, two through eight blades, fixed pitch from 2° through
35°, handedness `-1` or `1`, a known profile, and rated speed no greater than
maximum speed. Workspace v1 is a separate local document; selection, active
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
diagnostics. Public Core callers pass serialized JSON for both inputs;
arbitrary objects and Proxies are rejected without invoking any input trap.
Package-owned call sites use a separate, non-Core entrypoint for immutable
roots issued by live model owners. External callers serialize snapshots and
catalogs, including the exported `TYPES` catalog. Its
`rigidClusters` projection groups fixed-connected bodies by
authored transforms, composes their mass properties in a common frame, and
publishes unique child-subtree cuts only for tree topology. Redundant rigid
loops carry complete fixed-edge topology, are explicitly statically
indeterminate, and publish no invented cut. Mixed numeric/string authored IDs
retain distinct compiled and connection-telemetry identities. Mass composition
rejects nonpositive member mass and nonphysical inertia tensors using
magnitude-normalized physical tests; nested member provenance includes any
authored endpoint point masses. Principal-axis decomposition normalizes the
tensor before solving, so valid rotated tensors remain self-consistent at tiny
positive scales. The pure cut-wrench oracle requires an exact connected `N - 1`
tree, real endpoint ownership, and exact member, edge, and recomposed
authored-frame authority before returning an available result. The compiler
recursively freezes its result, and the oracle accepts the live compiler-owned
cluster descriptor plus current root pose; detached or reconstructed cluster
records fail closed. Compiler provenance can be observed by the oracle but can
be minted only inside `compileAssembly()`; recursively freezing a clone does
not confer authority. It derives cut points from authored child frames, so
arbitrary caller-supplied world cut positions are not an input. Two-ended
release sources are ordered by physical A/B endpoint, and each
attachment frame independently binds its source connection. The validator
re-derives descriptor identity, root-frame anchoring, source mass, and aggregate
mass properties from member records before resolving topology. Fixed-edge
capacities, outgoing endpoint records, and per-member runtime-mass capability
kinds rederive the fixed, failure, boundary, and dynamic-mass summary sets.
Nested endpoint point-mass records identify the source part/port/connection,
target part/port, and owner of their part-frame position; compilation verifies
that complete relationship against the active connection and independently
re-derives the target-side position before recomposition.
Descriptor membership must equal the supplied member-state set even for a
singleton; singleton root poses remain mandatory, and compiled cuts and emitted
frames use the same total numeric-aware ordering. Frame/world emission,
aggregate COM/volume, and Newton-Euler force/torque/magnitude calculations
reject non-finite results rather than publishing overflowed evidence.
Physics checkpoint import rejects missing, duplicate, forged, or extraneous
body and collision-exclusion IDs, requires the body set to match both the
compiler-owned topology and live body registry, rejects activity flags that
disagree with the restored active constraints, and the coordinator
cross-checks the solver-contact owner against the physics owner. Direct
`MultibodyRuntime.importState()` first validates a closed detached candidate,
including finite/positive mass and inertia, unit frames, reciprocal inverse
values, and collision frames re-derived from compiled geometry plus target mass
authority; immutable endpoint point-mass provenance must still match the
compiled topology. Material, pneumatic, and ablative owners reconstruct
dynamic mass first, after which direct physics and body-registry state must
match that projection exactly. The legacy public
`MultibodyRuntime.commitMassProperties()` and
`BodyRegistry.setMassProperties()` methods fail closed; only the
package-internal coordinated owner transaction can mutate live mass. It first
detaches one recursively plain, accessor-free finite data graph, validates
exact compiled contributor order and finite mass/inertia reciprocals, and then
applies the complete batch. If any engine operation fails after mutation starts,
the runtime restores the prior poses, velocities, torque, mass/inertia,
collision frames and caches, solver-mass caches, and fixed-constraint frames.
Runtime start uses the same finite reciprocal projection for every compiled body
before adding the first body to the engine world. Engine installation is one
transaction: injected body, constraint, rolling-support, or collision-exclusion
failure disposes every object installed by that attempt while preserving other
world owners, and a running runtime rejects restart before mutation. Live
checkpoint capture also authenticates Cannon body/shape geometry and material,
filter/damping/type policy, constraint frames and stable equation
identity/body/enabled/SPOOK/restitution/force-bound authority, world
membership, and collision-exclusion identity/activity against private compiled
authority. `CannonWorldAdapter` separately owns the live fixed-step solver
profile: fixed step, iteration budget, and tolerance are checkpointed;
integration and capture reject out-of-band changes, and import reinstates the
attested values. Run identity requires and hashes this effective adapter
projection rather than importing a parallel constant. Initialization, every fixed
tick, and checkpoint reconstruction require each mutable owner to expose the
exact compiled typed-ID sequence: missing, duplicate, extraneous, reordered, or
wrong-kind records fail closed. The material-resource owner uses the same total
ordering, while the aerothermal mass port includes only compiled ablative mass
authority. Remaining structural mass plus ablated mass must equal initial mass,
and an accepted target cannot fall below the positive residual required while
its finite-inertia body exists; projection rejects invalid mass rather than
clamping it upward. Checkpoint capture runs the complete multibody validator over live
scalar mass/inertia, reciprocals, frames, shapes, constraints, and metadata, then
independently rejects any registry/physics mass disagreement before owner
payloads are digested. Fixed solver frames, the complete per-kind
constraint scalar set, nested tire-state element schemas, physical load
connection identities, and owner field sets are closed before mutation.
Compiled mutable-mass capability kinds require their material, pneumatic, or
ablative owner plus the mass-property transaction owner; absent owners accept
only their canonical sentinel payload. Rejected input never reaches live
Cannon objects, and an
accepted restore preserves the relative solver order of constraints owned by
other runtimes. Compiler output fixes every runtime-consumed entity collection
to one total authority order; solver constraints use canonical authored source
identity within an explicit compiler-authored class:
`condensed-connector-v1` precedes `direct-connection-v1`. Provenance count does
not select numerical policy. Direct compilation rejects duplicate part or
connection identities before any last-wins map exists, so order-equivalent
authored arrays have bit-exact checkpoint continuation.
Every executable checkpoint validator accepts only serialized JSON or a deeply
frozen state root issued by the corresponding exporter/parser. An arbitrary
object, accessor graph, or Proxy is rejected by unforgeable identity before
property, prototype, key, or descriptor inspection. Committed time is not a
tolerance-based second owner: session time, session clock time, and Cannon
world time must equal `committedTick * fixedDt` exactly.
`RuntimeCheckpointCoordinator.capture()` and `restore()` apply that same rule
to the exact three-field runtime-identity projection. Session accumulators and
body/world counters must be reachable non-negative fixed-step states rather
than merely finite numbers. `solver-contact` and `tire-carcass` are closed
cross-owner projections of physics identity. `energy-power-signal` stores only
its graph revision and motor-settlement mutable state; power and signal read
models are reconstructed from the restored run graph.
`BodyRegistry` rejects duplicate constructor identities before insertion, and
`BodyRegistry.importState()` likewise rejects duplicate or
contradictory body/constraint bindings, including each body's exact physical
constraint linkage and load provenance outside the constructor-owned connection
set. It completes all nested validation and freezing before one atomic owner-map
swap, and validates its content-derived revision against the complete candidate.
Checkpoint-specific registry validation/import is package-internal; coordinated
rewind or rollback therefore reconstructs the exact observable revision from
owned content rather than carrying live mutation history forward. Run identity
and the three
compiled-physical checkpoint owners bind the canonical complete compiled
physical semantics—including canonical runtime execution order—rather than
only entity IDs. Command arbitration and external input-trace checkpoint/wire/
playback preserve injective typed identity, so a numeric part ID and its exact
string form remain independent authorities. The legacy `articulated-drive`
checkpoint owner is a fixed null tombstone; no controller state can enter it.
Input-trace wire version 2 preserves those primitive ID types; version 1 is
rejected because its string coercion cannot be inverted without guessing.

`reconstructTreeCutWrenches(clusterDescriptor, input)` is a conditional
Newton-Euler diagnostic. The first argument must be the live compiler-owned
descriptor; public `input` must be serialized JSON containing the root pose,
member kinematics, explicit gravity vector, and explicit, uniquely identified
load set. `rigidClusterCutFramesWorld()` has the same serialized-JSON rule for
its public root pose. Package-owned call sites may use immutable roots issued by
the internal plain-data boundary, which is intentionally absent from the public
declaration. Each load names its application point and free couple. The result records
the complete canonical gravity/load values—not only load IDs—as
`conditional-supplied-load-set-v1` and always
sets `failureAuthority: false`, because a caller-supplied list cannot prove that
an external load was not omitted. Structural failure may consume only a future
runtime-owned complete load ledger, not this conditional oracle.
`MultibodyRuntime` is the current Cannon adapter for that output. This
separation allows other solvers, headless tools, and renderers to reuse the same
physical topology. Each compiled collision primitive carries an authored
`materialKey`; the runtime's `materialForKey` port projects that physical
identity to the engine shape. Contact behavior is resolved from the symmetric
authored material-pair table. Part names, demo identity, and presentation
`rigRole` metadata are not material or contact-law inputs. See
[General multi-body assembly compiler](ASSEMBLY_COMPILER.md) for the strict
connection and capacity contract.

For any compiled powered rotary coordinate, `joint_target` is a normalized
command into the authored position-impedance law. `MultibodyRuntime` maps it
through `commandRangeRad` and applies the authored stiffness, damping, maximum
speed, torque, electrical motoring-power/efficiency, idle draw, and thermal
limits. The Cannon motor row is capped before solving by available torque and
an electrical-source-backed mechanical-work budget; post-solve settlement
debits only measured positive work, deposits unsupported regeneration as heat,
and preserves `electricalEnergyJ = mechanicalWorkJ + dissipatedEnergyJ` within
the checkpoint tolerance. The actuator's winding state owns that heat, so the
same joules are not also deposited into the assembly thermal owner. Names,
`rigRole`, demo identity, and command history do not select this law.

Component geometry has one DOM-free authority. Every catalog entry supplies a
strict data-only `geometryContract`; `geometryDescriptorForPart()` resolves it
to immutable `GeometryDescriptorV2` using the authored part transform and
scale. Direct compilation requires serialized JSON or package-issued immutable
roots for both the assembly snapshot and supplied catalog before resolution;
arbitrary objects fail closed without structural inspection, and later phases
never reread caller-owned catalog state. The
descriptor separately names collision, body, feature, selection,
and overall physical bounds, classifies every port, and contains frames only
for spatial mechanical/resource ports plus optional presentation terminals for
network-only ports. Physical-axis inference explicitly ignores network-only
terminal frames. Physical features are anchored to the remaining canonical
frames, so a host renderer cannot independently place a shaft or attachment
surface.

`validateComponentGeometryDefinitionOrThrow()` and
`validateGeometryDescriptorOrThrow()` reject unknown fields, primitive kinds,
missing frames, invalid quaternions, and inconsistent bounds. Alternate
catalogs have no fallback geometry. Compiled spatial connections also fail with
stable diagnostics when their authored endpoint frames violate the applicable
fixed, rotary, guide, gear, or flexible-line invariant. Descriptor v2 is a
public API contract in Core `0.2.0`, but it remains derived data and does not
change any portable wire envelope. Its closed body primitive union includes
rounded boxes, spur gears, helical springs, bounded extruded profiles, rounded
wheels, and the basic analytic solids. Mechanism deformation is driven only by
completed `coordinateId`/`coordinateM` samples through
`mechanismDeformationTransforms()`; pose-owned visual scale fields are not part
of the contract. A finite completed coordinate is clamped to its authored
`allowedCoordinateRangeM` for body projection. Physical telemetry retains the
raw coordinate and its out-of-range diagnostic, while visual and selection
bounds cannot escape the declared mechanism envelope.

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
