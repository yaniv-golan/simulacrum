# Change recipes

## Choose a recipe

<!-- doc-review {"version":1,"fingerprint":"d6e8aebba04a00908fc8d6f1758b3cb37a1049e362356a36084f72105261474d","dependencies":"docs/development/.reviews/recipes/choose-a-recipe.json","dependencyDigest":"300fa1026f83833cf2ff65e01df621a50584f1cfb52150f3469c8f0d8118668f","disposition":"still accurate","rationale":"Architecture overview still identifies the same runtime and manifest owners. Recording transport changes add no alternative authoring policy or implementation owner."} -->



Use the [map](architecture.md#overview) to locate the owner, inspect its reverse consumers with
`node scripts/navigate.mjs <symbol-or-path>`, then use focused tests. Admit changes
through the public command surface. A view-local convenience must not become a second
attachment, polarity, naming, reset or authored-property policy.

Part additions and interaction changes that add or change teaching also follow the
[learning content admission rules](ui-ux.md#learning-content-policy). Record the
admission decision before adding an example or contextual invitation; a new part does
not automatically earn an entry.

## Add or extend a part

<!-- doc-review {"version":1,"fingerprint":"249edf152e297ec4c1169a854b12dae1aa648cd5137d7a876fa3cbbf164fd8ee","dependencies":"docs/development/.reviews/recipes/add-or-extend-a-part.json","dependencyDigest":"99348d03b3f30d77049ee34a2395fc8630cea4daf818c6518eb82384706d7c16","disposition":"still accurate","rationale":"Frame construction timing does not modify catalog geometry, schema, material admission, mounting surfaces, gear support eligibility or Ball controls. The recipe's ordinary authored-part and independent renderer/model checks still apply."} -->

Start with [CATALOG](../../src/model/catalog.mjs#symbol=CATALOG), [schema](../../src/model/blueprint.schema.json)
and [createPart](../../src/model/blueprint.mjs#symbol=createPart). Declare its current milestone in
[features](../../src/model/features.mjs). Use [partPrimitives](../../src/model/geometry.mjs#symbol=partPrimitives)
for authored shapes and [surfaceRegions](../../src/model/surfaces.mjs#symbol=surfaceRegions) for mounting.
The [compiler](../../src/model/assembly.mjs) derives configuration; the renderer consumes
the same geometry. Do not select material or forces by name, role or fixture identity.

Worked example: wheel diameter changes radius while keeping axle position and width.
Trace `partPrimitives`, then read [wheel diameter tests](../../test/wheel-diameter.test.mjs)
and [assembly tests](../../test/assembly.test.mjs). Check schema rejection, material/mass,
endpoints, resize overlap, Undo and save/load, then rendered geometry. Rebuild generated
validation with `node scripts/generate-schema.mjs` when schema changes.

A Ball uses canonical sphere radius on all axes and solid-sphere mass/inertia.
Long launcher controls are partitioned into [launch and energy](../../test/ball-launcher.test.mjs#source),
[side-guide retention](../../test/ball-guide-retention.test.mjs#source) and
[catcher repair](../../test/ball-catcher-repair.test.mjs#source) files. Test bodies,
physical durations and the per-file watchdog are unchanged.

Follow [sphere controls](../../test/ball.test.mjs#source) through free placement,
resize and history; curved solids need narrow-phase placement against box corners
and the canonical cylinder hull. Balls have no planar mounting regions or ports.
The optional `authoredContact.body` fields retain material defaults when omitted;
reset removes an override rather than freezing the current material value. Admission
canonicalizes empty contact records without changing explicit zero or mutating the input.

The 12T and 24T spur gears use solid root cylinders for collision, inertia and
material selection, with separate fixed pitch radii for transmission. Painted radial
marks depict body rotation without pretending to collide as teeth. The
[gear compiler](../../src/model/gear-mesh.mjs) admits explicit meshes only between
independently revolute-supported rotors on one rigid carrier: a forest of at most
eight edges. Limited bearings and extra non-revolute rotor supports reject. A mesh
neither snaps nor provides shaft support; ordinary Connect/Disconnect and history
remain the editing owners. Preserve the [authoring controls](../../test/gear-authoring.test.mjs)
when changing admission.

## Add a command

<!-- doc-review {"version":1,"fingerprint":"c742457e58eded3890b2e70615181375ce572b6ae6c8d365d2e1354b811a41ef","dependencies":"docs/development/.reviews/recipes/add-a-command.json","dependencyDigest":"0b2206365b7cb7ad062d7dfb94bf5761f8afdd20c59ce33874548185183c11aa","disposition":"still accurate","rationale":"Session and observation changes add diagnostic timings after completed simulation work; core shape validation, candidate compilation, atomic command history and rejected-edit effects are unchanged, preserving the surface-mount example and controls."} -->



Start at [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop). Validate shape before reading
untrusted fields, copy accepted inputs, derive a candidate through model operations,
and publish only after successful compilation. One accepted edit owns one history
transaction; stale/no-op/rejected effects must be explicit.

Worked example: `surface-mount` delegates to [proposeSurfaceMount](../../src/model/assembly.mjs#symbol=proposeSurfaceMount).
[Surface mount tests](../../test/surface-mount.test.mjs) exercise stale cursor rejection,
mounting, adjustment and Undo. Add malformed input, accepted effect, rejected-state
identity, Undo/Redo and save/load cases through `core.act`. Reuse the [editing contract assertions](../../test/contracts/editing.mjs) as shown by [mixed editing examples](../../test/editing-contracts.test.mjs); inspect
`node scripts/explain-invariant.mjs rejected-edit-atomicity`.

## Change an interaction

<!-- doc-review {"version":1,"fingerprint":"2db42b4ea010dc6f341a571ba31fde3c270359d772b3fa3d332aebe32ae1177c","dependencies":"docs/development/.reviews/recipes/change-an-interaction.json","dependencyDigest":"a6438503af3ded01072ffca72faba88eaddc716257f62752434f0438dda3632c","disposition":"updated","rationale":"The recipe now names both help interaction and catalog inspector checks. All seven scenario bodies and viewports were preserved, with separate artifacts and unchanged watchdogs; ordinary input ownership and user behavior assertions remain."} -->

First apply the [UI and content policy](ui-ux.md#before-changing-player-facing-ui).
Identify the player task, primary home, visibility/retrieval lifecycle and replaced
surface. Keep consequential state visible and verify unique actions remain reachable
after removing or moving controls.


Start with [surface controls](../../src/presentation/surface-controls.mjs) or
[editing controls](../../src/presentation/editing-controls.mjs), composed by the view.
Keep preview and pointer ownership in presentation; commit through the existing core
command. Cancellation must terminate the owned operation without committing it.

Worked example: [mirror controls](../../src/presentation/assembly-mirror.mjs) call the
same model proposal used by the core. Test preview isolation, blocked release, Escape,
blur/lost capture and stale completion. Run [mirror model tests](../../test/mirror-assembly.test.mjs)
and the registered [mirror browser verifier](../../scripts/verify-mirror-browser.mjs#implementation).
The verifier link covers its implementation; execute it against the current served build to obtain behavioral evidence.
Receiver overrides must use [vehicle controls](../../src/presentation/vehicle-controls.mjs),
not dispatch a second reset or directly write actuator state.

For reading controls, share [help input containment](../../src/presentation/part-help-input.mjs)
between window capture and workshop shortcuts before handling surface/mirror keys.
Preserve native navigation inside the help panel and release held receiver commands
through vehicle controls on focus entry. Keep static help independent of selection,
mode, frame refresh and authored history. Pointer focus must not open a tooltip
between press and release and intercept placement. Place connection diagrams before
text instructions in the How to connect tab of the nonmodal reference window.
Keep the title bar and tabs available while content scrolls; clamp dragging and
resizing to the viewport. Keep the small info control visually inside the placement
card while retaining sibling buttons in the DOM. Restore a hidden opener by opening
its containing disclosure before focusing it. Preserve palette eligibility through
[part palette](../../src/presentation/part-palette.mjs); supported loaded types still
need [help content](../../src/presentation/part-help-content.mjs). Use the
[part help browser check](../../scripts/verify-part-help-browser.mjs#implementation)
for dragging, expand/restore, tabs, capture, authoring Escape, mode availability
and reflow, and the [catalog inspector check](../../scripts/verify-part-help-inspectors.mjs#implementation)
for every supported part. Both partitions retain their own watchdog and artifacts. Assert actual scroll movement as well as absence of
workshop edits when reading keys start on the fixed heading. Verify close/reopen
preserves tab and scroll, switching types resets the page, and every supported
loaded type has a decoded help thumbnail without changing palette membership. The
[window browser check](../../scripts/verify-part-help-window.mjs#implementation)
uses the real help owner in an isolated browser fixture to verify native resizing,
exact restoration, drag cancellation, rendered endpoint geometry, actual browser
zoom through a test-only extension, and listener/observer disposal across remounts.
Its empty thumbnails also exercise readable labels without images. Use
[example admission tests](../../test/part-help.test.mjs) for ordinary diagram endpoints.

## Add a diagnostic

<!-- doc-review {"version":1,"fingerprint":"061d54b22a01c6e3246d8d5c8464abeab0edf3857f4290a38dc25fac9b369e44","dependencies":"docs/development/.reviews/recipes/add-a-diagnostic.json","dependencyDigest":"e694a2241100261b7377c2e245c740cc51e6c3792f379bc78fc78a698d917370","disposition":"still accurate","rationale":"The new frame-construction attribution reads diagnostic timing and does not change motion or controller diagnosis. Completed observation ownership, causal uncertainty, separate history, and measurement sampling remain the prescribed diagnostic path."} -->



For motion explanations, start at [diagnoseMotion](../../src/model/motion-diagnostics.mjs#symbol=diagnoseMotion). Consume completed
observation values only. Return an explanation and relevant part IDs; presentation
owns navigation and wording layout. Do not repair authored state or infer intention
from a machine name.

Worked example: opposing-drive diagnostics identify command-adjusted axes on a shared
assembly and suggest checking direction. Read [opposed-drive tests](../../test/opposed-drive-diagnostic.test.mjs)
and [motion diagnostics tests](../../test/motion-diagnostics.test.mjs). Include a real
symptom, a similar valid configuration that must remain quiet, and missing-data cases.
A symptom is not proof of the intended mechanism or cause.

For controller decisions, use [completed decision projection](../../src/model/controller-decision.mjs)
and [application history](../../src/application/controller-history.mjs). Keep diagnostic
fault records separate from teaching rows and retain the historical source; returning
to Build for repair must not reinterpret old observations with a new program.

Selected-body Measurements uses the [numeric accumulator](../../src/model/motion-readout.mjs)
and [presentation lifecycle](../../src/presentation/motion-readout.mjs). The application
feeds every completed observation delta through a separate cursor; rendering cadence
never supplies acceleration samples. Label the RMS of 100 ms-average vertical
acceleration, selected body and window. Gaps invalidate the result; selection and
session identity changes start a visible new window. Preserve the existing boundary
warnings when requested measurements close.

## Change physics

<!-- doc-review {"version":1,"fingerprint":"27d2a20ee8e8d91d45d7c577a430aa0c3a28401e7aee618f97402fc1058e1564","dependencies":"docs/development/.reviews/recipes/change-physics.json","dependencyDigest":"bb77467145a30afa4ae9a37dc84520ceeacec91b75aea8e5c8d7d01cd9053447","disposition":"still accurate","rationale":"Session still constructs and publishes the same completed state after one integration; frameMs only separates a measured cost. Gear measurement adds attribution while retaining loaded apparatus durations, physical assertions and absolute budgets, so all numerical and authority requirements here remain binding."} -->



Start at the [narrow door](../../src/simulation/physics/world.mjs), with numerical laws
under [motor law](../../src/simulation/physics/law/motor.mjs) or
[constraint law](../../src/simulation/physics/law/constraints.mjs) and
[spring law](../../src/simulation/physics/law/spring.mjs). Configuration comes
from the compiler; laws receive numerical inputs, not identities. The session owns
phase ordering and one integration; do not introduce a second clock or hidden support.

Worked example: a motor-work change needs independent energy accounting in
[impulse energy tests](../../test/impulse-energy.test.mjs#implementation), shared-body controls in
[shared power tests](../../test/shared-power.test.mjs#implementation), checkpoint-next-step tests in
[session tests](../../test/session.test.mjs#implementation), and deterministic multi-process checks.
Use analytical expectations and passive mirrored controls before tuning a controller.
For guided springs, preserve five constrained degrees of freedom, simultaneous
coupled damping, solver-integrated elasticity, bounded frequency/topology admission and
signed integration/contact residuals. [Topology admission](../../src/simulation/physics/spring-topology.mjs)
uses authored fixed connectivity and ground, never approximate row deletion. Dependency
changes follow the pinned [spring/contact build recipe](../../vendor/rapier-contact/README.md);
retain loaded sag, coupled energy, completed-tick stop bounds and native motor restore controls.
The physics door freezes four temporal subdivisions and thirty-two internal projected
Gauss-Seidel passes. Contact impulses can otherwise leave substantial constrained
axle velocities after the joint solve. Preserve the passive settling and free-axis
controls when changing this accuracy setting; more passes cost simulation time and
rendering quality reductions cannot compensate for that cost. These finite
convergence checks do not establish convergence for arbitrary assemblies. The launcher
uses the existing 0.4 m rest-length limit after assembly at 0.175 m, storing
7.59375 J at 300 N/m. Its steel projectile and ordinary geometry remain shared
across Ball and wheel variants. Preserve the independent spring-source allowance,
quiet controls and catcher repair witnesses when changing that authored preload;
also recheck the isolated roller impact speeds against the larger stored energy.
Native factor reuse is limited to a fixed-pose biased iteration batch. Preserve
fresh velocity/impulse right-hand sides, limit solving and residual refinement on
every pass, and discard factors before integration or an unbiased refresh.
Changing that lifetime requires exact cached/uncached state and cold-restore controls.
Tree and cyclic original-equation residual checks share a coefficient-weighted
minimum-subnormal rounding allowance in addition to the existing relative bound.
Preserve ordinary-scale inaccurate-residual and nonfinite rejection, plus actual
native stepping and restore controls at gradual underflow. This numerical error
bound does not clamp velocities or replace the original equations.
The session reuses copied post-integration body and energy samples only while
subsequent phases leave native physical state unchanged. If structure or thermal
work starts mutating bodies, resample after that mutation before publishing or
accounting for energy; do not reuse a stale completed sample.
The [owned native response](../../src/simulation/physics/native-response.mjs) shares f64
rows with integration and supports cyclic components and unbounded bilateral components without an active spring. Preserve finite motor impulse budgets on the bounded fallback path. The native source also preserves GJK previous-simplex witnesses, support-bound/direction pairing at vanishing-simplex exits, distinct contact geometry and the coupled Coulomb impulse-disk optimum; retain their wrong-witness, near-tangent cylinder ordering/rotation, duplicate-contact, anisotropic-friction and loaded fixed-chain controls. The near-boundary classification retains the existing tolerance but applies it to additional zero-simplex exits; it does not qualify all floating-point geometry. The [independent complete-tick
reference](../../test/spring-reference.test.mjs#implementation) checks frozen high-precision fixtures;
it is not a universal interval theorem. [Reaction-work controls](../../test/constraint-work.test.mjs#implementation)
check signed constraint work independently of motor funding and heat.
[Ordinary suspension journeys](../../test/suspension-journeys.test.mjs#implementation) exercise
loaded manual authority and previous-tick travel regulation; [launcher controls](../../test/spring-journeys.test.mjs#implementation)
require actual contact retention, release, powerless/jammed controls and replay.
The [release energy oracle](../../test/launcher-energy.test.mjs#implementation) counts positive
motor/reaction work, each body's gravitational drop and independent rotational
plus translational energy; quiet controls alone do not prove spring causation.
[Contact-speed controls](../../test/physics.test.mjs#implementation) exercise actual roller shapes
in isolated low/high-speed collisions, not every complete launcher configuration.
Use [spring physics controls](../../test/spring-physics.test.mjs#implementation) and
[checkpoint/editing controls](../../test/spring-playground.test.mjs#implementation), including reversed
connection order and pre-swap rejection of invalid derived history. Off-center controls
compute total angular momentum as orbital momentum plus world-rotated box inertia
times angular velocity, with centered, rotated and independently reordered bodies,
joints and endpoints. Preserve both the tight two-body impulse and accumulated
chain checks; checking linear momentum alone misses lost moment arms.
Exercise production spring preparation before passive projection. The
[powered hinge controls](../../test/powered-hinge.test.mjs#implementation) compare predicted and
applied speeds, independently compute impulse work, and cover nonzero initial
velocity, compression/extension, depleted power and checkpoint continuation.
Spring preparation must not mutate bodies; motor allocation includes the predicted
coupled damping impulse, and actuator application consumes that allocation before motor
impulses. Elasticity is resolved inside the four native subdivisions. Preserve zero-stiffness axial freedom, tiny-stiffness force controls and
long-duration discrete modified-energy bounds. Loaded spring/contact equilibrium needs
its separate analytical ground-supported controls; isolated oscillator checks do not
establish suspension mounting, individual wheel load equality or controlled behavior.
The [dependency recipe](../../vendor/rapier-contact/README.md) binds the bounded spring
and read-only contact patch, artifact and upgrade/removal requirements.

Completed contact data comes from the [numeric reader](../../src/simulation/physics/read-contacts.mjs).
Use independent momentum/load expectations, current-interval availability and canonical
signed pair impulses; friction groups are counted once. Pure twist is not total angular
impulse, and geometric contact alone does not establish support. Exercise invalid data
and overflow through native callbacks as well as mocks: return through wrapper cleanup
before rethrowing a collection failure. Empty manifolds have no normal to validate,
but their unavailable solver state must remain visible. Readback optimizations must
preserve complete canonical samples and native snapshot/next-step identity. Contact
filtering excludes only bodies connected through authored fixed joints, including
transitive paths. It preserves separate grounded groups, articulated paths and
external supports. The private event queue enables the native hook entry point;
collider hook flags participate in snapshot plant admission. Older byte snapshots
without these flags reject rather than silently changing continuation semantics;
authored blueprint saves remain loadable. Validate loaded support
and energy because removing redundant self contacts also removes their numerical
damping. Sensors reuse the immutable previous completed body snapshot before queued
commands apply; publication admits that body root once while copying new sensor data.
The [suspension contract helpers](../../test/contracts/suspension.mjs#implementation) share signed
100 ms support, pin-frame and finite clearance oracles across the registered journey,
regulation and load tests. The active bench's 0.26–0.33 m target and manual sweeps do
not qualify arbitrary guide travel or pin angles. Its declared 10 N laboratory load
uses ordinary recorded external impulses, separately from the three authored material
cases. Preserve external-work accounting and the 2 s acquisition/3 s hold test;
never move a mounting point or change mass invisibly to manufacture disturbance recovery.

The [gear law](../../src/simulation/physics/law/gear.mjs) solves compliant tangential
mesh impulses together by backward Euler using native bilateral mobility. Equal and
opposite impulses act at the same world pitch point, including carrier reactions.
The [numeric admission](../../src/simulation/physics/gear-topology.mjs) independently
checks support geometry. Meshes join solver islands but create no native bearing.
Session applies mesh impulses after motors and before the single native integration.

Completed geometric slip supplies the next elastic strain. Its correction from the
pre-integration predictor adds signed numerical elastic work, separately from
physical damping, backward-Euler loss and signed bilateral reaction work. A native
contact occurring after the mesh solve can contribute this split error; a closed
energy ledger alone does not prove passivity. Preserve absolute strain and per-step
split bounds, independent passive/gravity/contact energy envelopes, and snapshot
validation of all mesh memory before swapping live state. The [gear runtime controls](../../test/gear-physics.test.mjs)
cover finite ratios, load tradeoffs, carrier momentum and restore; the scalar law's
energy identity is not a whole-machine qualification. This is a bounded compliant
transmission, without backlash, tooth collision or moving-centre planetary support.
Abrupt impacts can exceed the per-step split bound even below the elastic strain
limit. Runtime rejection reports `GEAR_MOTION_LIMIT` with support, current and
grounded-restart guidance; it is a simulation limit, not simulated tooth breakage.
The [capacity controls](../../test/gear-capacity.test.mjs) retain a coupled eight-mesh
chain and reject a ninth independently supported mesh. The registered exclusive
[gear measurement](../../scripts/measure-gears.mjs#source) runs finite 60-second loaded
12/34-body apparatuses and repeated zero/one/eight-mesh timing controls against
the existing 120 Hz tick and phase budgets. These simulation measurements do not
qualify browser cadence or arbitrary larger machines.

Run the actual gate; a workshop smoke pass does not qualify a Course bar.

[Sphere physics controls](../../test/ball-physics.test.mjs#source) cover analytical
fall/rolling, combined restitution, impact checkpoint continuation and fast contact.
The door enables native full sweeps for dynamic spheres against ordinary targets;
other full-sweep bodies are excluded by the vendored algorithm. This does not
qualify arbitrary high-speed sphere-to-sphere impacts. Solver linear slop is capped
at one tenth of the smallest sphere radius, leaving sphere-free scenes at their
native tolerance. Temporal subdivisions remain unchanged; snapshots bind sweep
settings and slop. Re-run existing contact/constraint cases when changing this policy.

## Change multi-part authoring

<!-- doc-review {"version":1,"fingerprint":"eab6cfa85d5242d7ebc5689d8d5f0ddd7d39086e451f1632bd9cf27a4e1ca621","dependencies":"docs/development/.reviews/recipes/change-multi-part-authoring.json","dependencyDigest":"14c04cbb58330a8cd2fb2d232edee5ac86623c8254c434dc74e58ce4a158e66d","disposition":"still accurate","rationale":"Observation timing and shared browser lifecycle instrumentation do not change copied graph membership, reference remapping, assembly persistence or atomic commands. The listed assembly journeys and rendered/completed comparisons remain required."} -->

Start with [connection graph](../../src/model/connection-graph.mjs): mechanical membership
means fixed/shaft/spring connectivity, not an editor selection, electrical network, or stored
library group. Classify a selection's internal and crossing connections before choosing
which edges an operation may copy. The classifier reports facts; the operation owns
whether a crossing edge is omitted, rejected or explicitly rebound. Mount admission
must retain its stricter aligned-edge eligibility when testing alternate support paths.

Authored references include travel `springBinding` and encoder `jointBinding` connection IDs, and a legacy paired sensor's `targetBinding` part ID. Copy and mirror operations remap bindings to copied internal connections/parts and clear bindings when the referenced object is omitted. Installed learning feature definitions remain tied to named channels, never array position. Regulator sensor association comes
from ordinary wiring. Check these references alongside endpoint remapping so an
otherwise valid copy cannot silently measure the source machine's spring.
Environment belongs to the receiving blueprint, not a captured assembly. Preserve
that preset during insertion and validate placement against its canonical obstacles.
The guided-wheel and [pin-ended strut](../../src/model/fixtures/articulated-suspension.mjs#symbol=createPinEndedStrut)
modules are ordinary assembly captures. Their named external mounts must work through
normal connection commands after insertion, save/load and proper rotation; retaining
port labels alone does not establish physical connectivity. New external mounting
arrangements require their own clearance checks.

Use [rigid frame math](../../src/model/transforms.mjs) for translations and proper rotations.
[Mirror proposals](../../src/model/mirror-assembly.mjs) separately own reflection and
reference-mount policy. Never substitute reflection for rotation or use authoring pose
helpers to move live physics bodies. Compile the whole candidate before publishing a
single command/history transaction. Keep previews outside completed authored state.

Reuse [copied-graph assertions](../../test/contracts/copied-graph.mjs) with explicit part
and connection maps. They check authored fields except ID, name and pose, internal endpoint
remapping, fresh identities, existing-record preservation and nested object isolation.
Assert names and transformed poses separately. Capture the input before calling the
operation and compare it afterward: a post-call source alone cannot prove the operation
did not mutate its input. This oracle
expects internal endpoint frames unchanged: operations that transform those frames need
independent geometric expectations rather than disabling the topology checks. Explicitly
allowed crossing edges still need caller assertions for destination and geometry.
Use [actual mirror examples](../../test/copied-graph.test.mjs) for repeated copies, separate
instance edits, Undo/Redo and save/load; include lost fields, aliasing, dangling/misbound
connections and accidental external links as wrong controls.

Reusable composition now uses [model proposals](../../src/model/reusable-assemblies.mjs)
and the optional strict `assemblies` field in the [save schema](../../src/model/blueprint.schema.json).
Groups are disjoint editor membership, with one-to-one named ordinary endpoint aliases;
they never participate in mechanical traversal or the numerical compiler. Explicit group
move/rotate commands include each member's mechanical component. Named mechanical
connections use existing snap policy, then move the remaining editor members through
the same rigid frame. Named surface connections open the existing surface preview
with the selected alias and receiver; offsets and rotation remain player-editable.
Its `assemblyId` scope moves disconnected editor members as well as mechanical
components, using the same model proposal for preview and commitment. Electrical connections never move parts. The usual whole-candidate
compiler still rejects intersections, unsupported connections and occupied ports.

The [library adapter](../../src/application/assembly-library.mjs) validates a definition
as a self-contained blueprint with exactly one complete group. Capture preserves
internal edges and discloses omitted crossing edges. Insertion allocates fresh part
and connection IDs and copies all authored values, including receiver key bindings.
Identical keys can intentionally operate several receivers; the
[assembly panel](../../src/presentation/assembly-library.mjs) shows bindings and opens
the ordinary inspector to edit one receiver. Library items are independent snapshots with distinct generated names, editable saved
names and inspectable authored settings. Placed instances use the contextual inspector and machine picker; saved items use
a bounded requested browser with real mesh thumbnails and retained search. Built-in
definitions are injected by the application and displayed alongside personal saves;
collection filtering does not change storage. A free
insertion preview owns world precision and explicit confirmation, then named mounting
uses its separate surface transaction. Stale source or cursor requires revalidation;
uncertain replies reconcile only with the complete observed insertion result. The
preview never writes a part transform before the ordinary command.
Connection choices show named assembly interfaces before ordinary endpoints.
Storage failure must remain visible and preserve previous library data; it must not
roll back an already accepted machine edit or silently discard the stored library.

Deleting a part removes its aliases/membership and deletes empty groups. Other edits
must preserve endpoint validity or fail. Library edits are outside machine Undo, while
create, edit membership/interface, insert, group transform, alias connection and ungroup are ordinary atomic
commands. New copies get distinguishable names. A machine save contains its parts,
connections and aliases without requiring its source library. Nesting, linked updates,
parameter exports and assembly-aware mirroring are not provided; existing mirror
commands remain ordinary part-copy operations.

Use [assembly transaction and wrong-input tests](../../test/reusable-assemblies.test.mjs),
[library failure tests](../../test/assembly-library.test.mjs) and the registered
[assembly browser flow](../../scripts/verify-assemblies-browser.mjs#implementation).
The browser flow creates an articulated mechanism, places it, connects its named
Power port to a real cell, compares rendered transforms with completed observations,
and checks Undo/Redo, save/load and removal of its source library item. These are
construction checks, not human acceptance or locomotion qualification. The registered
[assembly UX browser check](../../scripts/verify-assembly-ux-browser.mjs#implementation)
and [assembly continuation check](../../scripts/verify-assembly-library-browser.mjs#implementation)
together cover insertion selection and member shortcuts, Build-only repeat placement,
rename focus, narrow-screen sorting, offset mounting with an intact shaft, in-place interface edits, decimal
receiver tuning, saved settings, named targets, bounded navigation and diagnostic layout.

## Change a presentation overlay

<!-- doc-review {"version":1,"fingerprint":"6817b0de76a1a59ba9e4d7640751336fd603541ad559a28c3af35de2915f3e66","dependencies":"docs/development/.reviews/recipes/change-a-presentation-overlay.json","dependencyDigest":"ee114a3c6cfc2b4ba471f7ff72381c779999e2b4341e4975413bf7563da8036f","disposition":"still accurate","rationale":"The changes affect diagnostic frame timing and verifier resource cleanup, not overlay geometry, wiring visibility, picking, coil buffers or completed transforms. All spring physical/render budgets and environment qualifications remain unchanged; timing attribution does not relax them."} -->

Start with [connectionRenderSpecs](../../src/presentation/connection-render.mjs#symbol=connectionRenderSpecs) and
[ConnectionRenderSpec](../../src/presentation/connection-render.d.ts) for the existing
connection overlay. The checked producer takes narrow display inputs; the checked
[connection renderer](../../src/presentation/connection-view.mjs) owns GPU resources.
The workshop view resolves endpoints from displayed meshes, including exploded offsets.
The renderer never changes authored connectivity or sends a command. Visibility is an
explicit required field. Normal electrical links use straight schematic lines; fixed/shaft mechanical
geometry and exploded dashed styling retain their existing behavior. Gear meshes
use dashed relationships without a solid supporting rod; their root-cylinder
marks follow completed body transforms. Preserve the [gear rendering controls](../../test/gear-view.test.mjs).

Use exact IDs from [connectionTestPaths](../../src/model/connection-test-paths.mjs#symbol=connectionTestPaths) for
path highlights. The [Connect & test panel](../../src/presentation/connection-test.mjs#source)
owns both the highlighted row and a separate reveal of its currently displayed paths
while open. Row pointer leave clears highlighting, but closing the panel, changing
selection, removing the target and disposal clear reveal as well. An edge
between two highlighted parts is not necessarily on the inspected path. Selection,
tracing and exploded display state keep their existing owners; compose their inputs
instead of copying them into another mutable store.

[Wiring preferences](../../src/presentation/connection-render.mjs#symbol=createWiringPreferences)
belong to the mounted view: Build defaults on, Run/Paused off, replacement preserves them,
and remount resets them. They stay outside blueprints, commands, Undo, checkpoints and
replay. The checkbox reflects this preference. The producer unions exact trace edges,
open-panel path edges and edges incident to the wiring source endpoint; ordinary selection
only highlights. Exploded reveal includes its closing transition. The inspection notice
appears only when these overrides reveal otherwise hidden electrical links. Updating
while paused must use existing scene invalidation. Hidden resources must be excluded
from picking through `pickableObjects`, retain their geometry, and update their endpoints
before reappearing. Do not put visibility in the geometry cache key.

Run [renderer/resource tests](../../test/connection-render.test.mjs#implementation),
[resource retention tests](../../test/presentation-resources.test.mjs#implementation),
[diagnostic path tests](../../test/connection-test-paths.test.mjs#implementation), and boundary type checks.
Wrong controls must catch missing visibility, non-path highlights, hidden ray hits and
changed graph/poses. For UI toggles, compare completed simulation
projections with identical authored data and input traces across the toggle, and exercise
paused updates, cancellation and remount cleanup through the shared browser harness.
Use existing registered connection-test/exploded browser checks and the interaction
probe for visible versus structured state. A view toggle is not an editing transaction;
do not route it through authoring just to reuse Undo tests.

The [guided coil renderer](../../src/presentation/spring-view.mjs) retains its vertex
buffers and fixed wire radius while following completed endpoint transforms. Selection
adds zero-force and travel marks. Decorative geometry has no physics authority.
[Spring rendering controls](../../test/spring-view.test.mjs) cover travel, disposal and
endpoint readback derived from actual tube-ring vertices and mesh world transforms;
the registered [spring browser probe](../../scripts/verify-spring-browser.mjs#implementation)
checks numeric controls and completed/rendered body and coil endpoints, while the
[performance probe](../../scripts/verify-spring-performance.mjs#implementation)
enforces the [spring performance policy](../../scripts/measure-springs.mjs#source)
at zero, one and eight springs; 32 must reject without changing state. Three
counterbalanced repetitions follow 240 simulation ticks or 60 browser frames of
warmup. Each repetition must pass: complete tick p95 at most 3.333 ms (40% of
a 120 Hz tick), actuator/constraint p95 at most 2 ms, renderer CPU submission p95
at most 6 ms, frame cadence p95 at most 40 ms (30 Hz with 20% scheduling margin),
no stall above 500 ms, and simulated/wall time ratio from 0.95 to 1.05.
Dense one/eight-spring trials and connected 22/34-body trials require integration/contact
p95 at most 2 ms. Phase caps are independent ceilings, not additive allocations: the
complete tick must still fit 3 1/3 ms, including all other phases and overhead.
Passing a phase cap never excuses a whole-tick or browser failure. The connected
workloads cover zero/one/eight springs plus fixed links: 22 bodies retains the earlier
four-wheel baseline; 34 retains the one-spring/32-fixed-link counterexample that exposed
dense solver scaling. All 36 simulation cases must pass; fixture geometry and topology
are checked, so removing connected bodies cannot improve a qualifying result. These
sizes do not qualify larger assemblies, including the current 44-part sprung/rigid comparison. In each dense loaded-contact trial, every intended moving
body must carry a signed upward floor impulse of at least 0.040875 N s (half its known
1 kg weight impulse; the extended spring presses down too). Missing bodies, unrelated
pairs and reversed directions cannot satisfy this workload check. It is not a general
suspension support threshold.
Node phase timings isolate simulation; browser renderer timing is CPU submission,
not GPU time, so cadence is enforced separately. Before/after visible idle controls
require p95 at most 20 ms; empty zero-spring Node ticks require at most 1.042 ms.
Connected zero-spring worlds retain the 3.333 ms whole-tick budget.
Environment failures do not relax budgets. Reports retain raw samples, CPU, browser,
GPU renderer and source identity. This spring benchmark requests native Metal on
macOS because the headless default can select software rendering; other platforms
retain their default backend and the same budgets. Repeat on supported target hardware for hardware
qualification. [Budget controls](../../test/spring-performance.test.mjs#implementation) exercise
limits and incomplete/unhealthy trials. Replacement probes also bound retained
geometry, textures and heap.

### Adaptive graphics

<!-- doc-review {"version":1,"fingerprint":"a5eb8d66c231e6cd1c0280c00bdb54472bc064c9b860d639984c7aba7da69c23","dependencies":"docs/development/.reviews/recipes/adaptive-graphics.json","dependencyDigest":"70dab5f60156fb50dcd2c931dbfa28f3d93e9d76e81d943f65c9d300847c0882","disposition":"still accurate","rationale":"Only the native dependency changed; graphics quality levels, thresholds, resource lifecycle and independence from simulation remain unchanged."} -->

The [graphics quality owner](../../src/presentation/graphics-quality.mjs#source)
receives visible rendered-frame timings only. It starts at full fidelity and uses
45-frame p95 windows after warmup. Above 35 ms it lowers one level; recovery needs
eight windows below 20 ms and at least 30 seconds since a downgrade. Idle and hidden
frames reset the evidence window. This avoids treating a hidden tab as slow hardware
or an idle machine as recovery evidence. The owner never receives a blueprint,
controller, GPU name or simulation object.

Full quality retains antialiasing, the original pixel-ratio cap and 2048-pixel
shadows. Lower levels reduce shadows first, then canvas resolution, with a 40%
resolution floor. Once shadows are off, the complete scene renders into a retained
single-sample target and then onto the original canvas, avoiding per-triangle
multisampling cost. Recovery releases that target and resumes direct rendering.
The final 50% to 40% step
reduces pixel work by 36%, leaving the full scene present while sacrificing fine detail.
DOM controls, authored geometry, picking, simulation rate and completed observations
remain unchanged. Shadow enable/disable refreshes shader variants; old shadow targets
are released. Resize uses the current scale without changing CSS coordinates.
No permanent panel or action is added; the existing 3D view owns this behavior.

The [graphics controls](../../test/graphics-quality.test.mjs) cover full startup,
stepwise reduction, delayed recovery, idle/hidden rejection and shader/resource
transitions. The [browser check](../../scripts/verify-adaptive-graphics.mjs#source)
uses actual Metal (on macOS) and SwiftShader WebGL fallback, verifies unchanged
blueprints, real-time stepping, visible scene pixels, resized canvas dimensions,
and the existing 40 ms cadence budget after warmup. Quality reduction cannot promise
that every machine or competing workload meets that budget; failure remains failure
at the minimum level. Agent screenshots are not target-player acceptance.
