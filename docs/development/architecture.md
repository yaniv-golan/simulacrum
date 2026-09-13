# Architecture and policy owners

## Overview

<!-- doc-review {"version":1,"fingerprint":"1d903bf3be2492eac3a12a4e94ecdcc96536617aa221caac4d13b3a6211a9950","dependencies":"docs/development/.reviews/architecture/overview.json","dependencyDigest":"deaef60bf010712abdf33ee841776560e688099621feec96bb4419a20d9ad3c1","disposition":"still accurate","rationale":"AGENTS.md's stacked-integration rule concerns verification coordination between candidates; the runtime contract still owns clocks, state and replay and AGENTS still owns layer edges as the overview states."} -->

The [runtime contract](../contracts/runtime-v1.md) owns clocks, cursors, replay and
state ownership. [AGENTS.md](../../AGENTS.md) defines allowed layer edges. The
[registry reader](../../scripts/validate-manifest.mjs#source) loads the canonical `scripts/manifest.json` for milestone allocation and check metadata. This overview identifies that owner; use `npm run gate` and `npm run rules` for its current entries.

## Trace an edit

<!-- doc-review {"version":1,"fingerprint":"4b43cbcaecb779e63cb87fc22b23b7e7915c343e0c21a9f3c27ed15b1682a957","dependencies":"docs/development/.reviews/architecture/trace-an-edit.json","dependencyDigest":"72550e78c4875d2d8ef66bad095d2f7ad47651c3650f6c3d098924896d67f0af","disposition":"updated","rationale":"Read the full edit flow and revised release paragraph against compiler, session and physics door. Load Cell still enters via ordinary model surface compilation and completed publication; reactions do not create UI-to-physics access. The revised coupler explanation correctly distinguishes snapshot-copy response planning from removal of planned joints in the live world, retains body motion and states that numeric rope links remain outside native bilateral groups with active anchors after release. Main's utilityHost feedback placement, authored-only feedback context, camera recovery and input/resource lifetimes are preserved. Re-read the modified thumbnail paragraph and source: createThumbnailQueue schedules before the first type and between types; workshop-view publishes each image into the retained cache and all currently mounted matching icons, and cancels/disposes the batch with the workshop. Existing physical warmup, force/release/camera owners remain intact. The updated environment row now names authored scenes and legacy presets, with matching boxes compiled as geometric union. Compiler body ordering retains machine indices; Load Cell reactions still belong to compiled attachment constraints. Scene previews and recording reconstruction share primitive geometry. The incoming structural-failure ownership clarification does not grant force measurements or phase presence the authority to certify no damage. Load Cell reaction telemetry and scene contact geometry remain separate from unimplemented capacity-based breakage."} -->

1. [Workshop application](../../src/application/workshop-app.mjs#source) composes the DOM view, clock and core.
2. [Workshop view](../../src/presentation/workshop-view.mjs#source) turns player input into ordinary commands. The [parts browser](../../src/presentation/parts-browser.mjs#source) owns discovery, [search vocabulary](../../src/presentation/part-search.mjs#source) ranks available parts, and [part placement](../../src/presentation/part-placement.mjs#source) confirms click, touch and drag proposals through cursor-guarded placement, delegating mounting geometry and controls to the existing surface owner. [Surface controls](../../src/presentation/surface-controls.mjs#source), their [placement lifecycle](../../src/presentation/placement-lifecycle.mjs#source), and [mirror controls](../../src/presentation/assembly-mirror.mjs#source) keep previews outside authored state. [Spring controls](../../src/presentation/spring-controls.mjs) submit bounded parameter edits and explain rejected drafts. [Rope controls](../../src/presentation/rope-controls.mjs) author a tensile connection between two surface attachments; [rope compilation](../../src/model/rope.mjs) appends distributed massive nodes. Assembly capture and placement forms also remain transient; their accepted edits use the same core.
3. [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop) admits commands, prepares a candidate and commits accepted edits as one history operation. Rejected/no-op edits preserve their specified cursor/history effects; Undo/Redo restores authored candidates.
4. [validateBlueprint](../../src/model/blueprint.mjs#symbol=validateBlueprint), [placement admission](../../src/model/surfaces.mjs) and [compileAssembly](../../src/model/assembly.mjs#symbol=compileAssembly) validate stored values, physical intersections and connection geometry before simulation receives configuration.
5. [Session](../../src/simulation/session.mjs) owns stepping, checkpoint and completed publication. [Controllers](../../src/simulation/controllers.mjs) produce program commands; the [receiver arbiter](../../src/simulation/receiver-arbiter.mjs) owns Manual/Automatic/Learned/Off, explicit takeover and prior-tick travel regulation; [power](../../src/simulation/power.mjs) resolves circuits; the [physics door](../../src/simulation/physics/world.mjs) alone imports the physics library. Completed contact collection uses the numeric [contact reader](../../src/simulation/physics/read-contacts.mjs); session assigns the completed interval and includes collection in integration timing.
6. [Observation store](../../src/model/observation.mjs) publishes immutable completed snapshots. Presentation consumes these observations, never a live physics object. The application drains a separate observation cursor into selected-body Measurements so its 120 Hz samples do not depend on rendering cadence.

The session's structure/failure phase currently checks finite state and conserved
body count/mass; general rated-capacity overload breakage remains outstanding.
Commanded coupler release does not supply that qualification. See the
[runtime limitation](../contracts/runtime-v1.md#structural-failure-scope) before
interpreting an active phase or a no-damage result as physical failure coverage.

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

[Camera exposure state](../../src/simulation/camera-state.mjs#symbol=createCameraState)
belongs to simulation; it publishes completed exposure results without image bytes.
[Camera destinations](../../src/application/camera-session.mjs#source) drain completed
observations into a [bounded gallery](../../src/application/camera-gallery.mjs#source).
The temporary [camera viewing cone](../../src/presentation/camera-frustum.mjs#source)
is owned by workshop inspection and never enters the optical scene.
The dedicated [optical renderer](../../src/presentation/camera-renderer.mjs#source)
receives only authored geometry settings and completed poses, without part identities,
controller programs or editor scene input. Completed rope node positions and authored
diameter pass as plain geometry to the shared rope renderer, with selection disabled.
It pins pixels before asynchronous encoding; no image result feeds back into the plant.
[Feedback screenshot capture](../../src/presentation/workshop-screenshot.mjs#symbol=captureWorkshopScreenshot)
copies the active camera canvas or renders the orbit canvas when camera view is closed.
It never requests an exposure or substitutes orbit pixels for an unavailable active camera.

The application/view links cover their own composition and input routing code. The core, model and simulation links separately bind the admitted behavior; remote payload contents are outside these claims.

The [scene model](../../src/model/environment.mjs#source) owns bounded fixed solids,
legacy descriptors and geometric union. Authored quaternion values remain in saves;
geometry normalizes their admitted magnitude before rendering and collider union. [Scene persistence](../../src/application/scene-library.mjs#source)
contains no machine data. The [scene editor](../../src/presentation/scene-editor.mjs#source)
uses the same [document proposal policy](../../src/presentation/document-proposal.mjs#source)
as assembly insertion; core owns replacement and chronological history. Entering scene
authoring exits mounted-camera viewing through the camera session, restoring workshop
orbit and input ownership before scene tools activate. Compiled scene
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
The [thumbnail queue](../../src/presentation/thumbnail-queue.mjs#symbol=createThumbnailQueue)
yields before rendering and between catalog types. Completed images update mounted
palette, help and inspector icons; later icons use the cache. Workshop disposal
cancels pending work and releases the batch's temporary graphics resources.
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

<!-- doc-review {"version":1,"fingerprint":"d98a1c29c36f95c032039007b4c1e52c79bb1a96dd81f124056ab475c20a47b2","dependencies":"docs/development/.reviews/architecture/reuse-canonical-decisions.json","dependencyDigest":"1c0e8b300e85276bc00c7e0c8a7bb3f7394be2b7e5844757c18cbd4d4bdb0613","disposition":"still accurate","rationale":"Every row in the canonical-decision table still names the actual owner: catalog/geometry/material/surface rules, model graph proposals, core history, completed contact/spring/rope data, presentation resources and measurement accumulators. Load Cell uses these same geometry, surface, naming, copying, help/port-label and completed-data policies. The explanatory linear-guide/shared-power paragraphs retain their coordinate-aware electrical interpretation and no-hidden-clutch behavior; spring.10 adds read-only reaction diagnostics rather than moving these policies into a fixture or renderer. The existing Lamp driver paragraph correctly assigns shared-circuit voltage/current and cumulative delivery/sensor/coupler heat to the simulation power owner; camera gallery/optical rendering remains application/presentation state. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements. Scene admission reuses environment/model and document-proposal boundaries instead of introducing an identity-selected physics path. Load Cell ports, reactions and controller outputs retain the existing model/runtime ownership; the scene compiler appends fixed solids without replacing sensor bindings."} -->

| Decision                                              | Production owner                                                                                                                                                                                                                                             | Example consumer                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Authored geometry and decoration boundary             | [partPrimitives](../../src/model/geometry.mjs#symbol=partPrimitives) / [shaftSegments](../../src/model/geometry.mjs#symbol=shaftSegments), [CATALOG](../../src/model/catalog.mjs#symbol=CATALOG) / [MATERIALS](../../src/model/catalog.mjs#symbol=MATERIALS) | assembly compiler and workshop renderer                                                 |
| Material defaults and explicit contact overrides      | [contactProperties](../../src/model/contact-properties.mjs#symbol=contactProperties)                                                                                                                                                                         | compiler and selected inspector                                                         |
| Quaternion math and world directions                  | [transforms](../../src/model/transforms.mjs)                                                                                                                                                                                                                 | surfaces, assembly, mirror                                                              |
| Unique player-visible names                           | [availablePartName](../../src/model/blueprint.mjs#symbol=availablePartName)                                                                                                                                                                                  | core insertion/copy/rename                                                              |
| Surface frames and collision admission                | [resolveSurfaceEndpoint](../../src/model/surfaces.mjs#symbol=resolveSurfaceEndpoint) / [validatePlacementGeometry](../../src/model/surfaces.mjs#symbol=validatePlacementGeometry)                                                                            | compiler and surface proposal                                                           |
| Candidate attachment                                  | [snapConnection](../../src/model/assembly.mjs#symbol=snapConnection) / [proposeSurfaceMount](../../src/model/assembly.mjs#symbol=proposeSurfaceMount)                                                                                                        | core and surface preview                                                                |
| Mechanical membership and selection boundaries        | [connection graph](../../src/model/connection-graph.mjs)                                                                                                                                                                                                     | authoring, mount admission, manipulation scope and mirror selection                     |
| Released fixed-attachment classification              | [releasedAttachment](../../src/presentation/release-state.mjs)                                                                                                                                                                                               | selected inspector and generic connection overlay                                       |
| Rigid authoring transforms                            | [transformGroup](../../src/model/editing.mjs#symbol=transformGroup), [frame math](../../src/model/transforms.mjs)                                                                                                                                            | core transforms and connection snapping                                                 |
| Connection overlay specification/resources            | [checked spec producer](../../src/presentation/connection-render.mjs), [renderer](../../src/presentation/connection-view.mjs)                                                                                                                                | workshop display; exact diagnostic edge IDs come from connectionTestPaths               |
| Mirror reflection and omitted edges                   | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs#symbol=proposeMirroredAssembly)                                                                                                                                                                | mirror UI and core command                                                              |
| Reusable definitions, aliases and instance transforms | [reusable assembly proposals](../../src/model/reusable-assemblies.mjs)                                                                                                                                                                                       | core commands and assembly library                                                      |
| Guided spring law and completed readings              | [topology admission](../../src/simulation/physics/spring-topology.mjs), [numeric spring law](../../src/simulation/physics/law/spring.mjs), [physics door](../../src/simulation/physics/world.mjs), [session](../../src/simulation/session.mjs)               | [retained coil rendering](../../src/presentation/spring-view.mjs) and inspector         |
| Distributed rope properties and completed geometry    | [rope model](../../src/model/rope.mjs), [nonlinear tensile law](../../src/simulation/physics/law/rope.mjs)                                                                                                                                                   | [rope rendering](../../src/presentation/rope-view.mjs) and selected inspector           |
| Command effects, cursor and history                   | [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop)                                                                                                                                                                                          | all authoring interfaces                                                                |
| Placement commitment and cancellation                 | [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs#symbol=createPlacementLifecycle)                                                                                                                                                   | surface controls                                                                        |
| Canvas direct drag lifetime                           | [createDirectDrag](../../src/presentation/direct-drag.mjs#symbol=createDirectDrag)                                                                                                                                                                           | workshop view                                                                           |
| Receiver keyboard/override ownership                  | [createVehicleControls](../../src/presentation/vehicle-controls.mjs#symbol=createVehicleControls)                                                                                                                                                            | [Connect & test](../../src/presentation/connection-test.mjs#source)                     |
| Catalog vocabulary and grouping                       | [search vocabulary](../../src/presentation/part-search.mjs)                                                                                                                                                                                                  | catalog grouping; eligibility and help coverage follow CATALOG                          |
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
Shared motor torque, powered sensor loads and lamp delivery accounting belong to simulation.
The [lamp ratings](../../src/model/lamps.mjs#source) bound eight authored lamps at 10 W each.
[Power](../../src/simulation/power.mjs#symbol=createPowerNetwork) uses a source-rating-adaptive
resistive driver: conductance is requested watts divided by max(24 V, source nominal
voltage) squared. Droop and shared current limiting reduce delivery. Completed flux is
100 modeled lm per delivered watt; the cumulative circuit ledger counts lamp delivery
once alongside cell heat and other loads. Receiver wiring replaces the default command
of one; disabled, zero and negative commands request zero. Initial lamps are unstepped
and dark; restored completed records reconcile sources, tick and circuit accounting.
Instantaneous lamp readings also obey the common bus voltage, driver-current ceiling
and source droop/current bounds. Source draw includes coupler current and motor PWM current, including the linear speed cap. Coupler heat enters the cumulative ledger once. Passive
lamp/sensor-only circuits also match the limited resistive solution reconstructed
from completed draw and remaining charge; an unbounded driver cannot report false darkness.
Ground contact and workshop motion are not Course qualification.

## Shared sensing and behavior authoring

<!-- doc-review {"version":1,"fingerprint":"79b275bce0aec67455e8dd44fce7fd34b46d1a409ca607b8387aaa94b3c74913","dependencies":"docs/development/.reviews/architecture/shared-sensing-and-behavior-authoring.json","dependencyDigest":"1aef2e5fbee27871e01b12387055a23daec4d8013db8be9ba7145a24f14c6b97","disposition":"updated","rationale":"The merged Load Cell explanation matches actual code: compiler resolves left support/right measured joint, joint-reactions negates native endpoint-a impulses into copied endpoint-b receipts, sampler applies sign/dt then local-X projection and vector magnitude. Own-weight examples describe which attachment carries gravity without runtime mass estimates. Powered invalidity, disconnected opened/missing mounts, authored bypasses including rope/gear paths, tick-zero initialization and separate historical/current opened topologies are correctly distinguished. Existing injected Rules/learning execution, diagnostic history and explicit receiver rearm boundaries remain unchanged. Incoming Lamp shared circuit delivery and restore ledgers include sensor heat once, so Camera and Load Cell funded supplies remain ordinary peers. Camera exposure state is distinct from numeric sensor history; load-cell force sampling and attachment topology remain unchanged. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements. The authored-scene merge adds ordinary static contact geometry. It neither adds scene IDs to controller observation authority nor changes completed sensor publication, learned-model admission or previous-tick Rules consumption. Load Cell sensor/reaction paths are preserved."} -->

[Channel descriptors](../../src/model/sensors.mjs) own measurement units and frames.
[Sampling](../../src/simulation/sensors.mjs) reads completed physics through the door;
[power](../../src/simulation/power.mjs) funds each sensor. The selected
[sensor inspector](../../src/presentation/sensor-controls.mjs) and
[measurement overlay](../../src/presentation/sensor-view.mjs) consume completed data.

The Load Cell uses ordinary A/B surface mounts. The compiler binds A as support and
B as the measured fixed joint. The [joint reaction owner](../../src/simulation/physics/joint-reactions.mjs)
adds full-tick native impulses and only the prepared corrections actually applied
by the physics door, including rope-induced bilateral attachment corrections. Its copied impulse acts on the configured joint's second body;
sampling converts it to force on the cell. `load` is the magnitude of the tick-average
world-space force vector, including shear; opposing impulses within a tick can
cancel. `axialForce` projects that vector onto the completed local +X axis from A
to B. Both use newtons; neither reports torque, peak force or capacity ratio. The
channel scale is a normalizer, not a part rating.

In a settled hanging fixture with no other support or applied force, A supports the
cell while B measures the payload side, excluding the cell's own weight. If B instead
supports the cell and a payload attached to A, its reaction includes both weights. This changes which attachment carries the
load; rotating the same support arrangement alone does not move weight across B.
These are measurement checks, not runtime mass-based estimates.

Power loss takes precedence over mechanical status. When powered, a missing mount
or an opened A/B mount is disconnected. With both mounts present, another remaining
authored mechanical path between B endpoints makes sensing unavailable, including
paths through gears or ropes. Opening a bypass updates this domain on the completed
tick; a slack rope remains an authored bypass.
With power and both mounts present in the supported domain, the reading is
initializing before the first completed integration.
Invalid readings contain no numeric value. Reaction k is sampled and consumed during
tick k+1. Checkpoints preserve both the world's latest reaction and the previous
sensor evidence, each with its own completed opened-joint topology. Restore checks
current and historical topology at their respective ages. Existing receiver faults leave Automatic Off until explicitly rearmed.

Cameras use the same funded sensor supply path but expose no numeric channels.
Their [optical profile](../../src/model/camera.mjs#source) and checkpointed exposure
latch are distinct from prior-completed numeric sensor readings. Receiver trigger
wiring requests photographs through ordinary commands; it grants no scene access.

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
