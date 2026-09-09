# Change recipes

## Choose a recipe
<!-- doc-review {"version":1,"fingerprint":"268fda4646b90f3ced9224a44f96bed3ef03c5b8e1319df6f89ef45d1066925a","dependencies":"docs/development/.reviews/recipes/choose-a-recipe.json","dependencyDigest":"b8b9b29dfda321d1e6bc52fd82f6f34928642f45884cef31e5e9a6f7db1af03b","disposition":"still accurate","rationale":"Architecture overview now routes manifest values through gate/rules; choosing an owner, following consumers and using the existing command authority is unchanged."} -->

Use the [map](architecture.md#overview) to locate the owner, inspect its reverse consumers with
`node scripts/navigate.mjs <symbol-or-path>`, then use focused tests. Admit changes
through the public command surface. A view-local convenience must not become a second
attachment, polarity, naming, reset or authored-property policy.

## Add or extend a part

<!-- doc-review {"version":1,"fingerprint":"0b30cac9baed06feaed828fa0d4ad6294f877372e15538523629fdaffea185e8","dependencies":"docs/development/.reviews/recipes/add-or-extend-a-part.json","dependencyDigest":"fed7e6740d0c4637c6a660c5e44d9007f476937948e19ed38f614658803288c4","disposition":"still accurate","rationale":"Dependency representation changed for reviews only; catalog, schema, geometry, mounting and compiler authoring paths remain unchanged."} -->

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

<!-- doc-review {"version":1,"fingerprint":"55a341e2ec73230848d35ccdf2607859e30acc9719c7b6336d1d7013ffbf493e","dependencies":"docs/development/.reviews/recipes/add-a-command.json","dependencyDigest":"89cc8ae8a374fe52b5f38e9ddd2c09b24f7a2274dcfb97d1436fcda631d11b5c","disposition":"still accurate","rationale":"The new application diagnostic sequence is outside core history and cursors; the recipe still requires whole-candidate compilation and explicit rejected command effects."} -->

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

First apply the [UI and content policy](ui-ux.md#before-changing-player-facing-ui).
Identify the player task, primary home, visibility/retrieval lifecycle and replaced
surface. Keep consequential state visible and verify unique actions remain reachable
after removing or moving controls.

<!-- doc-review {"version":1,"fingerprint":"9e7adc9580682899c5f79474978832b3cdd18d192433a28ba8a4736ce9cc2c7b","dependencies":"docs/development/.reviews/recipes/change-an-interaction.json","dependencyDigest":"cece79761e10e6e0cde10f80dec769f3623b573fed34ddfd4c234470e70b7aa3","disposition":"still accurate","rationale":"The shared drag helper preserves real pointer input and finally releases on errors. Presentation preview ownership, cancellation and the referenced UI checks remain required. Load completion now returns the captured matching receipt handle, avoiding a later command racing the result read."} -->

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

<!-- doc-review {"version":1,"fingerprint":"9b7a3564f707b8df65392b6025253e91b9293331106b3b604ea748736df6f136","dependencies":"docs/development/.reviews/recipes/add-a-diagnostic.json","dependencyDigest":"ac54eed451b274691541ee7e7eeda68c503dcc32294663cab3113a1984473cf8","disposition":"still accurate","rationale":"No diagnostic model or navigation behavior changed; review hashes alone changed and completed observation inputs remain the required diagnostic source."} -->

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

<!-- doc-review {"version":1,"fingerprint":"ef6099e09d2ea9bce5f1657987a156e307968e293569c4cd9b33e55aa68dac63","dependencies":"docs/development/.reviews/recipes/change-physics.json","dependencyDigest":"6605c37f18c9e3c69a23b009a438a0b86f7107dc8b96d3e61725b8bbe1cb9c0f","disposition":"still accurate","rationale":"Independent spring angular momentum tests were rerun successfully; this tooling change does not alter spring laws, physical tolerances, ordering or ownership."} -->

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
connection order and pre-swap rejection of invalid derived history. Off-center controls
compute total angular momentum as orbital momentum plus world-rotated box inertia
times angular velocity, with centered, rotated and independently reordered bodies,
joints and endpoints. Preserve both the tight two-body impulse and accumulated
chain checks; checking linear momentum alone misses lost moment arms.
Run the actual gate; a workshop smoke pass does not qualify a Course bar.

## Change multi-part authoring

<!-- doc-review {"version":1,"fingerprint":"da7b22ac1109fa6f8c714ac6141ec031fcdc21642792228ecc8886b85a0a87db","dependencies":"docs/development/.reviews/recipes/change-multi-part-authoring.json","dependencyDigest":"2aa504a1731d5b25b796fefa34963b713a396ac659664b68e7578313ef73e614","disposition":"still accurate","rationale":"No assembly graph, alias or insertion semantics changed. New browser helpers retain caller assertions and do not replace the copied-graph and history contracts described here. Load completion now returns the captured matching receipt handle, avoiding a later command racing the result read."} -->

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

<!-- doc-review {"version":1,"fingerprint":"ac0f8c51c50f05ccf58b13911f517d5155fad58725f52c5f79158927e035d5ec","dependencies":"docs/development/.reviews/recipes/change-a-presentation-overlay.json","dependencyDigest":"c03d0486d8bce8cdd7161c77fddb62f1bc4f7f02f5bdc4015a56d30ab87a94e7","disposition":"still accurate","rationale":"The shared evidence helper captures a fresh matching load receipt and new documentation controls preserve exact binary bytes. Neither change alters connection geometry, visibility, picking or simulation projections required by this recipe."} -->

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
[performance probe](../../scripts/verify-spring-performance.mjs#implementation)
enforces the [spring performance policy](../../scripts/measure-springs.mjs#source)
at zero, one and eight springs; 32 must reject without changing state. Three
counterbalanced repetitions follow 240 simulation ticks or 60 browser frames of
warmup. Each repetition must pass: complete tick p95 at most 3.333 ms (40% of
a 120 Hz tick), actuator/constraint p95 at most 2 ms, renderer CPU submission p95
at most 6 ms, frame cadence p95 at most 40 ms (30 Hz with 20% scheduling margin),
no stall above 500 ms, and simulated/wall time ratio from 0.95 to 1.05.
Node phase timings isolate simulation; browser renderer timing is CPU submission,
not GPU time, so cadence is enforced separately. Before/after visible idle controls
require p95 at most 20 ms; zero-spring Node ticks require at most 1.042 ms.
Environment failures do not relax budgets. Reports retain raw samples, CPU, browser,
GPU renderer and source identity. This spring benchmark requests native Metal on
macOS because the headless default can select software rendering; other platforms
retain their default backend and the same budgets. Repeat on supported target hardware for hardware
qualification. [Budget controls](../../test/spring-performance.test.mjs) exercise
limits and incomplete/unhealthy trials. Replacement probes also bound retained
geometry, textures and heap.
