# Change recipes

## Choose a recipe
<!-- doc-review {"version":1,"fingerprint":"268fda4646b90f3ced9224a44f96bed3ef03c5b8e1319df6f89ef45d1066925a","dependencies":"docs/development/.reviews/recipes/choose-a-recipe.json","dependencyDigest":"b8b9b29dfda321d1e6bc52fd82f6f34928642f45884cef31e5e9a6f7db1af03b","disposition":"still accurate","rationale":"Architecture overview now routes manifest values through gate/rules; choosing an owner, following consumers and using the existing command authority is unchanged."} -->

Use the [map](architecture.md#overview) to locate the owner, inspect its reverse consumers with
`node scripts/navigate.mjs <symbol-or-path>`, then use focused tests. Admit changes
through the public command surface. A view-local convenience must not become a second
attachment, polarity, naming, reset or authored-property policy.

## Add or extend a part

<!-- doc-review {"version":1,"fingerprint":"2a2554aca1e4455bfba6cb470dc888fcc29a3ce077bd79944e0abd3f13098053","dependencies":"docs/development/.reviews/recipes/add-or-extend-a-part.json","dependencyDigest":"c326af87389ee54f6baa5bf47db1bed5c519bcb07512279941050dff773d0273","disposition":"still accurate","rationale":"Only session formatting changed since this section review. Guide/carriage extend catalog and schema at M3b and regenerate validators/types. Pads remain canonical geometry with authored materials, compiler admission and ordinary surface mounts as described."} -->

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

## Add a command

<!-- doc-review {"version":1,"fingerprint":"4c45647f4762192c1fdd7ffa7bd02dcb66087054c1d3485e9696c6f51fb39a56","dependencies":"docs/development/.reviews/recipes/add-a-command.json","dependencyDigest":"2ed743d661d92200593d676836f38a129c86dd7f1f142331a6ef4e640a50bd3e","disposition":"still accurate","rationale":"Only session formatting changed since this section review. Spring convenience actions map to existing load/insert-assembly commands and parameter edits. Candidate compilation and atomic history remain the core admission route; no new command authority bypass was added."} -->

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

<!-- doc-review {"version":1,"fingerprint":"5cca3cbaa6df3dd110148a49a223c1dc3685da1167826403d88ab2824efdbe9d","dependencies":"docs/development/.reviews/recipes/change-an-interaction.json","dependencyDigest":"929ab040b2128f4ca98e91acdf400763ecb2e3b9375916006feb3b886d4058de","disposition":"still accurate","rationale":"Only session formatting changed since this section review. The new guided spring diagram uses the existing static help lifecycle and adds linear motion wording. Surface mounting, cancellation and ordinary core commits remain the prescribed interaction pattern."} -->

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
for dragging, expand/restore, tabs, capture, authoring Escape, mode availability,
inspector coverage and reflow. Assert actual scroll movement as well as absence of
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

<!-- doc-review {"version":1,"fingerprint":"859ffd68a97ad422feb49525f1ef1c40d6d91c6ace114fa4a4f5dcdb31a2cb42","dependencies":"docs/development/.reviews/recipes/add-a-diagnostic.json","dependencyDigest":"db6b288ffc90d2a1925a15c1a265080ffe0f70f6dc68225ba927efc8f4c439fb","disposition":"still accurate","rationale":"Only session formatting changed since this section review. Spring inspector reads completed length/speed/energy and explains limits; it neither repairs state nor infers intent. Existing diagnoseMotion ownership and symptom-versus-cause guidance remain accurate."} -->

Start at [diagnoseMotion](../../src/model/motion-diagnostics.mjs#symbol=diagnoseMotion). Consume completed
observation values only. Return an explanation and relevant part IDs; presentation
owns navigation and wording layout. Do not repair authored state or infer intention
from a machine name.

Worked example: opposing-drive diagnostics identify command-adjusted axes on a shared
assembly and suggest checking direction. Read [opposed-drive tests](../../test/opposed-drive-diagnostic.test.mjs)
and [motion diagnostics tests](../../test/motion-diagnostics.test.mjs). Include a real
symptom, a similar valid configuration that must remain quiet, and missing-data cases.
A symptom is not proof of the intended mechanism or cause.

## Change physics

<!-- doc-review {"version":1,"fingerprint":"8893db5e254ff39a481f37f487316940204e853700bab124e79ec5135b7acd79","dependencies":"docs/development/.reviews/recipes/change-physics.json","dependencyDigest":"7c98b03ef1876bfd058a211e3b310ecbd218bf1e2305bd86249d9122165da25a","disposition":"still accurate","rationale":"Only session formatting changed since this section review. Added numeric spring law ownership and coupled-order, frequency-bound, checkpoint-history controls. One integration and completed ledger ownership are preserved."} -->

Start at the [narrow door](../../src/simulation/physics/world.mjs), with numerical laws
under [motor law](../../src/simulation/physics/law/motor.mjs) or
[constraint law](../../src/simulation/physics/law/constraints.mjs) and
[spring law](../../src/simulation/physics/law/spring.mjs). Configuration comes
from the compiler; laws receive numerical inputs, not identities. The session owns
phase ordering and one integration; do not introduce a second clock or hidden support.

Worked example: a motor-work change needs independent energy accounting in
[impulse energy tests](../../test/impulse-energy.test.mjs), shared-body controls in
[shared power tests](../../test/shared-power.test.mjs), checkpoint-next-step tests in
[session tests](../../test/session.test.mjs), and deterministic multi-process checks.
Use analytical expectations and passive mirrored controls before tuning a controller.
For guided springs, preserve five constrained degrees of freedom, simultaneous
coupled damping, bounded frequency admission and signed integration/contact residuals.
Use [spring physics controls](../../test/spring-physics.test.mjs) and
[checkpoint/editing controls](../../test/spring-playground.test.mjs), including reversed
connection order and pre-swap rejection of invalid derived history.
Run the actual gate; a workshop smoke pass does not qualify a Course bar.

## Change multi-part authoring

<!-- doc-review {"version":1,"fingerprint":"56a462e2fba24c396c2252c49fc6780e2de6de88075b2a72a8bd0b0b969385db","dependencies":"docs/development/.reviews/recipes/change-multi-part-authoring.json","dependencyDigest":"7618345785cb633475eae8182257ce97f56773ffc51c6a8b58d5a01914d2c144","disposition":"still accurate","rationale":"Only session formatting changed since this section review. Mechanical membership now explicitly includes spring connectivity. Ordinary insertion preserves settings/materials and remaps endpoints; reflected mounts use independent geometry expectations under the documented copied-graph contract."} -->

Start with [connection graph](../../src/model/connection-graph.mjs): mechanical membership
means fixed/shaft/spring connectivity, not an editor selection, electrical network, or stored
library group. Classify a selection's internal and crossing connections before choosing
which edges an operation may copy. The classifier reports facts; the operation owns
whether a crossing edge is omitted, rejected or explicitly rebound. Mount admission
must retain its stricter aligned-edge eligibility when testing alternate support paths.

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
names and inspectable authored settings. Placed instances and saved items have separate
bounded views; connection choices show named assembly interfaces before ordinary endpoints.
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
also covers offset mounting with an intact shaft, in-place interface edits, decimal
receiver tuning, saved settings, named targets, bounded navigation and diagnostic layout.

## Change a presentation overlay

<!-- doc-review {"version":1,"fingerprint":"1e1e49dbf90268b9cd0370cfa733bcd25d94fa6d7deab0ed9a4fbcb635d3abff","dependencies":"docs/development/.reviews/recipes/change-a-presentation-overlay.json","dependencyDigest":"73f5d28fb59b411d8fb85e201f10aac5b9c6315fa568ab396ebbd3b4f03335c0","disposition":"still accurate","rationale":"The performance probe now binds the attempted oversized load receipt and compares the complete blueprint, physics, energy, spring readings and cursor after rejection. Retained geometry, completed-transform and performance measurement ownership described here remains unchanged."} -->

Start with [connectionRenderSpecs](../../src/presentation/connection-render.mjs#symbol=connectionRenderSpecs) and
[ConnectionRenderSpec](../../src/presentation/connection-render.d.ts) for the existing
connection overlay. The checked producer takes narrow display inputs; the checked
[connection renderer](../../src/presentation/connection-view.mjs) owns GPU resources.
The workshop view resolves endpoints from displayed meshes, including exploded offsets.
The renderer never changes authored connectivity or sends a command. Visibility is an
explicit required field. Normal electrical links use straight schematic lines; mechanical
geometry and exploded dashed styling retain their existing behavior.

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

Run [renderer/resource tests](../../test/connection-render.test.mjs),
[resource retention tests](../../test/presentation-resources.test.mjs),
[diagnostic path tests](../../test/connection-test-paths.test.mjs), and boundary type checks.
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
[Spring rendering controls](../../test/spring-view.test.mjs) cover travel and disposal;
the registered [spring browser probe](../../scripts/verify-spring-browser.mjs#implementation)
checks numeric controls and completed/rendered transforms, while the
[performance probe](../../scripts/verify-spring-performance.mjs#implementation) measures
render cost and retained resources at the admitted bound.
