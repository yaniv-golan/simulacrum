# Architecture and policy owners

## Overview

<!-- doc-review {"version":1,"fingerprint":"9e01d89dbbd1f466567dc547e386741b94016d4e93fd37d8ac5ec7d6000d2878","dependencies":"docs/development/.reviews/architecture/overview.json","dependencyDigest":"19b32488fb7586f27a5692c9fde85ae5290ebd835a0bb9331a782fce68da3b3d","disposition":"still accurate","rationale":"The manifest remains the single check metadata owner, now validating mergeSmoke coverage. AGENTS changes verification tiers only; runtime contracts and architectural layer authority remain unchanged."} -->

The [runtime contract](../contracts/runtime-v1.md) owns clocks, cursors, replay and
state ownership. [AGENTS.md](../../AGENTS.md) defines allowed layer edges. The
[registry reader](../../scripts/validate-manifest.mjs#source) loads the canonical `scripts/manifest.json` for milestone allocation and check metadata. This overview identifies that owner; use `npm run gate` and `npm run rules` for its current entries.

## Trace an edit

<!-- doc-review {"version":1,"fingerprint":"8cc3652e287d3de6880ba2f0b5c2a4759513a4524c9c869230584d5929b5c954","dependencies":"docs/development/.reviews/architecture/trace-an-edit.json","dependencyDigest":"033e032c2efa3892c22b357510dc3255b872169f1812cda5becad8a8b3b09c9e","disposition":"updated","rationale":"The integrated section adds the actual ropeInspector and compileRopes owners. The inspector submits the ordinary rope command; core edits a candidate connection and validates/compiles before history publication. Compilation appends massive nodes and spherical attachments, while session/world alone advance them and publish completed observations. Existing part-visual and feedback lifetimes remain outside physics authority."} -->



1. [Workshop application](../../src/application/workshop-app.mjs#source) composes the DOM view, clock and core.
2. [Workshop view](../../src/presentation/workshop-view.mjs#source) turns player input into ordinary commands. The [parts browser](../../src/presentation/parts-browser.mjs#source) owns discovery, [search vocabulary](../../src/presentation/part-search.mjs#source) ranks available parts, and [part placement](../../src/presentation/part-placement.mjs#source) confirms click, touch and drag proposals through cursor-guarded placement, delegating mounting geometry and controls to the existing surface owner. [Surface controls](../../src/presentation/surface-controls.mjs#source), their [placement lifecycle](../../src/presentation/placement-lifecycle.mjs#source), and [mirror controls](../../src/presentation/assembly-mirror.mjs#source) keep previews outside authored state. [Spring controls](../../src/presentation/spring-controls.mjs) submit bounded parameter edits and explain rejected drafts. [Rope controls](../../src/presentation/rope-controls.mjs) author a tensile connection between two surface attachments; [rope compilation](../../src/model/rope.mjs) appends distributed massive nodes. Assembly capture and placement forms also remain transient; their accepted edits use the same core.
3. [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop) admits commands, prepares a candidate and commits accepted edits as one history operation. Rejected/no-op edits preserve their specified cursor/history effects; Undo/Redo restores authored candidates.
4. [validateBlueprint](../../src/model/blueprint.mjs#symbol=validateBlueprint), [placement admission](../../src/model/surfaces.mjs) and [compileAssembly](../../src/model/assembly.mjs#symbol=compileAssembly) validate stored values, physical intersections and connection geometry before simulation receives configuration.
5. [Session](../../src/simulation/session.mjs) owns stepping, checkpoint and completed publication. [Controllers](../../src/simulation/controllers.mjs) produce program commands; the [receiver arbiter](../../src/simulation/receiver-arbiter.mjs) owns Manual/Automatic/Learned/Off, explicit takeover and prior-tick travel regulation; [power](../../src/simulation/power.mjs) resolves circuits; the [physics door](../../src/simulation/physics/world.mjs) alone imports the physics library. Completed contact collection uses the numeric [contact reader](../../src/simulation/physics/read-contacts.mjs); session assigns the completed interval and includes collection in integration timing.
6. [Observation store](../../src/model/observation.mjs) publishes immutable completed snapshots. Presentation consumes these observations, never a live physics object. The application drains a separate observation cursor into selected-body Measurements so its 120 Hz samples do not depend on rendering cadence.

The [assembly library](../../src/application/assembly-library.mjs#implementation) owns
browser persistence and validates definitions with the model. The
[assembly panel](../../src/presentation/assembly-library.mjs#source) displays
named and ordinary endpoints, receiver keys and independent instances. Named mounts
open the surface preview; interface edits use core admission. Placed instances and
saved snapshots have separate views, and saved authored settings are inspectable. Machine saves
embed all internals; simulation has no library dependency.

[Contact properties](../../src/model/contact-properties.mjs#symbol=contactProperties)
resolve material defaults and explicit friction/restitution overrides before the
physics door. Density remains material-owned. The inspector uses the same resolver.
[Retry](../../src/application/retry.mjs#symbol=createRetry) composes ordinary Build
and Run admission, releasing held controls and preserving the authored machine and
view. Completed contacts feed [impact presentation](../../src/presentation/impact-sound.mjs#source);
it has no simulation write path and resets its baseline on missing observations.

The application/view links cover their own composition and input routing code. The core, model and simulation links separately bind the admitted behavior; remote payload contents are outside these claims.

Build edits may replace the admitted configuration; Run uses the fixed simulation
path and forbids authoring edits. Returning to Build restores the editable starting
machine. The view preserves the camera when that starting machine remains visible;
otherwise it reframes without resetting viewing direction. A preview is a proposed edit, not a body pose write. Disposal must end owned
input operations and release handlers/resources. [Direct drag](../../src/presentation/direct-drag.mjs#source),
[editing controls](../../src/presentation/editing-controls.mjs#source), and
[vehicle controls](../../src/presentation/vehicle-controls.mjs#source) own their respective
input lifetimes; input cancellation runs on blur, lost capture and pause where applicable.

Part explanations, tooltip timers and the movable reference window live in
[part help](../../src/presentation/part-help.mjs). Window position, size and active tab
are presentation state. Closing retains the current type, tab and scroll for reopening;
choosing a different type resets the reading page. Catalog thumbnails are cached
independently of palette eligibility, so supported loaded-only parts have images too.
The [shared part mesh](../../src/presentation/part-mesh.mjs#symbol=createPartMesh) supplies
these images and workshop/assembly previews from authored geometry and static family
coatings, with disposal owned by the caller. Angular-rate face artwork follows the
authored axis through the appearance cache; animation remains the completed body pose.
[Example diagrams](../../src/presentation/part-help-diagram.mjs)
render one node per example part and resize their connection paths with the window.
They never enter authored state or
history. The shared [help input scope](../../src/presentation/part-help-input.mjs)
precedes receiver capture and workshop shortcuts; entering it releases held receiver
input through the ordinary vehicle-controls command path. Returning to the workbench
requires a fresh key press. An open reference alone does not suppress controls.
Because the fixed heading is outside the scrolling content, part help forwards
reading keys from the header into the active page. Content focus keeps native
scrolling, while buttons and tab navigation retain their activation behavior.

## Reuse canonical decisions

<!-- doc-review {"version":1,"fingerprint":"5f6326a17278a2a94706c377dee1241daa38e47af1bfa3b67f60aea4997548c2","dependencies":"docs/development/.reviews/architecture/reuse-canonical-decisions.json","dependencyDigest":"458e2ae76029a33335f0ffd4f30f20c0887139cadad26ef877bf9228c40dbb81","disposition":"updated","rationale":"The table now names the rope model, numeric tensile law and completed rope renderer. compileRopes derives area, mass, stiffness and damping from the authored nylon parameters and subdivision, and the law receives numeric vectors/mobility rather than blueprint identity. This extends the existing canonical-owner pattern without moving material, history, geometry or controller authority."} -->



| Decision                                              | Production owner                                                                                                                                                                                                                                             | Example consumer                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Authored geometry and decoration boundary             | [partPrimitives](../../src/model/geometry.mjs#symbol=partPrimitives) / [shaftSegments](../../src/model/geometry.mjs#symbol=shaftSegments), [CATALOG](../../src/model/catalog.mjs#symbol=CATALOG) / [MATERIALS](../../src/model/catalog.mjs#symbol=MATERIALS) | assembly compiler and workshop renderer                                                 |
| Material defaults and explicit contact overrides | [contactProperties](../../src/model/contact-properties.mjs#symbol=contactProperties) | compiler and selected inspector |
| Quaternion math and world directions                  | [transforms](../../src/model/transforms.mjs)                                                                                                                                                                                                                 | surfaces, assembly, mirror                                                              |
| Unique player-visible names                           | [availablePartName](../../src/model/blueprint.mjs#symbol=availablePartName)                                                                                                                                                                                  | core insertion/copy/rename                                                              |
| Surface frames and collision admission                | [resolveSurfaceEndpoint](../../src/model/surfaces.mjs#symbol=resolveSurfaceEndpoint) / [validatePlacementGeometry](../../src/model/surfaces.mjs#symbol=validatePlacementGeometry)                                                                            | compiler and surface proposal                                                           |
| Candidate attachment                                  | [snapConnection](../../src/model/assembly.mjs#symbol=snapConnection) / [proposeSurfaceMount](../../src/model/assembly.mjs#symbol=proposeSurfaceMount)                                                                                                        | core and surface preview                                                                |
| Mechanical membership and selection boundaries        | [connection graph](../../src/model/connection-graph.mjs)                                                                                                                                                                                                     | authoring, mount admission, manipulation scope and mirror selection                     |
| Rigid authoring transforms                            | [transformGroup](../../src/model/editing.mjs#symbol=transformGroup), [frame math](../../src/model/transforms.mjs)                                                                                                                                            | core transforms and connection snapping                                                 |
| Connection overlay specification/resources            | [checked spec producer](../../src/presentation/connection-render.mjs), [renderer](../../src/presentation/connection-view.mjs)                                                                                                                                | workshop display; exact diagnostic edge IDs come from connectionTestPaths               |
| Mirror reflection and omitted edges                   | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs#symbol=proposeMirroredAssembly)                                                                                                                                                                | mirror UI and core command                                                              |
| Reusable definitions, aliases and instance transforms | [reusable assembly proposals](../../src/model/reusable-assemblies.mjs)                                                                                                                                                                                       | core commands and assembly library                                                      |
| Guided spring law and completed readings              | [topology admission](../../src/simulation/physics/spring-topology.mjs), [numeric spring law](../../src/simulation/physics/law/spring.mjs), [physics door](../../src/simulation/physics/world.mjs), [session](../../src/simulation/session.mjs)               | [retained coil rendering](../../src/presentation/spring-view.mjs) and inspector         |
| Distributed rope properties and completed geometry | [rope model](../../src/model/rope.mjs), [nonlinear tensile law](../../src/simulation/physics/law/rope.mjs) | [rope rendering](../../src/presentation/rope-view.mjs) and selected inspector |
| Command effects, cursor and history                   | [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop)                                                                                                                                                                                          | all authoring interfaces                                                                |
| Placement commitment and cancellation                 | [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs#symbol=createPlacementLifecycle)                                                                                                                                                   | surface controls                                                                        |
| Canvas direct drag lifetime                           | [createDirectDrag](../../src/presentation/direct-drag.mjs#symbol=createDirectDrag)                                                                                                                                                                           | workshop view                                                                           |
| Receiver keyboard/override ownership                  | [createVehicleControls](../../src/presentation/vehicle-controls.mjs#symbol=createVehicleControls)                                                                                                                                                            | [Connect & test](../../src/presentation/connection-test.mjs#source)                     |
| Catalog vocabulary and grouping                      | [search vocabulary](../../src/presentation/part-search.mjs)                                                                                                                                                                                                      | catalog grouping; eligibility and help coverage follow CATALOG                             |
| Part teaching copy and port labels                    | [help content](../../src/presentation/part-help-content.mjs), [port wording](../../src/presentation/port-wording.mjs)                                                                                                                                        | palette, inspector and static example diagrams                                          |
| Completed contact impulses                            | [contact reader](../../src/simulation/physics/read-contacts.mjs), [session](../../src/simulation/session.mjs)                                                                                                                                                | immutable completed observations; qualification supplies independent support predicates |
| Saved environment preset | [environment descriptors](../../src/model/environment.mjs), [assembly compiler](../../src/model/assembly.mjs) | workshop geometry, placement admission and recording review |
| Selected-body measurement windows | [numeric accumulator](../../src/model/motion-readout.mjs), [measurement presentation](../../src/presentation/motion-readout.mjs) | completed observation deltas supplied by the application |
| Diagnostics from completed data                       | [diagnoseMotion](../../src/model/motion-diagnostics.mjs#symbol=diagnoseMotion), [connection paths](../../src/model/connection-test-paths.mjs)                                                                                                                | inspector and Check machine                                                             |

Use `node scripts/navigate.mjs <owner-symbol>` to discover current consumers and tests.
These links explain policy responsibilities, not a second inventory of module edges.
Render-only decoration may illustrate a hub; it must not imply an authorable hole or
replace the collision geometry. Preserve independent physical test calculations when
sharing production policy: an oracle that calls the implementation proves little.

Powered linear guides compile to the same five constrained sliding degrees of freedom
as springs, with zero stiffness and damping. The catalog owns force per amp, winding
resistance, current limit and maximum driven speed. The physics door prepares generalized
axial rows with both anchor moments, samples projected velocity including passive damping,
and applies measured equal-and-opposite drive impulses. The shared electrical network
uses an explicit linear coordinate descriptor; its legacy `torqueConstant`, `torque`
and `shaftWorkJ` fields represent N/A, N and axial work for that descriptor. The inspector
labels these quantities in linear units. Completed spring-kind readings supply travel;
they do not imply stored spring energy for a powered guide. Off or power loss releases
active drive without a clutch. Native stops remain passive constraints.

A cell can supply multiple rotary and linear drives; multiple cells on one circuit remain unsupported.
Shared motor torque and powered sensor-load accounting and the completed energy ledger belong to simulation.
Ground contact and workshop motion are not Course qualification.


## Shared sensing and behavior authoring
<!-- doc-review {"version":1,"fingerprint":"6073a1d9671257f25c7e122fa4dad8fa6579c3589dc016aa4b3a29a109cde016","dependencies":"docs/development/.reviews/architecture/shared-sensing-and-behavior-authoring.json","dependencyDigest":"d4eb458f76d80036488a49097761edc6eaf92885bfb96730102a4c5fe86e667a","disposition":"still accurate","rationale":"Rope expands compiled bodies, connections and completed observation types, but does not add a sensor channel, policy observation, controller evaluator or learning admission path. Existing sensor sampling, receiver arbitration, completed decision history and explicit learned-model installation retain their owners. Rope applied-tension inspection is not a training signal or new controller authority."} -->

[Channel descriptors](../../src/model/sensors.mjs) own measurement units and frames.
[Sampling](../../src/simulation/sensors.mjs) reads completed physics through the door;
[power](../../src/simulation/power.mjs) funds each sensor. The selected
[sensor inspector](../../src/presentation/sensor-controls.mjs) and
[measurement overlay](../../src/presentation/sensor-view.mjs) consume completed data.

[Rules and draft admission](../../src/model/controller-authoring.mjs) own source
identity. The [bounded compiler](../../src/scripting/controller-program.mjs) admits
TypeScript and emits WASM; [executor construction](../../src/scripting/controller-executors.mjs)
is injected by core. Simulation has no scripting import edge. The controller editor
owns drafts and preservation, including exportable oversized text that cannot be applied;
accepted programs use ordinary atomic Build history. Numeric truth tests retain
TypeScript zero/NaN semantics.
[Decision projection](../../src/model/controller-decision.mjs) reads completed inputs
and applied ownership without evaluating a policy. Application-owned
[recent history](../../src/application/controller-history.mjs) drains the completed
cursor independently of training. Its [requested inspector](../../src/presentation/controller-history.mjs)
retains historical source/reading distinctions and returns repairs to Build.

[Learning model admission/training](../../src/model/learning-model.mjs) owns versioned
feature transforms and frozen numeric weights. The [workspace](../../src/application/learning-workspace.mjs)
owns teaching history, training candidates and user-requested installation. Capture
starts with the first valid observation and retains fault-only attempts outside training. Independent
[experiment evaluation](../../src/model/learning-evaluators.mjs) receives explicit role
bindings from application selection and supplies no policy observations. Both regular
and learned dispatch use the same receiver arbiter and powered actuator path. Optional
sensor experiments extend the existing learning entry; they create no identity-based
physics or permanent per-sensor dashboard.
