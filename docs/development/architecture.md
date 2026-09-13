# Architecture and policy owners

## Overview

<!-- doc-review {"version":1,"fingerprint":"1106ca499266bb51d9f07b4f696ee11e6b6bb13da332eabe94e01c325771e0a2","dependencies":"docs/development/.reviews/architecture/overview.json","dependencyDigest":"aa1c5bcb8bb2863462e629aa29c5704423bc4aeedc89e74b339f2e2a8c94aad5","disposition":"still accurate","rationale":"Runtime v1 still owns clocks, state and replay after scene environment schema additions; the manifest remains milestone and check authority."} -->

The [runtime contract](../contracts/runtime-v1.md) owns clocks, cursors, replay and
state ownership. [AGENTS.md](../../AGENTS.md) defines allowed layer edges. The
[registry reader](../../scripts/validate-manifest.mjs#source) loads the canonical `scripts/manifest.json` for milestone allocation and check metadata. This overview identifies that owner; use `npm run gate` and `npm run rules` for its current entries.

## Trace an edit

<!-- doc-review {"version":1,"fingerprint":"298b392d42ac536399fb08e2fe60fb04b8158a31052c07da076c24dce7b9d057","dependencies":"docs/development/.reviews/architecture/trace-an-edit.json","dependencyDigest":"b76929e2899e026f61775a3dd2f1131a7b739daa7876c19518c89336d478e691","disposition":"still accurate","rationale":"The retained scene paragraph names model geometry normalization, independent persistence, shared proposal lifecycle and core history. Main catalogue and feedback owners are preserved beside these scene owners."} -->



1. [Workshop application](../../src/application/workshop-app.mjs#source) composes the DOM view, clock and core.
2. [Workshop view](../../src/presentation/workshop-view.mjs#source) turns player input into ordinary commands. The [parts browser](../../src/presentation/parts-browser.mjs#source) owns discovery, [search vocabulary](../../src/presentation/part-search.mjs#source) ranks available parts, and [part placement](../../src/presentation/part-placement.mjs#source) confirms click, touch and drag proposals through cursor-guarded placement, delegating mounting geometry and controls to the existing surface owner. [Surface controls](../../src/presentation/surface-controls.mjs#source), their [placement lifecycle](../../src/presentation/placement-lifecycle.mjs#source), and [mirror controls](../../src/presentation/assembly-mirror.mjs#source) keep previews outside authored state. [Spring controls](../../src/presentation/spring-controls.mjs) submit bounded parameter edits and explain rejected drafts. [Rope controls](../../src/presentation/rope-controls.mjs) author a tensile connection between two surface attachments; [rope compilation](../../src/model/rope.mjs) appends distributed massive nodes. Assembly capture and placement forms also remain transient; their accepted edits use the same core.
3. [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop) admits commands, prepares a candidate and commits accepted edits as one history operation. Rejected/no-op edits preserve their specified cursor/history effects; Undo/Redo restores authored candidates.
4. [validateBlueprint](../../src/model/blueprint.mjs#symbol=validateBlueprint), [placement admission](../../src/model/surfaces.mjs) and [compileAssembly](../../src/model/assembly.mjs#symbol=compileAssembly) validate stored values, physical intersections and connection geometry before simulation receives configuration.
5. [Session](../../src/simulation/session.mjs) owns stepping, checkpoint and completed publication. [Controllers](../../src/simulation/controllers.mjs) produce program commands; the [receiver arbiter](../../src/simulation/receiver-arbiter.mjs) owns Manual/Automatic/Learned/Off, explicit takeover and prior-tick travel regulation; [power](../../src/simulation/power.mjs) resolves circuits; the [physics door](../../src/simulation/physics/world.mjs) alone imports the physics library. Completed contact collection uses the numeric [contact reader](../../src/simulation/physics/read-contacts.mjs); session assigns the completed interval and includes collection in integration timing.
6. [Observation store](../../src/model/observation.mjs) publishes immutable completed snapshots. Presentation consumes these observations, never a live physics object. The application drains a separate observation cursor into selected-body Measurements so its 120 Hz samples do not depend on rendering cadence.

The view exposes the existing workshop footer as `utilityHost`; the application mounts
feedback and recording controls there and keeps protected feedback dialogs outside
the workshop root. Ordinary offline feedback does not add a second workbench row. Optional
[feedback context](../../src/application/feedback-context.mjs#symbol=captureFeedbackContext)
combines the ordinary authored save with current UI state. It never requests a replay
checkpoint or native physics bytes; recording keeps its separate capture path.

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

The [scene model](../../src/model/environment.mjs#source) owns bounded fixed solids,
legacy descriptors and geometric union. Authored quaternion values remain in saves;
geometry normalizes their admitted magnitude before rendering and collider union. [Scene persistence](../../src/application/scene-library.mjs#source)
contains no machine data. The [scene editor](../../src/presentation/scene-editor.mjs#source)
uses the same [document proposal policy](../../src/presentation/document-proposal.mjs#source)
as assembly insertion; core owns replacement and chronological history. Compiled scene
solids follow machine bodies and ground, preserving machine index/mapping authority.
[Primitive reconstruction](../../src/presentation/primitive-geometry.mjs#source) supplies
both scene previews and capture review with the canonical cylinder tessellation and dimensions.

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

Release Coupler uses an ordinary fixed attachment on its catalog-designated right
mounting face. The compiler records its numeric joint index. Power accounts the coil
as a resistive load on the shared circuit; a held positive receiver command funds a
finite actuation. Completed funding schedules opening on the next tick. Before motor
allocation, the physics door previews the proposed topology using an exact native
snapshot copy and copied response factors. The actuator phase removes only the planned
native fixed joints, preserving the live bodies, then applies those funded responses.
Completed power telemetry owns latch progress/status; physics snapshot metadata owns
opened joint indices, cross-validated during session restore. Build restores the authored
starting attachments. The preview copy never replaces the live plant or supplies motion.
Rope anchors remain attached when a fixed latch opens. Numeric rope links stay outside
native bilateral groups and use the prepared post-release response before integration.
The runtime contract owns the combined checkpoint format and independent validation
of opened joints and completed rope work.

## Reuse canonical decisions

<!-- doc-review {"version":1,"fingerprint":"6469e1eae0d68a0f95379a1d550bd7afb4c335d74f619225b8545688abb2cce7","dependencies":"docs/development/.reviews/architecture/reuse-canonical-decisions.json","dependencyDigest":"a02443b208987e0c2cf94f7569854508e8cb95f798998005eb3a27e7d21005c4","disposition":"still accurate","rationale":"Scene descriptors reuse canonical transforms and contact properties; replacement uses existing core cursor and history ownership. The table continues to identify the actual reusable owners."} -->



| Decision                                              | Production owner                                                                                                                                                                                                                                             | Example consumer                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Authored geometry and decoration boundary             | [partPrimitives](../../src/model/geometry.mjs#symbol=partPrimitives) / [shaftSegments](../../src/model/geometry.mjs#symbol=shaftSegments), [CATALOG](../../src/model/catalog.mjs#symbol=CATALOG) / [MATERIALS](../../src/model/catalog.mjs#symbol=MATERIALS) | assembly compiler and workshop renderer                                                 |
| Material defaults and explicit contact overrides | [contactProperties](../../src/model/contact-properties.mjs#symbol=contactProperties) | compiler and selected inspector |
| Quaternion math and world directions                  | [transforms](../../src/model/transforms.mjs)                                                                                                                                                                                                                 | surfaces, assembly, mirror                                                              |
| Unique player-visible names                           | [availablePartName](../../src/model/blueprint.mjs#symbol=availablePartName)                                                                                                                                                                                  | core insertion/copy/rename                                                              |
| Surface frames and collision admission                | [resolveSurfaceEndpoint](../../src/model/surfaces.mjs#symbol=resolveSurfaceEndpoint) / [validatePlacementGeometry](../../src/model/surfaces.mjs#symbol=validatePlacementGeometry)                                                                            | compiler and surface proposal                                                           |
| Candidate attachment                                  | [snapConnection](../../src/model/assembly.mjs#symbol=snapConnection) / [proposeSurfaceMount](../../src/model/assembly.mjs#symbol=proposeSurfaceMount)                                                                                                        | core and surface preview                                                                |
| Mechanical membership and selection boundaries        | [connection graph](../../src/model/connection-graph.mjs)                                                                                                                                                                                                     | authoring, mount admission, manipulation scope and mirror selection                     |
| Released fixed-attachment classification | [releasedAttachment](../../src/presentation/release-state.mjs) | selected inspector and generic connection overlay |
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
| Authored environment and legacy presets | [environment descriptors](../../src/model/environment.mjs), [assembly compiler](../../src/model/assembly.mjs) | workshop geometry, placement admission and recording review; matching boxes compile as their geometric union |
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
<!-- doc-review {"version":1,"fingerprint":"f5d253066ed6ca6b981aae8e129be94fec5304e314c1f7edb4f06a33418a56ee","dependencies":"docs/development/.reviews/architecture/shared-sensing-and-behavior-authoring.json","dependencyDigest":"85d0e02834efd9cb815c456e4626f56cf58d00d428756e284156f20c7cb18ebf","disposition":"still accurate","rationale":"Scene colliders append outside machine mappings; scene preservation tests confirm machine sensor scope and metrics remain machine-owned. No controller or observation sampling owner changed."} -->

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
