# Change recipes

## Choose a recipe

<!-- doc-review {"version":1,"fingerprint":"50a3c278776d149f030eac847b606b484d5adbf6efa78f0544ad88ea19e259a1","dependencies":"docs/development/.reviews/recipes/choose-a-recipe.json","dependencyDigest":"177599667fab239062a46e1223298365ede99269c0b96b349f418d3393eb11be","disposition":"still accurate","rationale":"Coupler integration follows the same owner discovery, focused-test selection and public command admission. Rendering warmup and catalog placement retain their existing owners; the recipe does not grant new attachment, naming, reset or physics authority."} -->

Use the [map](architecture.md#overview) to locate the owner, inspect its reverse consumers with
`node scripts/navigate.mjs <symbol-or-path>`, then use focused tests. Admit changes
through the public command surface. A view-local convenience must not become a second
attachment, polarity, naming, reset or authored-property policy.

Part additions and interaction changes that add or change teaching also follow the
[learning content admission rules](ui-ux.md#learning-content-policy). Record the
admission decision before adding an example or contextual invitation; a new part does
not automatically earn an entry.

## Add or extend a part

<!-- doc-review {"version":1,"fingerprint":"cb2727a0da55ae419366e0ce4873b3d62c04b9fc701093141fc148da4bc46591","dependencies":"docs/development/.reviews/recipes/add-or-extend-a-part.json","dependencyDigest":"9e856acabb5f9290cc627ccad84e46fe5166c078ef3b90366831d0515cd605ad","disposition":"updated","rationale":"The new Load Cell paragraph accurately follows the current catalog, full-face surface regions and strict face occupancy admission across either endpoint order. Search vocabulary supplies Sensors/force aliases; bindings are compiled from ordinary edges, so copies and restored assemblies resolve their own attachments. Partial powered cells remain legal but disconnected. Existing wheel/Ball/gear/coupler examples retain their authored geometry, material and support rules; no part-specific force by identity or extra lesson is introduced. Camera optical-profile/copy-mirror paragraph is retained. Compiler has distinct camera/loadCellSensor/poweredLamp cases; generated schema admits all three through the shared catalog path. Load Cell now participates in shared static sensor coatings: A-to-B/+X front and top markings identify the measuring direction, while the end face labels B and its outward axis. These are identification paint, not force readouts or ratings. Powered Lamp also has ordinary Power-category search metadata with a headlight alias; catalog remains the availability authority. Revalidated after final thumbnail scheduling and spring witness closure: all catalog types still receive shared-mesh thumbnails, including loaded-only parts; discovery and physical catalog authority are unchanged."} -->

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

Release Coupler designates one mounting face with `releaseFace` in the catalog.
[Surface resolution](../../src/model/surfaces.mjs#symbol=resolveSurfaceEndpoint) gives
that face one-fixed-attachment multiplicity and the compiler maps its accepted fixed joint.
Two latch faces cannot own the same attachment. Other mounts and crossing wires retain
their ordinary semantics; a remaining mechanical path can prevent separation.
Rope may share the same face and keeps its ordinary spherical attachment when the fixed
latch opens; it does not become a second releasable joint.
[Release authoring controls](../../test/release-authoring.test.mjs#source) exercise
material choices, conflict rejection and ordinary editing history.

The Load Cell has one ordinary rigid body and full-face A/B mounting regions.
Its static [sensor face markings](../../src/presentation/part-visuals/sensors.mjs#source)
identify the measured B attachment and local +X axis; they display no live force or rating.
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

Camera additions must preserve the [optical profile](../../src/model/camera.mjs#source),
[completed exposure owner](../../src/simulation/camera-state.mjs#source), ordinary
power admission and [copy/mirror controls](../../test/camera-integration.test.mjs#source).
The catalog declares local reflection symmetry; it must not be inferred from a part ID.

## Add a command

<!-- doc-review {"version":1,"fingerprint":"e2b2a2481f3dcefbedd97a143efe6e21da4be7f9b66afb4347754ccb6249cd84","dependencies":"docs/development/.reviews/recipes/add-a-command.json","dependencyDigest":"700a4d6267abc52ef1ba10049ddd37ad25d669999a6a5067c61d2c26f710832d","disposition":"still accurate","rationale":"The full recipe's shape validation, copied inputs, whole-candidate compile and atomic publication/history guidance still applies. Load Cell adds no new command: existing surface mounting, wiring, part insertion, controller installation, copy and history drive its browser journeys. Invalid repeated A/B occupancy rejects before publication through the same core/model admission. Existing surface-mount and editing-contract controls remain appropriate; native receipt changes grant no direct UI state-write path. Camera-photo is retained as Run input with epoch/request admission rather than an authoring transaction. Load Cell and Lamp add no competing command ownership. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements."} -->

Start at [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop). Validate shape before reading
untrusted fields, copy accepted inputs, derive a candidate through model operations,
and publish only after successful compilation. One accepted edit owns one history
transaction; stale/no-op/rejected effects must be explicit.

Worked example: `surface-mount` delegates to [proposeSurfaceMount](../../src/model/assembly.mjs#symbol=proposeSurfaceMount).
[Surface mount tests](../../test/surface-mount.test.mjs) exercise stale cursor rejection,
mounting, adjustment and Undo. Add malformed input, accepted effect, rejected-state
identity, Undo/Redo and save/load cases through `core.act`. Reuse the [editing contract assertions](../../test/contracts/editing.mjs) as shown by [mixed editing examples](../../test/editing-contracts.test.mjs); inspect
`node scripts/explain-invariant.mjs rejected-edit-atomicity`.

Scene edits use `replace-scene` with `expectedCursor`, whole-workshop admission,
and the existing chronological history. The environment controls in
[test/environment.test.mjs](../../test/environment.test.mjs#source) cover legacy
geometry, authored scene identity, aggregate capacity, rejection and continuation.
[Capacity transactions](../../test/scene-capacity.test.mjs#source) use a physically clear
nearly-full workshop and retain Undo through replacement, duplication, import and load rejection.
Combined capacity includes machine bodies, every distributed rope node, compiled scene solids and ground.
[Scene preservation](../../test/scene-preservation.test.mjs#source) covers capture round trips,
legacy visual events, current checkpoint continuation, machine measurements and sensor scope.

The Run-only `camera-photo` request is an input event, not an authoring transaction.
Validate epoch and request ID; accepted IDs deduplicate and a reserved exposure rejects
busy without changing the completed cursor. Bytes and downloads belong to application.

## Change an interaction

<!-- doc-review {"version":1,"fingerprint":"428f4db83366098c36be0e660279a509cbc7ce7e8deb11ead24db8ffeb83ad8c","dependencies":"docs/development/.reviews/recipes/change-an-interaction.json","dependencyDigest":"3bda9394a4d487042a043f357c069c285d23b44abacd701feee71f66d336e07d","disposition":"still accurate","rationale":"Read all interaction/help guidance against unchanged main presentation input owners and Load Cell inspector/help/search additions. New force copy remains in selected sensor/help surfaces, uses current catalog vocabulary and creates no second reset/actuator path. Existing pointer preview, cancel/focus, reference-window state, decoded thumbnails and ordinary command requirements still govern the added part. The package pin's transitive fan-out changes physical build identity, not help interaction semantics or browser evidence requirements. Camera catalog placement restores workshop view; Lamp and Load Cell inspector actions remain ordinary authoring receipts. Existing cancellation/atomic placement requirements are unchanged. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements."} -->

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

<!-- doc-review {"version":1,"fingerprint":"7b2473302ee30b1eb6952e7ce2995ed8be4b517b5037db5a9cc0a56ad0c47521","dependencies":"docs/development/.reviews/recipes/add-a-diagnostic.json","dependencyDigest":"e417c5df20d8ce8293cb23aa84c48ee92662ac96226a04fdd675426c1f4e0614","disposition":"still accurate","rationale":"The recipe continues to require completed observations, relevant IDs, no inferred intention and positive/quiet/missing-data controls. Load Cell readouts use completed reaction evidence and explicitly preserve invalid states rather than estimate payload weight or repair the plant. Decision history and Measurements still have their existing source/interval/selection owners and separate cursors; adding force channels does not turn diagnostic rows into teaching examples or alter RMS acceleration definitions. Camera readiness and Lamp optical delivery are completed telemetry, separate from Load Cell physical force. No part identity becomes physical authority or automatic repair. Revalidated after final thumbnail scheduling and spring witness closure: thumbnail readiness and ordinary graphics induction add no physical diagnostic or alternative sensor writer."} -->

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

<!-- doc-review {"version":1,"fingerprint":"063944039790bf0646b60051025b0ce6a392c95311cb42f47797d67914a608be","dependencies":"docs/development/.reviews/recipes/change-physics.json","dependencyDigest":"a6d3d91ba28497d5392e17bcdaee66d024a7717267bd18bd52e5123bbb2c158c","disposition":"updated","rationale":"The added reaction paragraphs correctly require full-tick native/application accounting, omit unapplied response queries, include applied rope-induced bilateral corrections, and distinguish physical-byte native qualification from diagnostic accuracy. Revised release planning describes snapshot-copy preparation, live joint removal and combined rope ledger validation. The combined Rope/release checkpoint paragraph has now been corrected to physics-envelope version 9, matching world.encode and runtime-v1; session format remains 3. The full surrounding contact, spring, gear, rope, sphere and actuator guidance retains its independent energy/momentum controls, finite domains and unchanged budgets. Mandatory version-9 arrays and the work ledger are admitted as typed values; removing legacy null fallbacks enforces the already-documented contract without changing valid checkpoint bytes. Lamp shared power allocations append after motors/sensors/couplers; Camera and Load Cell remain funded sensor loads. driveDuty preserves linear speed cap because admission forbids linear positionControl. Load Cell completed reactions and version9 envelope remain intact. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements."} -->

Start at the [narrow door](../../src/simulation/physics/world.mjs), with numerical laws
under [motor law](../../src/simulation/physics/law/motor.mjs) or
[constraint law](../../src/simulation/physics/law/constraints.mjs) and
[spring law](../../src/simulation/physics/law/spring.mjs). Configuration comes
from the compiler; laws receive numerical inputs, not identities. The session owns
phase ordering and one integration; do not introduce a second clock or hidden support.

Fixed scene geometry comes from [environment descriptors](../../src/model/environment.mjs#source).
The scene compiler unions matching adjacent boxes instead of exposing internal
coplanar faces to contacts. Retain the frozen [contact controls](../../test/scene-contact.test.mjs#source):
continuous/split trajectories and energy, admitted quaternion rounding and sign equivalents,
raised-seam counterexample, analytical
inclines and separately measured intentional edge drops. These are bounded development
fixtures, not general contact or Course qualification. Render and pick individual
authored descriptors while compiling the same occupied volume; no identity selects physics.

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
probing a response must not contribute force. Rope corrections enter the receipt only
after the admitted rope solve applies its corresponding projected forces. Release
updates completed bridge membership, and checkpoint validation uses each reaction
age's opened-joint topology. Test deliberate omission of prepared
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

Distributed [rope compilation](../../src/model/rope.mjs) appends N+1 massive nodes,
two ordinary spherical attachments and N tensile elements. It preserves total
rho*A*L and series compliance L/(E\*A) under subdivision. Material values are a
nominal braided-nylon model: the inherited density/packing/strength assumptions
are not a calibrated product rating. Effective E=100 MPa and viscosity=100 kPa s
set a one-millisecond Kelvin–Voigt retardation time; native tick error is separate.
Rope node colliders explicitly exclude floor, body and self collisions. Ordinary
support bodies retain their normal contacts. No wrapping, knots or breakage follows
from this collision-free cable domain.

The [nonlinear rope law](../../src/simulation/physics/law/rope.mjs) minimizes a convex
vector-impulse potential, solving direction and positive extension together. Its
native-component mobility includes attachment reactions, without joining disconnected
native graphs through numeric rope edges. Constant forces act during the one native
step; its four subdivisions imply a 5/8 acceleration factor in the endpoint predictor.
Convergence, strength, completed stretch and predicted direction reversal have
explicit limits. A fault reports ROPE_MOTION_LIMIT and retains ordinary Build repair.
Contacts and rotating native constraints remain split from this predictor, so finite
angular-momentum and energy errors require independent apparatus measurements.

Completed native positions own geometry and elastic potential. Applied mean tension
includes damping and is stored in the rope snapshot envelope; elastic tension is a
separate diagnostic. A completed-displacement ledger separates raw constant-force
work, elastic change, nonnegative Kelvin-reference dissipation and implicit geometric
loss, plus signed work correcting the reference to the submitted force. These are
discrete mechanical model terms, not measured heat. The session removes those rope
terms from its signed native integration remainder; projected attachment reactions,
rotation and contacts remain combined in that remainder. Do not label the remainder
pure integration error in a constrained apparatus. The rope snapshot stores the
completed ledger, and restore checks its intrinsic work identity and matching session
energy fields before swapping native state. Preserve [independent ledger oracles](../../test/rope-energy-ledger.test.mjs),
[session restore and failure replay](../../test/rope-session.test.mjs),
[powered actuator pulling controls](../../test/rope-linear.test.mjs),
[independent accounting](../../test/rope-accounting.test.mjs),
[force and restore controls](../../test/rope-receipts.test.mjs),
[analytic and subdivision controls](../../test/rope-physics.test.mjs), and
[both clock drivers](../../test/rope-determinism.test.mjs). Use the
[bounded capacity measurement](../../scripts/measure-ropes.mjs) for sustained ordinary
support contact; this does not qualify arbitrary impacts, duration or hardware.

Run the actual gate; a workshop smoke pass does not qualify a Course bar.

[Sphere physics controls](../../test/ball-physics.test.mjs#source) cover analytical
fall/rolling, combined restitution, impact checkpoint continuation and fast contact.
The door enables native full sweeps for dynamic spheres against ordinary targets;
other full-sweep bodies are excluded by the vendored algorithm. This does not
qualify arbitrary high-speed sphere-to-sphere impacts. Solver linear slop is capped
at one tenth of the smallest sphere radius, leaving sphere-free scenes at their
native tolerance. Temporal subdivisions remain unchanged; snapshots bind sweep
settings and slop. Re-run existing contact/constraint cases when changing this policy.

For a Release Coupler, held positive command and operating voltage accumulate delivered
coil energy; interruption resets progress without refund. Fully funded actuation opens
on the following tick, even after key release. Every joule delivered to the coil is
accounted as heat; it supplies no mechanical impulse. Once opened, it draws no further
energy. The existing Command Receiver provides default W/Up control and optional key
settings. The shared power solve includes the coil alongside motors and sensors.

Release planning evaluates proposed opens in sorted joint order against previously
accepted opens. Gear support must remain valid. Changing a dormant spring into an active
spring is explicitly blocked in this first implementation; remaining active spring
mobility must satisfy the existing frequency bound. Native response requires a complete
component, so preparation uses a snapshot copy with accepted joints removed and copies
only numeric response factors. Commit removes those joints from the original live world,
updates fixed-component contact filtering and rigid-pair response topology, and preserves
all body motion. Wires stay ideal connections with no mechanical support.

Completed snapshots include opened joint indices and the permitted native plant. Restore
cross-checks latch state, joint handles, remaining native constraints, body properties,
gear support and released spring mobility before replacing state. A partially committed
release cannot be snapshotted before integration. Combined Rope/release checkpoints use
the runtime contract's physics-envelope version 9 and validate both opened joints and completed rope
work before swapping native state. Numeric Rope links remain outside the native
response groups; their spherical anchors and ordinary tension remain active after
release. Preserve the [combined tether and restore controls](../../test/release-rope.test.mjs#source),
including wrong-label, missing-ledger and invented-impulse counterexamples.
[Topology controls](../../test/release-topology.test.mjs#source)
cover already-filtered contacts becoming active, retained alternate paths, loaded angular
and linear momentum, external work, articulated/external contact controls, and forged restore rejection. [Session controls](../../test/release-session.test.mjs#source)
cover funding versus changed rotor response, completed checkpoints, and Build recovery;
[independent processes](../../test/release-determinism.test.mjs#source) compare restored per-tick traces under both clocks and exercise recorded-input failure replay with a wrong-projection negative control
and renamed identities. These probes do not qualify arbitrary docking or breakage.

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

<!-- doc-review {"version":1,"fingerprint":"df140236a290158e760193b8d932ec265c19ecbf4ba7471759d25f614fa455d0","dependencies":"docs/development/.reviews/recipes/change-multi-part-authoring.json","dependencyDigest":"3d030db6ae1218654e9942bab620637a239d928da29d8c8bee4ae1e0c970a1dd","disposition":"still accurate","rationale":"The complete recipe still distinguishes mechanical connectivity from stored assembly membership and requires remapped endpoint/reference IDs, ordinary transforms, whole-candidate admission and isolated copied values. Load Cell introduces no stored binding field to remap: its A/B references are recomputed from each instance's remapped surface edges. Thus the existing spring/joint/target binding examples remain accurate without pretending they enumerate every derived measurement. The added copy browser demonstrates independent B attachment behavior through existing assembly creation/insertion, history and save/load; library/UI ownership remains unchanged. Incoming Camera optical reflection-axis paragraph remains consistent with catalog mirrorAxis and mirror assembly; Load Cell mounting bindings still recompile from copied endpoints and Lamp uses ordinary authored copying. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements."} -->

Start with [connection graph](../../src/model/connection-graph.mjs): mechanical membership
means fixed/shaft/spring/rope connectivity, not an editor selection, electrical network, or stored
library group. Classify a selection's internal and crossing connections before choosing
which edges an operation may copy. The classifier reports facts; the operation owns
whether a crossing edge is omitted, rejected or explicitly rebound. Mount admission
must retain its stricter aligned-edge eligibility when testing alternate support paths.

Authored references include travel `springBinding` and encoder `jointBinding` connection IDs, and a legacy paired sensor's `targetBinding` part ID. Copy and mirror operations remap bindings to copied internal connections/parts and clear bindings when the referenced object is omitted. Installed learning feature definitions remain tied to named channels, never array position. Regulator sensor association comes
from ordinary wiring. Check these references alongside endpoint remapping so an
otherwise valid copy cannot silently measure the source machine's spring.
Environment belongs to the receiving blueprint, not a captured assembly. Preserve
that authored scene or legacy preset during insertion and validate placement against its canonical obstacles.
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

Camera mirror admission uses the catalog local reflection axis to preserve the +Z
lens frame. The generic copied-graph contract still owns authored material and wiring
preservation; test optical orientation independently of the production frame helper.

## Change a presentation overlay

<!-- doc-review {"version":1,"fingerprint":"9b121d753f96f1c2e4d17b35998b1725a18a542f897e3635aadfe846b6441280","dependencies":"docs/development/.reviews/recipes/change-a-presentation-overlay.json","dependencyDigest":"8ddb25c3dc0c27b0d73ea1901f4e8de7276599745fa326acf001175698f51e67","disposition":"updated","rationale":"Read the complete connection/part-finish/rope/spring/graphics explanation and existing owner boundaries. Load Cell adds a selected fixed-length local-X arrow using the completed sensor body pose; it writes no physics, adds no collider or picking authority and reuses existing retained sensor-overlay resources. Connection visibility, rope released-state classification, cosmetic material surfaces, shared thumbnails, native picking and wiring preferences remain owned as described. No spring capacity, phase/frame budget or adaptive-graphics policy is changed by reaction diagnostics, and their finite-domain/independent-evidence qualifications remain necessary. Camera frustum remains workshop-only and Lamp view consumes completed optical values. Load Cell arrow still consumes completed sensor pose; these additions create no physics import or state writer. Sensor top paint now sizes its transparent center from each physical top-plane dimension, clearing the existing hardware maximum diameter on narrow housings. The independent test measures the actual socket cylinder and rejects the former fixed-pixel hole. Coatings retain ordinary geometry/material/texture disposal and disabled raycasts. Re-read the modified scheduled-batch paragraph against thumbnail-queue and workshop-view. Shared mesh/shader resources survive between tasks; final completion, cancellation and caught render/publish errors call the one-shot finish path, and stale callbacks see stopped before publication. The main renderer warmup is still synchronous and unchanged, as the text states. This is a presentation scheduling change, not a material/physics or picking change."} -->

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

The shared [part builder](../../src/presentation/part-mesh.mjs#symbol=createPartMesh)
creates canonical solids and owns their disposable finishes for the workbench, catalogue,
help images, editing/placement and assembly previews. Family builders receive authored
dimensions and relevant parameters or ports; they never receive a controller or session.
[Sensor faces](../../src/presentation/part-visuals/sensors.mjs#symbol=createSensorDetails)
distinguish measurement identities with static graphics and large top identification
emblems around the real power socket; contact pad ink occurs only on +Z. [Electronics coatings](../../src/presentation/part-visuals/electronics.mjs#symbol=createElectronicsDetails)
mark actual socket banks, while [mechanical finishes](../../src/presentation/part-visuals/mechanical.mjs#symbol=createMechanicalDetails)
mark existing housing covers, spring seats, solid wheel sidewalls and the powered-slide base.
The powered-slide emblem clears the shared central power/slide interface; its rod remains
the existing completed-endpoint visualization, without added collision geometry. These coatings
have no picking surface, new readings, physical material regions or collision meaning.
The [appearance cache](../../src/presentation/resource-cache.mjs#symbol=partAppearanceKey)
includes the angular-rate sensor's selected axis so edits replace stale face graphics;
power commands and binding-only edits retain resources. Recordings retain their existing
approximate reconstruction semantics. Electrical port hardware is part of this production
part mesh, shared with catalogue and assembly previews. [Surface finishes](../../src/presentation/part-finish.mjs#source)
provide cosmetic material response, subtle roughness grain and a disposable studio
reflection field. Paint is nonmetallic surface treatment; exposed surfaces follow the
authored material. These finishes do not change model material values. [Assembly
thumbnails](../../src/presentation/assembly-thumbnails.mjs#implementation) compose the production connection and spring views at saved authored
endpoints, including their geometry in framing and disposing temporary resources. Palette thumbnails retain their temporary meshes through one
[scheduled batch](../../src/presentation/thumbnail-queue.mjs#symbol=createThumbnailQueue)
so shared shader programs stay available, while yielding before rendering and between
types. Each completed image updates mounted palette, help and inspector icons and
remains cached for later icons, including loaded-only parts. Completion, cancellation
and errors release the meshes, preview environment and renderer once; stale callbacks
cannot publish after workshop disposal. The main renderer also warms the catalog material and shadow variants once before authoring starts. It retains both the catalog lighting configuration and variants without part lights, since even an unpowered lamp changes shader light counts. Temporary light visibility is restored before warmup meshes leave the scene. Those bounded resources remain outside the authored mesh map and completed readback, leave the scene immediately, and are released with the renderer. Surface mounts
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

The [rope renderer](../../src/presentation/rope-view.mjs) retains straight segment
meshes between completed physical node centres; it does not synthesize a decorative
sag curve or a rigid endpoint rod. Rope is hidden through exploded-view transitions
and returns in Machine view. [Endpoint controls](../../test/rope-view.test.mjs) and
[ordinary browser construction](../../scripts/verify-rope-browser.mjs#implementation)
compare mesh readback to completed physics and exercise length edits and recovery.
The inspector and generic connection overlay share [released fixed-attachment
classification](../../src/presentation/release-state.mjs). Rope uses its dedicated
renderer and must not acquire an open-latch label merely by sharing the same face.

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

<!-- doc-review {"version":1,"fingerprint":"5323d533e1b5563aff90004697048cc74ce9546b8ef3148e180c2e8c7a38d3f3","dependencies":"docs/development/.reviews/recipes/adaptive-graphics.json","dependencyDigest":"7df6b3f1c5945d57787e5867addea08b2cccea16d628471bd4f5d98f457f055e","disposition":"updated","rationale":"Read the complete nested section and checked graphics-quality thresholds:45 rendered samples,35ms downgrade,20ms recovery and30000ms wait remain unchanged. The quality thresholds remain unchanged; the browser journey now also exercises Lamp rendering under those same budgets. Load Cell adds an existing selected sensor-axis overlay; force readings do not enter quality policy or alter fixed stepping, so rendering budgets and human-evidence limits remain accurate. Incoming Lamp paragraph matches createLampView: one unshadowed spotlight/lens, modeled flux conversion and no quality omission. Optical performance evidence is explicitly separated from player/calibrated evidence. Re-read the added Build-orbit paragraph against final verify-spring-browser: mandatory ordinary Shift+right movement precedes the first quality check, the observed result must arrive within 45000 ms, and assertPresentationOnlyOrbit preserves blueprint, full physical poses and completed cursor while requiring camera movement. Slow callbacks are disabled before original held/released launcher and minimum-resolution checks. The measured diagnostic showed too few active callbacks, not idle resets; prose makes no overloaded-runtime qualification claim."} -->

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
at the minimum level. The [spring browser journey](../../scripts/verify-spring-browser.mjs#source)
induces minimum quality in Build using ordinary camera orbit under delayed animation
callbacks, retaining its 45-second bound. It verifies camera movement while authored
blueprint, completed physics and cursor remain unchanged, then disables the delay
before the existing physical launcher checks. This separates graphics induction from
simulation catch-up; it does not qualify overloaded runtime cadence.
Agent screenshots are not target-player acceptance.

The [lamp renderer](../../src/presentation/lamp-view.mjs#symbol=createLampView) receives
completed optical telemetry. Each admitted lamp retains one unshadowed spotlight and
lens. A hard cone uses intensity = 0.01 × flux / (2π(1−cos half-angle)), so beam spread changes
concentration without adding modeled flux. Display exposure and tint are illustrative;
black tint is dark while electrical demand remains. No lamp shadows are offered, so
light can pass through occluders. Quality reduction retains every lamp. The
[lamp browser journey](../../scripts/verify-lamp-browser.mjs#source) and
[eight-lamp measurement](../../scripts/verify-lamp-performance.mjs#source) are automated
checks, not target-player or calibrated photometry evidence.
