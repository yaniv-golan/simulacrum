# Architecture

## Layer boundaries

Simulacrum is a vanilla ES-module application with explicit dependency
direction. The browser entry point only starts the application; reusable
contracts are exported through the separately versioned
`@yaniv-golan/simulacrum-core` package. The game resolves that package to the
same source facade used to build the packed, publishable artifact, so it cannot
develop a private substitute API. The package is currently consumed from the
source workspace and has not yet been published to npm.

| Layer          | Owns                                                         | May depend on                |
| -------------- | ------------------------------------------------------------ | ---------------------------- |
| `model`        | assemblies, subassemblies, analysis, catalog, ports, history | model                        |
| `simulation`   | fixed-step systems, physical runtimes, telemetry             | model, simulation            |
| `scripting`    | isolated controller execution and compilation                | model contracts, scripting   |
| `presentation` | Three.js, camera, DOM panels, interaction                    | model, presentation          |
| `application`  | construction, workflows, event wiring                        | every layer                  |
| `core`         | stable DOM-free reuse facade                                 | model, simulation, scripting |

## Fixed-step runtime and boundary policy

Every run uses one 1/120-second `SimulationSession`: sensors → controllers →
networks → actuators → environment → integration → structures → thermal →
telemetry. Controllers read the previous completed sensor snapshot.
Presentation reads immutable telemetry and maps part IDs to Three.js objects.
The packed core includes generated declarations; API Extractor compares its
public report, and clean Node/browser installs run in CI.

Runtime measurements use the model-owned `finiteOr()` fallback policy so
telemetry, challenge, failure, sensor, and sandboxed-controller projections
remain total without weakening strict authored-data validation. Portable and
share boundaries call `structuredClone()` directly. The remaining named clone
helpers express real policy: null-preserving browser storage or detachment into
the compiled-assembly ownership domain.

## Resources and mass ownership

Power, signal, and material resources are separate compiled graphs.
`MaterialResourceNetwork` is the sole mutable owner of finite store quantity
and resource topology. It follows live structural revisions and reprojects
partitioning in the same completed tick; checkpoint v1 persists it under the
dedicated `material-resources` owner. Pressure-nozzle systems turn ordinary
endpoint commands into mass-flow requests, proportionally allocate and debit
reachable same-medium stores, and apply only force backed by that tick's
allocation identity. Thermal and material changes contribute to one
post-thermal mass-property transaction; the current tick integrates with its
starting mass and the committed result becomes authoritative on the next tick.

## Physical identity and flight

Physical grouping has one derived authority: `PhysicalAssemblyIndex`. It
reconstructs connected physical components from compiled rigid bodies,
flexible-line entities and internal edges, live constraints, and structural
events; it is never checkpointed as mutable state. `BodyRegistry` owns the
corresponding one-part-to-many-physical-entities mapping. An internal Rope
break may place entities from one authored part into multiple derived
components without creating a second Rope registry or changing source-part
identity.
`MobilityTelemetrySystem` selects every indexed component that contains an
authored rolling-contact region and publishes one `systems.mobility.assemblies`
record per component. Each record retains the component frame, members,
lineage, wheel contacts, solved forces, motor power, steering, braking, fluids,
and validity. Structural splits receive new lineage-aware identities; commands
remain addressed to authored endpoint parts and resolve through
`componentForPart()` instead of following a guessed vehicle or demo ID.

`FlexibleLineRuntime` shares the production Cannon world and fixed integration
transaction with `MultibodyRuntime`. Its actuator-phase system prepares axial
damping, its structure-phase system resolves internal failure and ordinary
attachment loads, and its completed structure telemetry is the only solved
centreline read model. Presentation owns only a bounded instanced-tube mirror.
The dedicated checkpoint owner persists flexible entity, edge, attachment, and
topology state; replay stores the immutable completed telemetry instead.

Flight-related work is split by ownership. `AerodynamicSystem` applies
per-part atmosphere, wind, altitude-dependent gravity correction, drag, and
authored-surface lift while publishing explicit force and heat-input records.
`ThermalSystem` alone advances temperature, ablation, thermal failure, and
structural-mass contributions. `PhysicalFlightTelemetrySystem` runs after
physics and thermal completion and projects only resolved kinematics, forces,
materials, impacts, and physical identity. It cannot command an actuator or
invent launch, vehicle-mode, mission-status, or stabilization state.

## Checkpoints and physical release

Checkpoint v1 persists the sole mutable flight-domain state under the strict
version-1 `thermal-ablation` owner. Aerodynamic forces, completed flight read
models, and physical-component identity are re-derived. Every checkpoint owner
wrapper has exactly version 1, and restore validates compiled topology plus
aerothermal part identity before applying the atomic transaction.

Physical release is an actuator-phase mechanism, not a vehicle or mission
mode. `ReleaseCouplerSystem` consumes compiled two-flange latch descriptors,
exact commands, resolved electrical power, and private accumulated actuation
energy. It opens the matching solver constraint and only explicitly declared
breakaway routes in one structural transaction; it never supplies a separation
impulse. Its strict mutable latch state is checkpointed under the
`release-couplers` owner. `PhysicalAssemblyIndex` then derives the resulting
lineage from the authoritative topology change like any other structural split.

## Demos and remote controls

Built-in demos are ordinary strict version-1 blueprints. New systems implement `initialize`, `step`, and `dispose`, keep quantities in SI units, and publish telemetry. `npm run check` rejects layer violations, cycles, coordinator growth, DOM access from simulation, demo-based physics dispatch, lint errors, and formatting drift.

Model-specific controllers use serializable `controllerLayouts` and strict
profile-level `actionBindings` that reference the same exact controls as the
advanced Field Remote. Graphic skins may arrange authored semantic actions
such as forward, reverse, steering, brake, and lights, but never own commands,
targets, power rules, or simulation behavior. Profile names do not select
behavior. Unknown or unskinned profiles fall back to the generic instrument
grid.

## Canonical component geometry and presentation

Reusable subassemblies and engineering analysis are model contracts. Catalog
rendering, marquee projection, arrangement controls, and Three.js diagnostic
geometry are presentation controllers. The application coordinator supplies
callbacks and state ownership but does not contain those workflows.

Every catalog component provides one model-owned geometry definition. Its
immutable `GeometryDescriptorV2` projection is the authority for collision and
rendered physical-body primitives, spatial port frames, physical-interface
features, scale, provenance, and each specifically named bounds domain. The
compiler, editor, analysis, runtime, and presentation consume those same facts;
unknown geometry, missing spatial frames, and invalid connection geometry fail
closed. Mechanism deformation and flexible-line solved geometry are absolute
runtime read models and never overwrite authored/reference descriptor bounds.

Presentation projects canonical body and feature records without inventing a
shaft, hub, outlet, attachment face, or other physical interface. It may add
explicitly classified decorative trim, lights, labels, or effects using
read-only canonical anchors and bounds. Decorations cannot define collision,
connection, selection, telemetry, or analysis evidence and cannot be a fallback
for an unknown physical kind.

## Failure analysis and challenges

Failure analysis follows the same boundary. The DOM-free `FailureRecorder`
derives causal events from completed telemetry and assembly snapshots, while
the bounded `ReplayBuffer` retains immutable telemetry frames. The presentation
layer owns particles, procedural audio, report panels, and playback. Replay is
read-only: it never reruns physics or submits controller commands. Exact
single-step delegates to one `SimulationSession.stepFixed()` tick. Deliberate
`commanded-release` transitions remain visible structural telemetry but are not
classified as physical failures.

Challenge evaluation is another model-layer read contract. `ChallengeRun`
combines a declarative objective with an assembly snapshot and immutable
simulation telemetry; it never mutates physics or inspects demo identity. The
application layer owns exact-start capture, payload placement, retry, and record
persistence. The presentation layer renders the contract browser and live
criteria. See [Open construction challenges](docs/CHALLENGE_LAB.md).

Calibration inputs are strict `{ profileId, controlId, value, active }` data.
Static preparation validates the authored profile/control contract; completed
power and signal telemetry determines whether that control path is actually
online. Objective evaluators, constraints, scoring, and failure-event
extractors are separate pure model owners, and each returned criterion or
failure carries immutable channel, unit, frame, tick, validity, and provenance
evidence.

## Controller authoring

Controller authoring also shares one contract. A serializable visual graph is
validated and compiled to the same restricted TypeScript `tick(api, dt)` entry
point as handwritten code; it receives no privileged access to simulation.
Each Logic Controller owns a strict endpoint-addressed binding manifest.
TypeScript, Visual Logic, and WAT use stable controller-local binding IDs;
outputs resolve to exactly one component/port/channel and never broadcast by
channel. `ControllerSensorBank` exposes only explicitly bound previous-step
readings from sensor parts with live signal connections. Ordinary powered
Command Receivers turn remote commands into next-step sensor inputs.
`ControllerTraceBuffer` stores a bounded,
DOM-free history of deterministic runtime inputs and outputs for watches,
oscilloscopes, breakpoints, and exact stepping. Presentation owns the graph
canvas and debugger panels. See [Controller programming and debugging](docs/CONTROLLER_PROGRAMMING.md).

## Sharing and application composition

Blueprint Exchange follows a feature-composition boundary. The DOM-free
`ShareExchangeService` owns catalog, trust, deduplication, validation, and remix
policy behind a transactional repository port. Pure package and bounded-codec
modules live in `model`; browser-only download, clipboard, file, URL, and
thumbnail effects live in presentation adapters. The application composition
root connects those effects to editor use cases. The Exchange presenter only
receives view models and emits actions: it cannot load an assembly, interpret a
package, or persist catalog state. See [Blueprint sharing](docs/BLUEPRINT_SHARING.md).

`src/application/simulacrum-app.js` is a bounded startup coordinator rather
than a feature owner or service locator. Parsed architecture tests ratchet its
size and complexity and prevent extracted package, persistence, and trust
policy from returning. Blueprint v1 is decoded by one strict, total boundary;
workspace v1 owns selection, executable acquisition, active-remote values, and
window state. Unsupported formats are rejected before model or editor
mutation instead of being inferred or normalized.

## Environment composition

Earth environment ownership follows the same rule. The deterministic wind field
is a DOM-free simulation contract that reuses the standard-atmosphere density
model and returns SI velocity components to every applicable runtime. Mountains
and physical-altitude cloud layers are deterministic presentation objects in
`atmospheric-landmarks.js`; the coordinator only composes and repositions their
returned root. Architecture guards prevent either policy from being copied back
into the startup coordinator.

The immutable `test-site-definition-v2` instance in
`testing-playground-content.js` is the single authored authority for the local
Workshop Test Reserve. Its strict rectangle, ellipse, polygon-with-holes, and
corridor-network shapes share DOM-free containment, signed-distance, and bounds
kernels. The surface field composes tagged mound, grade-ramp,
corridor-profile, and ripple-train features with material, district, fluid,
zone, and route queries. Simulation samples that field at 2 m into one bounded
Y-up Cannon Heightfield, then resolves every terrain contact's material and
pair law from the canonical completed contact point before solving. This
supports sphere, box, convex, and cylinder contacts without a tire-only lookup
or coincident surface colliders.

Static fixtures declare exact box, cylinder, or compound child geometry.
Model-owned seeded vegetation compiles immutable poses and sizes used by both
physics and presentation; collision-sized trunks join stable, spatially
partitioned fixture bodies while grass and shrubs stay below contact scale.
Child shape, fixture, district, and material provenance survive grouping. The
construction plate remains a separate physical body.

`local-field-feature.js` and the dedicated surface/fixture presentation
features render projections of that contract; they do not register physics or
read demo identity. Physical fixture visuals and engineered surface regions
remain at every detail level. Only non-authoritative scatter and derived
contact effects may reduce with distance, reduced motion, or large-assembly
performance mode.

The stopped-build Test Ground workflow is application-owned: it validates a
staging clear volume, applies one undoable rigid assembly transform, captures
the exact baseline, and binds the deployment to run identity. Course evaluators
consume immutable completed telemetry and site gates after physics. They can
record outcomes and proof evidence but cannot issue commands or change forces,
contacts, damage, or integration. See
[Workshop Test Reserve](docs/TEST_GROUND.md) for the player workflow and
evidence contract.
