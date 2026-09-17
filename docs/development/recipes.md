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

<!-- doc-review {"version":1,"fingerprint":"113d89fa5325b4efc2263860bd47dfcbc87e7ef9c8bf6d3141a22d3cba0b511b","dependencies":"docs/development/.reviews/recipes/add-or-extend-a-part.json","dependencyDigest":"ce465317c03c3e4c91d722b20f1024d3f1a5b76348413740712a4d1c889252c7","disposition":"updated","rationale":"The meshSpacingRepair link now names src/model/gear-mesh.mjs, where the function moved unchanged to keep src/model/gear-geometry.mjs free of surface knowledge and break a geometry/gear-geometry/surfaces module cycle. The recipe's steps are otherwise unchanged and both merged branches followed them: the cord added its schema entry, regenerated validator and types and registered its invariant and controls, and this branch extended the spur gear with authored teeth and tooth size, its help copy, its search tokens and its tests."} -->

Start with [CATALOG](../../src/model/catalog.mjs#symbol=CATALOG), [schema](../../src/model/blueprint.schema.json)
and [createPart](../../src/model/blueprint.mjs#symbol=createPart). Declare its current milestone in
[features](../../src/model/features.mjs). Use [partPrimitives](../../src/model/geometry.mjs#symbol=partPrimitives)
for authored shapes and [surfaceRegions](../../src/model/surfaces.mjs#symbol=surfaceRegions) for mounting.
The [compiler](../../src/model/assembly.mjs) derives configuration; the renderer consumes
the same geometry. Do not select material or forces by name, role or fixture identity.

Worked example: wheel diameter changes radius while keeping axle position and width.
Beam length is the second authored dimension: [partPrimitives](../../src/model/geometry.mjs#symbol=partPrimitives)
scales the box along local X, faces and pads follow, and a dimension edit is refused by
[resizeMovesMount](../../src/model/editing.mjs#symbol=resizeMovesMount) when any surface
attachment of the edited part would move; the optional parameter's default must equal
the canonical primitive ([assertDimensionDefaults](../../src/model/catalog.mjs#symbol=assertDimensionDefaults)).
A part may declare one joint face (`jointFace: { region, joint }`); a surface pair with exactly
one revolute joint face is a `pivot` connection that [compileAssembly](../../src/model/assembly.mjs#symbol=compileAssembly)
turns into a passive revolute about the mated normal, admitted by
[validateBlueprint](../../src/model/blueprint.mjs#symbol=validateBlueprint) with the joint-face
rules and by the one footprint rule in
[mountFootprintLimits](../../src/model/surfaces.mjs#symbol=mountFootprintLimits), which exempts
joint-face pairs. A surface-mount loop closes only when the mate already coincides.
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

One Spur gear row serves every ratio: the tooth count (12-36) and the module are ordinary
authored parameters, and [gearFacts](../../src/model/gear-geometry.mjs#source) is the only place
they become a pitch radius or a collider radius. The gear branch in
[partPrimitives](../../src/model/geometry.mjs#source) dispatches on whether that helper resolves,
which is exactly when the catalog declares the `gear` capability and exactly as the `length` and
`diameter` branches dispatch on a parameter name, so collider, mass and inertia follow the
authored teeth through the compiler and the physics door unchanged. A row that declares the
`gear` capability must author both defaults and they must reproduce its canonical primitive
exactly; [assertDimensionDefaults](../../src/model/catalog.mjs#symbol=assertDimensionDefaults)
refuses the row by name at load rather than letting the compiler fail on it. Gears use solid root
cylinders for collision, inertia and material selection. The disc is drawn
with cosmetic involute teeth cut inward from that collider radius, so it reads as a gear without
pretending to collide as teeth; two meshed gears therefore show a small visible gap. Its hub,
recessed web and bore are drawn inward too and are equally cosmetic: the collider stays a solid
cylinder, so nothing can be placed through the bore. The drawing takes resolved gear facts (tooth count, module, pitch and collider radius,
face width, shaft radius) built at one site from that model helper, not from the catalog. The
[gear compiler](../../src/model/gear-mesh.mjs) admits explicit meshes only between
independently revolute-supported rotors on one rigid carrier: a forest of at most
eight edges. Limited bearings and extra non-revolute rotor supports reject. Admission depends on
the authored topology alone; the two checks that move with the authored numbers -- equal tooth size
and a centre distance within a millimetre of the two pitch radii added -- are per-edge diagnostics
stamped on the connection row, emit no joint and never refuse the parameter edit. A mesh
neither snaps nor provides shaft support; ordinary Connect/Disconnect and history
remain the editing owners. Because an admitted mesh needs one shared rigid carrier, both gears
always belong to one mechanical group, so no pose edit of either gear can change the distance
between them: the authored distance is the surface-mount offset that separates the two shafts.
[meshSpacingRepair](../../src/model/gear-mesh.mjs#symbol=meshSpacingRepair) names the one
mount that can express a correction and the offset it needs, and the mesh row sends it as an
ordinary `surface-mount` command replacing that same connection, so mount admission --
footprint, bounds and overlap -- refuses it in its own words. It returns nothing rather than a
command that would leave the same diagnosis. The gear that moves is the one on the side of that
mount which drives nothing, and otherwise the later-placed gear; neither rule reads a part name,
a blueprint id or a role. Preserve the [authoring controls](../../test/gear-authoring.test.mjs)
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

<!-- doc-review {"version":1,"fingerprint":"7b480b4afed04fc0bab08671d52b5c9e1938273c466ae5f7ce2c98cfae4bf9d9","dependencies":"docs/development/.reviews/recipes/add-a-command.json","dependencyDigest":"31649a67643c4f7b0e79f2d96885fd5915a6e56cab573e023fe3f9edb39e1aef","disposition":"still accurate","rationale":"The cord's command reached the surface through the same src/model/workshop-command.d.ts declaration, src/core/workshop.mjs admission and boundary typing this recipe prescribes, and this branch added no command beyond ordinary parameter and surface-mount edits. The declaration, admission and typing steps, and the membership check that keeps declared and admitted commands equal, are unchanged."} -->

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
Combined capacity includes machine bodies, every distributed rope and elastic-cord node, compiled scene solids and ground.
[Scene preservation](../../test/scene-preservation.test.mjs#source) covers capture round trips,
legacy visual events, current checkpoint continuation, machine measurements and sensor scope.

The Run-only `camera-photo` request is an input event, not an authoring transaction.
Validate epoch and request ID; accepted IDs deduplicate and a reserved exposure rejects
busy without changing the completed cursor. Bytes and downloads belong to application.

## Change an interaction

<!-- doc-review {"version":1,"fingerprint":"d97d409687bd8bbbd7f8ae72d14714e53e7737b7be8edfc3fbcb2c542cbedf7b","dependencies":"docs/development/.reviews/recipes/change-an-interaction.json","dependencyDigest":"5b4fe6bdd876ef43b77437c4a1eee126c8e93a68c280307d179cf075746f8822","disposition":"still accurate","rationale":"src/model/messages.mjs gained this branch's gear spacing and tooth-size wording and the cord's messages, both through the existing reason-code registry, and docs/development/ui-ux.md moved by its own reviewed prose. The interaction recipe's steps, the owning regions it names and its requirement to verify the affected journey and rendered layout are unchanged."} -->

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

<!-- doc-review {"version":1,"fingerprint":"7940a79502f44c7438a0077f5b97cb85ec5f7977f08b50c88193e8eb2ae6df75","dependencies":"docs/development/.reviews/recipes/add-a-diagnostic.json","dependencyDigest":"64c7288ac1fd118e9143061c09571db5d9793661b5ded54b15a58bcdc91f6496","disposition":"still accurate","rationale":"Both new diagnostics entered exactly as this recipe prescribes: the cord's codes join REASON_CODES through src/model/reasons.mjs, and the gear's unequal tooth size and centre-distance findings are stamped per edge on the connection row. No diagnostic owner, code registry or per-edge plumbing changed, and neither diagnosis dispatches on part identity."} -->

For motion explanations, start at [diagnoseMotion](../../src/model/motion-diagnostics.mjs#symbol=diagnoseMotion). Consume completed
observation values only. Return an explanation and relevant part IDs; presentation
owns navigation and wording layout. Do not repair authored state or infer intention
from a machine name. The Build readiness line and the footer's next step derive from the
same issue list through [readinessLine](../../src/model/motion-diagnostics.mjs#symbol=readinessLine)
and `readinessNext`: they claim nothing the diagnosis did not check (Ready only when every
remaining issue is a zero drive setting; an issue outside the three checked classes keeps
its own title; null for a machine holding a hinge or linear actuator), so a new diagnostic
class needs a decision about which face carries it.

Worked example: opposing-drive diagnostics identify command-adjusted axes on a shared
assembly and suggest checking direction. Read [opposed-drive tests](../../test/opposed-drive-diagnostic.test.mjs)
and [motion diagnostics tests](../../test/motion-diagnostics.test.mjs). Include a real
symptom, a similar valid configuration that must remain quiet, and missing-data cases.
A symptom is not proof of the intended mechanism or cause.

The compact health hint caches its diagnosis: in Build per blueprint/session/epoch
(the readiness line from `readinessLine`), while running in 30-tick buckets after tick
120 (the first non-`COMMAND_OFF` blocker). Blueprint, session, epoch and mode changes
retire that sample; the scene editor and the first running second clear it. Preserve the completed-data diagnosis owner and independently drained
measurement/history cursors.

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

<!-- doc-review {"version":1,"fingerprint":"3811359af5b06359333fef93c8c45f61cb0285c6d0edbd7e7aab51a101aca922","dependencies":"docs/development/.reviews/recipes/change-physics.json","dependencyDigest":"bda323460cffc770b3aedcb9965b75bee767b75c0f539d2317884adca3602617","disposition":"updated","rationale":"Updated a second time after adversarial review found the first version's dissipation evidence weaker than its claim. The section already carried the obligation that an elastic constant serving a range of authored sizes owes evidence at the ends of that range; it now also carries the method, because the method was the defect. A steady work balance at constant force and constant speed drives the relative slip to zero and suppresses every dissipative term structurally, so it cannot support a dissipation claim however clean it looks; the engine's own per-tick energy ledger must be read instead. The measured result is stated in the same terms the recipe now uses: the mesh books half M p squared against the impulse it passes each tick, so that term scales with mobility and spans 172x across the authored bounds, matching the closed form to four significant figures, while the island returns it through the bearings so delivered work stays within 4.1e-04. The other changed dependencies are the two files carrying that evidence (test/fixtures/gear-bounds.mjs, which gained meshLedger and per-phase accumulation, and test/gear-bounds.test.mjs), scripts/measure-gears.mjs which records it, and scripts/manifest.json which registers the controls. No law, simulation module, tick order, integration or physics-door shape moved."} -->

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
uses authored fixed connectivity and ground, never approximate row deletion.
One elastic constant serving a range of authored sizes owes evidence at the ends of that
range, not only at the size it was chosen for: the pitch-point mobility of a spur mesh moves
with the authored tooth count, module and material, so the gear mesh keeps
[bound-corner measurements](../../test/gear-bounds.test.mjs#source) beside its law. Changing
`stiffness`, `damping` or the authored teeth and module bounds means re-recording those
corners in `measure-gears`; a mode whose `omega dt` exceeds one is represented at the warped
frequency `atan(omega dt)/dt`, so the question to answer with measurements is what compliance
the tick still resolves, never whether backward Euler stays stable. Read the engine's own
per-tick energy ledger rather than a steady work balance when the claim is about dissipation:
holding a mechanism at a constant force and a constant speed drives the relative slip to zero,
which suppresses every dissipative term structurally and makes a clean balance prove nothing.
The mesh books `half M p squared` against the impulse it passes each tick, so that term scales
with mobility whatever the authored size; measured, it appears as the island's kinetic decrement
inside the solve phase and the drive replaces it, while the constraint reaction does no work at
all. Beware too of a work balance taken across a kinematic constraint: a gear mesh pins
`omega_B/omega_A` to `-rA/rB`, so output work is identically minus input work for every pair and
such a residual is algebraically zero before any physics happens. Bound a net loss with a passive
phase, where the transmitted force and the terms proportional to it vanish together. Dependency
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
The physics door caches energy, spring, gear and contact readings only within one
physical state. Mutations retire cached readings, including impulses applied inside
a prepared island. Public readers retain independent plain-data copies. Completed
contacts can supply the following sensor phase, but integration must retire
pre-integration contacts. If structure or thermal work starts mutating bodies,
invalidate and resample before publishing or accounting for energy.

Cache authored island membership separately from native response factors. Factors
remain pose-dependent and are rebuilt for each preparation. Release previews,
rejected previews, committed opens and temporary or successful restore candidates
must invalidate cached membership. A rejected restore must not leave candidate
readings or topology attached to the live world.

The owned native response accepts f64 typed vectors and returns disjoint views of
its copied numerical result. These views stay inside the physics door. Preserve
finite-value validation, factor disposal and independent results across evaluations.

Session publication uses the model's numeric body sample constructor, which accepts
only finite primitives and creates, freezes and admits its own arrays. Physics-door
reads remain mutable detached copies. This avoids generic
descriptor scans without exposing a way to mark caller-owned trees as trusted. Other
external trees still pass ordinary recursive data admission. The snapshot checksum
uses the same FNV byte order and arithmetic through an indexed loop; preserve encoded
bytes and corruption rejection when changing its implementation.

Session replay anchors retain physics bytes internally as a Uint8Array. Public
checkpoints and failure bundles still export independent plain byte arrays in the
existing checkpoint format. Capture remains synchronous at each 1200-tick boundary
and remains included in checkpoint timing. Preserve exact exported bytes, restored
continuation and failure replay when changing internal storage.

Power completion copies only modified motor records and commits after every receipt
and accumulated value passes validation. A late failure must preserve completed
state and pending retry state; test corrected receipts without restoring first.
Restore still performs full state admission. Internal shape reuse does not relax
numerical checks or validation of external receipts.

A deterministic current-source replay cannot establish that an optimization preserves
prior behavior. Compare per-tick projections and exported checkpoint bytes against
a frozen pre-change run, including impulse, restore and failure paths, then run the
ordinary determinism and physical regression checks.


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

An [elastic cord](../../src/model/cord.mjs) is a second connection compiled into the
same distributed rows. It authors its own end-to-end stiffness and damping in the
measured 1-300 N/m and 0-100 N s/m ranges, while material and diameter own only the
distributed mass; each row takes N times the authored pair so N rows in series restore
it. It adds no law: the tension-only Kelvin element it needs is the existing rope law,
and duplicating it would put one law under two owners. Its rows are validated in the
physics door against their own domain, reach twice their rest length before a bounded
CORD_MOTION_LIMIT, and carry no material strength rating. Guided springs and cords
share one machine-level elastic budget refused by
[admitCordBudget](../../src/model/cord.mjs#symbol=admitCordBudget) during compilation,
from authored masses over each elastic group; that budget keeps a machine inside the
measured domain and is not a stability requirement, because the distributed rows are
solved implicitly. The door's own cord domain has
[direct counterexamples](../../test/cord-door.test.mjs) that bypass the compiler, and both
extremes of the authored domain are [measured over 2400 ticks](../../test/cord-domain-corners.test.mjs):
the stiffest corner puts 2400 N/m rows on 5.6e-5 kg nodes, about 66000 times the guided-spring
island budget, and still converges without energy growth, jitter or a snapshot discontinuity.
Convergence is claimed for that measured domain only; widening `CORD_LIMITS` requires a new
measurement, not an argument. Preserve [authoring, budget and identity controls](../../test/cord-authoring.test.mjs),
[slack, analytic and bounded-failure controls](../../test/cord-physics.test.mjs),
[energy and damper controls](../../test/cord-energy.test.mjs) and
[both clock drivers](../../test/cord-determinism.test.mjs), which cover the mid-domain cord and
the stiffest corner.

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

<!-- doc-review {"version":1,"fingerprint":"642b7257723290cbf7da593abfbdc4bbe1eb44b077fc24474462b4eaa3340d2c","dependencies":"docs/development/.reviews/recipes/change-multi-part-authoring.json","dependencyDigest":"17461fd363253d432a1bd63350d08e43c9f08fa3ecb9a32fdb8e6ec93db4c86a","disposition":"still accurate","rationale":"Cord connections copy through subassembly instantiation and mirroring in src/model/assembly.mjs and src/model/mirror-assembly.mjs the way ropes already do, deriving nothing from role, name or rig position, and src/model/messages.mjs gained wording from both branches. The authoring authority, selection rules and copy semantics this recipe states are unchanged."} -->

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

<!-- doc-review {"version":1,"fingerprint":"69bb216de918a7d2f7d71c10eeb2faa8500bfa5f833006798060ab8340c24e23","dependencies":"docs/development/.reviews/recipes/change-a-presentation-overlay.json","dependencyDigest":"4290f9495b3f3a888f9b3a79cf7734368b800bc0ac8013c81a5b25435cccf3a7","disposition":"still accurate","rationale":"Neither branch added or restructured an overlay. The cord's only presentation edge excludes its kind from the wiring overlay alongside rope, and this branch's gear settings are inspector rows rather than overlay geometry; docs/development/architecture.md moved by its own reviewed prose. The overlay owners, their telemetry-only inputs and the recipe's steps are unchanged."} -->

Start with [connectionRenderSpecs](../../src/presentation/connection-render.mjs#symbol=connectionRenderSpecs) and
[ConnectionRenderSpec](../../src/presentation/connection-render.d.ts) for the existing
connection overlay. The checked producer takes narrow display inputs; the checked
[connection renderer](../../src/presentation/connection-view.mjs) owns GPU resources.
The workshop view resolves endpoints from displayed meshes, including exploded offsets.
The renderer never changes authored connectivity or sends a command. Visibility is an
explicit required field. Normal electrical links use straight schematic lines; fixed/shaft mechanical
geometry and exploded dashed styling retain their existing behavior. Distributed elastic
connections are not wiring: both rope and `cord` edges are excluded from the wiring
overlay, and a cord is drawn in no surface yet — workshop rendering and the optical
input both select rope connections — so it has completed geometry and no visual
representation. The inspector still names it, through the shared connection labels. Gear meshes
use dashed relationships without a solid supporting rod; their cosmetic teeth are part of
the body geometry and follow completed body transforms. Preserve the [gear rendering controls](../../test/gear-view.test.mjs).

The shared [part builder](../../src/presentation/part-mesh.mjs#symbol=createPartMesh)
creates each part's canonical solid envelope and owns their disposable finishes for the workbench, catalogue,
help images, editing/placement and assembly previews. A body drawn inward of that solid, as a gear's
is, is declared by its builder and may fall short of the solid's bounding box but never exceed it;
a builder may also supply a simpler selection silhouette, which must match the drawn body. Family builders receive authored
dimensions and relevant parameters or ports; they never receive a controller or session.
A generic numeric setting takes its bounds and step from
[parameterInputRange](../../src/presentation/parameter-input.mjs#source), which narrows both to a
parameter's `enum` when it declares one, and no parameter edit is sent while the field reports the
value invalid.
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
cannot publish after workshop disposal. The main renderer also warms the catalog material and shadow variants once before authoring starts. It retains the catalog lighting configuration with a shadow-casting lamp, the same configuration with an unshadowed lamp, and variants without part lights, since even an unpowered lamp changes shader light counts and a casting lamp changes them again. Temporary light visibility is restored before warmup meshes leave the scene. Those bounded resources remain outside the authored mesh map and completed readback, leave the scene immediately, and are released with the renderer. Surface mounts
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
while open. It opens by itself for an actuator still missing its power or its shaft
connection until the player closes it for that part; once both are connected the
player's own open state rules (control is optional). Row pointer leave clears highlighting, but closing the panel, changing
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

The workshop view uses the admitted immutable blueprint reference as a fast path,
compares content when that reference changes, and supplies a revision token to
dependent view caches only for authored content changes. Mode-only publications
can replace the reference with equal content. Do not mutate that blueprint in place.
Selected live readouts replace DOM children only when formatted
content changes; rebuilding the inspector retires its spring-readout node.
Scene preparation performed by render can be reused by the following draw, while
input, camera and overlay invalidation must still refresh affected visuals.
Hidden Measurements suppress text formatting while retaining completed-data
accumulation and refresh when reopened.

Follow the [shared frame scheduling](architecture.md#trace-an-edit) when measuring
these changes. View-update CPU time, renderer submission time and frame cadence are
distinct; submission completion does not establish GPU or display latency.

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

<!-- doc-review {"version":1,"fingerprint":"11ba32b6735cae361db96b20f5924a1116e393b0a42a9dce7893eba62899fa55","dependencies":"docs/development/.reviews/recipes/adaptive-graphics.json","dependencyDigest":"5f8cd7a8beb3eecccf4f1c59922b27caf8930f0290adcbb4941c57f6c582d338","disposition":"still accurate","rationale":"The only changed dependency is scripts/verify-spring-browser.mjs, which opens one Learn row through the shared helper instead of reading a long example screen. Its adaptive-graphics measurements, budgets and owners are unchanged."} -->

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
are released. Each level also carries a lamp shadow map size (1024, 512 and 256 pixels
at the three shadowed levels, 0 below), applied to every lamp view on a level change;
lamp shadow casting therefore flips only on the transition that already toggles the
renderer shadow map, and Three's lights-state version handles the changed
shadow-casting light count without another shader sweep. Resize uses the current
scale without changing CSS coordinates.
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
completed optical telemetry. Each admitted lamp retains one spotlight and lens. A hard
cone uses intensity = 0.01 × flux / (2π(1−cos half-angle)), so beam spread changes
concentration without adding modeled flux. Display exposure and tint are illustrative;
black tint is dark while electrical demand remains. Whether a lamp casts shadows is a
presentation budget, never telemetry: the graphics level supplies a lamp shadow map
size through the view's `applyShadowBudget`, applied by the workshop's shared mesh
factory to authored, surface-preview and placement-preview lamps alike so the
shadow-casting light count never depends on which mesh is a preview. Changing the
budget releases the old depth target and requests one reallocation pass. An unlit or
black-tinted lamp skips its shadow pass (`shadow.autoUpdate` follows lit output), so
eight mounted lamps cost depth passes only while lit. At reduced graphics levels lamp
shadows are off and light passes through occluders. Quality reduction retains every
lamp. The
[lamp browser journey](../../scripts/verify-lamp-browser.mjs#source) and
[eight-lamp measurement](../../scripts/verify-lamp-performance.mjs#source) are automated
checks, not target-player or calibrated photometry evidence.
