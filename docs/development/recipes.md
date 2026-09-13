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

<!-- doc-review {"version":1,"fingerprint":"021583b8540bb143cdd0e861a4a4e587ef486ace2a57a6dbb2e077ae342a5f86","dependencies":"docs/development/.reviews/recipes/add-or-extend-a-part.json","dependencyDigest":"9d22c0c23d4a38d8312ec9f4c4ffd1656a091c039fe1027bcc73facc5b5af9d1","disposition":"updated","rationale":"The recipe includes ordinary two-face occupancy, compiler-derived sensor bindings, supply invalidity and explicit presentation vocabulary coverage. Construction, Rules force-stop and copy/Retry journeys remain registered browser checks using existing authoring commands."} -->

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

The Load Cell has one ordinary rigid body and full-face A/B mounting regions.
Its [search vocabulary](../../src/presentation/part-search.mjs) places it in Sensors
and supports force/tension queries. Preserve the existing all-catalog coverage
check when adding a part so discovery cannot omit a newly admitted type.
[Blueprint admission](../../src/model/blueprint.mjs) counts each face across both
connection endpoint positions; a second mount on the same face rejects. Partial
assemblies remain legal and report disconnected when powered. The compiler derives
sensor bindings from the actual copied or restored edges rather than storing a second
attachment map. Preserve [authoring controls](../../test/load-cell-authoring.test.mjs)
for endpoint order, alternate offsets, copy/mirror and save/load; exercise history
through the [ordinary construction journey](../../scripts/verify-load-cell-browser.mjs#source).

## Add a command

<!-- doc-review {"version":1,"fingerprint":"af34dfe9af1a153c4d118435f0a3e3652baf1d8df41a243a8415851f7b6b9af4","dependencies":"docs/development/.reviews/recipes/add-a-command.json","dependencyDigest":"407bf5fefa9dafc2dc2de333f29fc60f500b27dda79af68b6c3dce3ad0fce9bd","disposition":"still accurate","rationale":"Load Cell uses existing surface/wire commands and compiler admission; core transactions, rejection, history and candidate publication retain their documented owners."} -->



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

<!-- doc-review {"version":1,"fingerprint":"4ec167a28bf1e0ebef47cf3b5499caf272894965f3b2257beaab10a6b99d0d6f","dependencies":"docs/development/.reviews/recipes/change-an-interaction.json","dependencyDigest":"2a37fee97e684acfe6b71aac4439aaccf0db63a598bc914fa054d4c7431350f5","disposition":"still accurate","rationale":"Load Cell uses the current all-parts preview and ordinary Place part/Done actions, selected inspector and requested help. Search words add discoverability without changing preview, focus, command or cancellation owners."} -->

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
its containing disclosure before focusing it. Preserve catalog eligibility through CATALOG and discovery vocabulary through
[part search](../../src/presentation/part-search.mjs); supported loaded types still
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

<!-- doc-review {"version":1,"fingerprint":"3fced469682729b8cebf80ff8842c09aa2d69b12e42a0f5b3db3a077ad48a7fa","dependencies":"docs/development/.reviews/recipes/add-a-diagnostic.json","dependencyDigest":"627a24c3cad4235923a9368d94c8ff295fd2273a43ad215a2e118edd4b575055","disposition":"still accurate","rationale":"Force displays consume completed observations; motion diagnostics, controller history and measurement accumulation owners remain unchanged and cannot repair physical state."} -->



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

<!-- doc-review {"version":1,"fingerprint":"4ff2a4675de470e056aca22f0c9e77a571badbdf6d282405041b5dbdb6f33af7","dependencies":"docs/development/.reviews/recipes/change-physics.json","dependencyDigest":"cd01b9154b7467e0edcfd5cd621d7978992563a16bed1be60391fbd0010cbcb7","disposition":"still accurate","rationale":"Scope application changes metadata consumer hashes only. The contact verifier now observes ordinary completed ticks and has passed actual-contact reversal plus an impossible-threshold negative control. Geometry, solver, native package, physical authority and existing time budgets are unchanged, so the physics recipe and completed native evidence remain applicable."} -->



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
For attachment force, preserve [independent force and momentum controls](../../test/load-cell-physics.test.mjs)
and [receipt continuation](../../test/load-cell-runtime.test.mjs). The
[dynamic matrix](../../test/load-cell-physical-matrix.test.mjs) repeats moving,
supported-rest and free-assembly cases at production and diagnostic subdivisions;
its angular account includes spin and orbital momentum for the entire free assembly,
not a torque output from the sensor. [Lifecycle controls](../../test/load-cell-lifecycle.test.mjs)
check the first ticks after Retry and repeated unsmoothed threshold crossings with
actual drive stopping and resuming. Native receipts
sum actual applications across the full tick, including warmstarts and temporal
subdivisions. Prepared response queries count only when their result is applied;
probing a response must not contribute force. Test deliberate omission of prepared
joint contributions while retaining identical body motion. Native transient diagnostics
are excluded from native serialization; validated numeric receipts belong to the
physics envelope. Native qualification compares unchanged physical state separately
from diagnostic correctness; its historical adapter cannot qualify force accuracy.

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

The [powered linear controls](../../test/linear-actuator.test.mjs#implementation) and
[mixed-coordinate controls](../../test/linear-actuator-coupling.test.mjs#implementation)
exercise the same electrical allocation and impulse-receipt owners with a zero-stiffness
slide. Keep prepared passive damping in axial speed samples and use generalized mixed
linear/rotary mobility in actual allocation order. Include both anchor moments and
independent linear/angular momentum and full-inertia work checks. Authored maximum speed
caps active drive voltage; external loading can overspeed it, so never clamp velocity.
Completed travel, rather than intermediate drive-kick speed, establishes end-stop or
barely-moving observations. Positive kick work at a stop can be dissipated during native
integration; retain the signed integration ledger and independent complete-tick bounds.
Connection snap length affects the next attachment, not an existing carriage pose.
The [linear browser construction](../../scripts/verify-linear-actuator-browser.mjs#source)
uses ordinary mounting, power and receiver keys, an underpowered lift repair, and
a horizontal slide blocked by an authored obstacle before its end stop. Require
measured face-to-obstacle contact, sustained stall heat, obstacle-removal repair,
reverse motion and rendered endpoint agreement. The [linear clock controls](../../test/linear-actuator-determinism.test.mjs#implementation)
compare four processes and both production clocks, and replay an actual failure bundle
with a missing-input counterexample. Preserve nondefault actuator settings, material
and independent wiring through capture, rotated insertion, mirrored copying and
history using the powered linear controls. These finite controls do not
qualify arbitrary mechanism loads or human acceptance.

## Change multi-part authoring

<!-- doc-review {"version":1,"fingerprint":"88c2eb919bf01d93b8f85b1c6907439fed007f4ef694b026260515e75be94cb9","dependencies":"docs/development/.reviews/recipes/change-multi-part-authoring.json","dependencyDigest":"0419d51ec560db6be9d7055a99e1e9313a83aa1b5fcc5e5f31f4a6fe7fa508d0","disposition":"still accurate","rationale":"A/B sensor bindings derive from ordinary copied edges, with no new stored reference fields. Endpoint remapping, partial-copy behavior, candidate compilation and history retain their owners."} -->

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

<!-- doc-review {"version":1,"fingerprint":"9f08bb0ba97d08fce96a7135b7fde4880c6562e14af83e3c737e111a856136b6","dependencies":"docs/development/.reviews/recipes/change-a-presentation-overlay.json","dependencyDigest":"1c4c728c78dd464dba97c7830912a07f8d7ce2edf9647d54d7cd4a158cf9b62e","disposition":"still accurate","rationale":"The selected sensor arrow uses completed body pose through the existing sensor view; connection overlay ownership, resources, preferences and independent simulation timing requirements remain unchanged."} -->

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

Electrical port hardware is part of the production part mesh, shared with catalogue and
assembly previews. [Surface finishes](../../src/presentation/part-finish.mjs#source)
provide cosmetic material response, subtle roughness grain and a disposable studio
reflection field. Paint is nonmetallic surface treatment; exposed surfaces follow the
authored material. These finishes do not change model material values. [Assembly
thumbnails](../../src/presentation/assembly-thumbnails.mjs#implementation) compose the production connection and spring views at saved authored
endpoints, including their geometry in framing and disposing temporary resources. Palette thumbnails retain their temporary meshes through one synchronous batch so shared shader programs stay available; a `finally` block releases all meshes, the preview environment and the renderer. The main renderer also warms the catalog material and shadow variants once before authoring starts. Those bounded resources remain outside the authored mesh map and completed readback, leave the scene immediately, and are released with the renderer. Surface mounts
use the same model surface resolver as the workshop, retaining saved face offsets and
part rotations; named ports retain their catalogue positions. Powered linear connections use
the retained straight-rod view with guide-to-carriage endpoint ordering in either saved
edge direction; passive springs keep their coil view. Socket collars keep authored endpoint positions;
the housing surface supplies their outward visual normal. Nearest-port spacing bounds
their size. One aperture represents one endpoint regardless of permitted wire count.
Invisible original picking volumes preserve targeting; normal wires add no duplicate
beads. Bright authoring cues also shrink to fit neighbouring electrical endpoints;
exploded markers remain schematic interaction overlays.

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

<!-- doc-review {"version":1,"fingerprint":"5c020cb41bc65900ec5758522204ec9700deaf475862b04a8bdfa82bce18f23f","dependencies":"docs/development/.reviews/recipes/adaptive-graphics.json","dependencyDigest":"5bbf196d6e12f8d8954c91337bd989f215a255407945c8b7671b37ad43369851","disposition":"still accurate","rationale":"Graphics thresholds, timing admission, transitions and minimum-quality failure behavior are unchanged; native diagnostics do not relax simulation or cadence budgets."} -->

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
