# Change recipes

<!-- doc-review {"version":1,"fingerprint":"cbe6305b20e2f759fe67c5927afb72828219ffbfc2e967d5f1e04537ceff9b28","dependencies":"docs/development/.reviews/recipes/change-recipes.json","dependencyDigest":"3b5613cf54b494f90644cfa7cd0462618461384a94abaaf1bdc57e5dddabadd2","disposition":"still accurate","rationale":"The architecture map clarifies implementation scope for composition; canonical model policy and ordinary command admission still govern authoring convenience."} -->

Use the [map](architecture.md) to locate the owner, inspect its reverse consumers with
`node scripts/navigate.mjs <symbol-or-path>`, then use focused tests. Admit changes
through the public command surface. A view-local convenience must not become a second
attachment, polarity, naming, reset or authored-property policy.

## Add or extend a part

<!-- doc-review {"version":1,"fingerprint":"e443c815b2b82375108fa836aedb9dc60f0009116ef6eb24ac0b9a0e63f33908","dependencies":"docs/development/.reviews/recipes/add-or-extend-a-part.json","dependencyDigest":"cf9245da7c96fac625688df730a987724fd963028639740a9b91b2b3aca75b55","disposition":"still accurate","rationale":"The features allocation adds only M3b wiring presentation. Catalog, geometry, compiler and schema part-authoring procedures remain unchanged."} -->

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

<!-- doc-review {"version":1,"fingerprint":"7688e8232a148b72ffcab012c93352d91a192752edbd0718d298965f8483e637","dependencies":"docs/development/.reviews/recipes/add-a-command.json","dependencyDigest":"c09137c31342d6c140869465810102270fdfc95b34093923c6cd9b4d42689729","disposition":"still accurate","rationale":"No core or model edits occurred. Candidate admission, atomic history and the surface-mount example still use the named owners and existing shared assertions."} -->

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

<!-- doc-review {"version":1,"fingerprint":"e37f64693016eae468e69b5754e51ed584f7e69b634b1ec13ed26ca092233e4e","dependencies":"docs/development/.reviews/recipes/change-an-interaction.json","dependencyDigest":"9120dd2dc6cd05638674969a14355b6dc03cc1cb7d13994f5befa4c07d785872","disposition":"updated","rationale":"The browser-verifier reference now covers its implementation rather than arbitrary inspected files. The recipe explicitly requires executing it against the served build for behavioral evidence."} -->

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

## Add a diagnostic

<!-- doc-review {"version":1,"fingerprint":"d57730ecf8884fb1b1e4a5374bb39d2b0024c0ce282907377aefc6847b446329","dependencies":"docs/development/.reviews/recipes/add-a-diagnostic.json","dependencyDigest":"3c403453ccf7bbcc94c370fe0cc41bce666e7ddc7de7967b825759184d26355c","disposition":"still accurate","rationale":"The discovery command does not modify completed observations or diagnostic ownership. Opposed-drive and motion diagnostics remain the same symptom checks."} -->

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

<!-- doc-review {"version":1,"fingerprint":"7944a9d8978ad3cc3346116660af9606dd7f2b5b8c957c20c5ff0b019c690727","dependencies":"docs/development/.reviews/recipes/change-physics.json","dependencyDigest":"8d6d3a3566bd23b059ad199682e4c9e50319db6c31ddb8858a30569e06687110","disposition":"still accurate","rationale":"Only package discovery metadata changed in this dependency scope. Numeric law, physics door and independent energy/contact tests remain unchanged."} -->

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

<!-- doc-review {"version":1,"fingerprint":"96474b7805ab08c04c9e1d6eca4e0af9b500350f22f2c1bb134614b560d8ed42","dependencies":"docs/development/.reviews/recipes/change-multi-part-authoring.json","dependencyDigest":"d406e8e46da863aff1696b25ea7b8d88760a2dade04901208e49ab246a56fd27","disposition":"still accurate","rationale":"This work adds no reusable assembly feature, schema or copy operations. Mechanical graph classification, frame math and candidate admission remain unchanged."} -->

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

Before adding persistent grouping or reusable definitions, specify what a machine save
contains, what belongs to a separate library, and what remains transient UI state.
A saved machine must be self-contained for replay; library edits must not silently alter
it. An interface alias identifies an ordinary endpoint, not a new source of power,
control or support. Decide alias cardinality, deleted-endpoint behavior and instance key
bindings before extending the strict schema or command union. Follow
[runtime ownership](../contracts/runtime-v1.md), declare the authorized milestone, and
regenerate schema-derived types/validation when a schema change is actually required.
Do not add speculative storage adapters, compatibility aliases or unused copy APIs.

## Change a presentation overlay

<!-- doc-review {"version":1,"fingerprint":"e54579fa2255883044d61f41b25fe20fc4b509cc63ae2d9af6b5c0b743ac79c8","dependencies":"docs/development/.reviews/recipes/change-a-presentation-overlay.json","dependencyDigest":"1028520e6891abcfd1483d69230855ca0f0c0674ae7a4b648171a57607324c52","disposition":"updated","rationale":"Documented mounted wiring preferences, exact panel reveal distinct from hover highlighting, straight electrical lines and closing exploded transitions; retained resources and physical independence checks remain required."} -->

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
