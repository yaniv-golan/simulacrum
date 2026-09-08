# Change recipes

## Choose a recipe
<!-- doc-review {"version":1,"fingerprint":"e1efc3474910f0f1754e2fb0c3bae4fdd01852a16e61c16a1053c227019cc5c7","dependencies":"docs/development/.reviews/recipes/choose-a-recipe.json","dependencyDigest":"a6fe1912ca9d33b9daafd7eeaa23c9991aa19dc509961644944cfc954018b954","disposition":"updated","rationale":"The recipe introduction is now independently addressable and links to the architecture overview; detailed recipes retain their implementation references and are not silently approved by overview review."} -->

Use the [map](architecture.md#overview) to locate the owner, inspect its reverse consumers with
`node scripts/navigate.mjs <symbol-or-path>`, then use focused tests. Admit changes
through the public command surface. A view-local convenience must not become a second
attachment, polarity, naming, reset or authored-property policy.

## Add or extend a part

<!-- doc-review {"version":1,"fingerprint":"3310f56f06c85195e6eff706ee7b18ef95769e2a5ecbe88a8d69844dbf0adb57","dependencies":"docs/development/.reviews/recipes/add-or-extend-a-part.json","dependencyDigest":"2d31a6ca0c04205a3ae7c03b6ef7a0680c76c42b1631ac83f135e7b31b657b42","disposition":"still accurate","rationale":"Package verification scripts changed without changing catalog, geometry, schema generation or part admission; the recipe still identifies their current owners and wheel controls."} -->

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

<!-- doc-review {"version":1,"fingerprint":"ac1c8c0b1c4811319fa46477f97eef4c85e9e15e5aa8194cb48751e4a7215b14","dependencies":"docs/development/.reviews/recipes/add-a-command.json","dependencyDigest":"5fe86f6635455c83a6b60f22fb0c11c3af034a759ab0844c4799e618d1cce28b","disposition":"still accurate","rationale":"New verification entrypoints do not change core command admission, compilation, history or the positive and negative command controls described here."} -->

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

<!-- doc-review {"version":1,"fingerprint":"193c6ad3a081e1d09018764d8bef13b7bfd5372425dd4fdc92ca4a1829d90ba9","dependencies":"docs/development/.reviews/recipes/change-an-interaction.json","dependencyDigest":"174d05370f893c10fdfe3499cc601188c431e9cacc4c1ac7d34e6b3f1586ce6c","disposition":"still accurate","rationale":"The mirror legend now distinguishes one part from multiple parts. Selection, preview, refusal, cancellation and commit behavior and the registered browser checks remain unchanged."} -->

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

<!-- doc-review {"version":1,"fingerprint":"6e81a59f89e13b1fece53e06dae7bb4ab90b9d9960b1b6cf0d64beb61f8dbba8","dependencies":"docs/development/.reviews/recipes/add-a-diagnostic.json","dependencyDigest":"061fd69588ec00cd8d4b3385d060b3cbb2a096e968b00c08e552c752b44e0b9d","disposition":"still accurate","rationale":"Package command additions do not alter completed-observation diagnostics or their opposed-drive and missing-data controls."} -->

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

<!-- doc-review {"version":1,"fingerprint":"7f4a10413495bcbbdf8cb0ada5eeae68f5ea2f8bdd40ffa90872ece1af1296fd","dependencies":"docs/development/.reviews/recipes/change-physics.json","dependencyDigest":"ba2837480c69c6b0cee0d77ebffade1431d2af5e96c9bbf41de26c5b5538d4f4","disposition":"still accurate","rationale":"Only development tooling changed; physical laws, compiler configuration, fixed stepping and mandatory actual milestone qualification remain as described."} -->

Start at the [narrow door](../../src/simulation/physics/world.mjs), with numerical laws
under [motor law](../../src/simulation/physics/law/motor.mjs) or
[constraint law](../../src/simulation/physics/law/constraints.mjs). Configuration comes
from the compiler; laws receive numerical inputs, not identities. The session owns
phase ordering and one integration; do not introduce a second clock or hidden support.

Worked example: a motor-work change needs independent energy accounting in
[impulse energy tests](../../test/impulse-energy.test.mjs), shared-body controls in
[shared power tests](../../test/shared-power.test.mjs), checkpoint-next-step tests in
[session tests](../../test/session.test.mjs), and deterministic multi-process checks.
Use analytical expectations and passive mirrored controls before tuning a controller.
Run the actual gate; a workshop smoke pass does not qualify a Course bar.

## Change multi-part authoring

<!-- doc-review {"version":1,"fingerprint":"9e1d7a65e5a4aba25a8ddfc7c9da4be4980fb6f431851b792d8a6f3dda48db40","dependencies":"docs/development/.reviews/recipes/change-multi-part-authoring.json","dependencyDigest":"2fd7103e53235c2c10287745e229ac0dc8bb490b1c643af29043c5be6a040406","disposition":"still accurate","rationale":"Only the shared mirror refusal wording changed among this section dependencies. Assembly metadata, mechanical traversal, copy admission, instance bindings and persistence retain the documented semantics."} -->

Start with [connection graph](../../src/model/connection-graph.mjs): mechanical membership
means fixed/shaft connectivity, not an editor selection, electrical network, or stored
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

<!-- doc-review {"version":1,"fingerprint":"e64d2d2fb3d0beaafe9ca139ab76196b36076155c2e3f81a81321c69c5b2ff78","dependencies":"docs/development/.reviews/recipes/change-a-presentation-overlay.json","dependencyDigest":"844dc58490c910796e7cf665c784ea6c85a86cd20f66b81ea43cc62d8bd622d3","disposition":"still accurate","rationale":"The shared error message now refers to mirrored parts. Connection visibility, render specifications, resources, trace ownership and overlay tests are unchanged."} -->

Start with [connectionRenderSpecs](../../src/presentation/connection-render.mjs#symbol=connectionRenderSpecs) and
[ConnectionRenderSpec](../../src/presentation/connection-render.d.ts) for the existing
connection overlay. The checked producer takes narrow display inputs; the checked
[connection renderer](../../src/presentation/connection-view.mjs) owns GPU resources.
The workshop view resolves endpoints from displayed meshes, including exploded offsets.
The renderer never changes authored connectivity or sends a command. Visibility is an
explicit required field. Normal electrical links use straight schematic lines; mechanical
geometry and exploded dashed styling retain their existing behavior.

Use exact IDs from [connectionTestPaths](../../src/model/connection-test-paths.mjs#symbol=connectionTestPaths) for
path highlights. The [Connect & test panel](../../src/presentation/connection-test.mjs)
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
