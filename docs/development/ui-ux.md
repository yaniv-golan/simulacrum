# Workshop UI and content policy

## Before changing player-facing UI

The workshop foregrounds the machine, the next action and its consequences. Build
for a capable beginner aged 14–17: a player can make a wheel turn without writing
code or completing a tour. Keep technical depth available when it answers a question.

For a UI addition or relocation, state the player's task, the existing region that
owns it, why it must remain visible, its dismissal/retrieval behavior, and the old
surface it replaces. Include these decisions in the change description; do not
create a separate checklist database or a second command inventory.

Persistent space is for frequent actions, consequential state and unresolved failures.
Examples, lessons and reference material are requested content. One command has one
primary home; keyboard shortcuts may supplement it. A new part or example must not
automatically add another permanent workbench panel. Keep selected identity,
mechanical movement scope, electrical networks and saved assemblies distinct.

Use short verb/object labels, with shortcuts secondary. Explain what happens rather
than repeating the label. Name causes only when the evidence establishes them;
otherwise give the observation and a useful next check. Do not shrink text to make
more explanations fit. Spatial relationships often need a preview or diagram.

## Current surfaces and lifecycle
<!-- doc-review {"version":1,"fingerprint":"f702d660c77f6f808e75bf2bdda12cd4b3f41c402c61f5fb8878ba0adcc40e6e","dependencies":"docs/development/.reviews/ui-ux/current-surfaces-and-lifecycle.json","dependencyDigest":"8337a39ee64a2d7ebef46eb62e2759f1c5f169efc24ef5f3e89a8d49786bc7b2","disposition":"updated","rationale":"Documented explicit member targeting for part shortcuts, Build-only repeat placement, visible rename focus and retained narrow browser navigation."} -->

The [workshop view](../../src/presentation/workshop-view.mjs#source) owns the shell:
document and run actions in the header; parts in the left catalogue; separate edit
and view groups at the workbench edge; selected properties and operations in the
inspector. The [layout](../../src/presentation/workshop.css#source) owns their sizing/reflow.
These are presentation responsibilities, not additional model or simulation authority.

Saved assemblies opens a bounded, searchable browser with rendered saved geometry.
Browsing, renaming and removing saved definitions remain separate from machine
selection and Undo. Renaming returns focus to Place in machine; sorting preserves
the current results/detail page on narrow screens. The machine picker lists assemblies alongside parts; Create
assembly opens the contextual editor with canvas and checkbox membership selection.
The first selected member defines the origin. Optional named connection points expose
ordinary endpoints. The inspector retains group operations and a member can return
to assembly selection without searching the saved library. Selecting an assembly
leaves part-only shortcuts inactive until a member is explicitly inspected.

Place in machine closes the browser and opens a nonmutating world-plane preview.
Precision and increments adjust the proposal; Place publishes one ordinary insertion.
Surface snapping is hidden during this free insertion. Named mounting is a separate
transaction after insertion. Cancel returns to the retained browser; Place another
starts a fresh proposal in Build only. A machine or cursor change requires explicit revalidation.
Pending insertion disables cancellation and duplicate submission; uncertain replies
can only reconcile against the exact authored result from the session observation.
Saved thumbnails use production part meshes, a bounded cache and explicit disposal.

Labeled Select/Move/Rotate and snap state remain visible in Build. The
[scope formatter](../../src/presentation/workbench-content.mjs#symbol=movementScope)
describes the actual affected count supplied by mechanical traversal. Select's direct
drag also moves connected parts. Highlight the affected geometry before an action;
hide the scope for a single part, no selection, Run/Paused and conflicting operations.
The count includes the selected part. Mirror and Clear selection remain reachable in
the inspector; removing an overlay must not remove a unique command.

Wiring has direct labeled access because electrical construction is central. Connection
creation belongs to authoring, not View. Exploded inspection shows its state and exit;
temporary connection inspection must disclose when it overrides a hidden-wiring
preference. View state must not imply that authored parts have physically moved.

Learn & examples opens a bounded browser. Starting a lesson moves its current step
into the parts area; leaving removes it. New examples enlarge this browser, not the
ordinary toolbar. Examples have individual outcome descriptions. Existing machines
require explicit replacement confirmation, with Download, Cancel and an explicit
replace action. A browser download request is not proof of a saved file: after download,
the player confirms they saved it before opening. Cancel and download failure preserve
the machine. [Example loading](../../src/application/workshop-app.mjs#source) uses ordinary load admission without an intermediate empty
machine; a rejected replacement keeps the dialog open. The catalogue retains focus,
expanded groups and scroll while simulation updates. Starting examples requires Build.

Help is an explicit, keyboard-accessible dialog. It contains control and wiring
explanations instead of keeping paragraphs over the canvas. Build information is
readable and copyable here; the served marker remains for assessment evidence. No automatic hint/tour
is currently implemented. Future optional hints require an explicit trigger,
dismissal/completion condition and retrieval route, with no timer hiding required
instructions. Honor dismissal where persistence exists; local resets are not proof
that someone wants another tour. Errors and consequential state are never dismissed
by a teaching preference.

The [motion panel](../../src/presentation/motion-readout.mjs#source) separates requested
measurements from boundary warnings. Stopping preserves the last run for inspection.
Measurements describe the actual quantity and scope: whole-machine displacement is
not a general success criterion for a spring. The requested panel labels whole-machine
motion and provides a keyboard-accessible measurement explanation. Successful machine loading, including same-ID saved revisions, clears prior results;
failed loads preserve them. Recovery warnings remain visible with
measurements closed. No measurement is permission to invent physical causality.
Machine controls and measurements share a bounded layout at the lower workbench edge.
They sit beside one another where space allows and stack on narrower workbenches,
with independently scrollable contents and a reachable controls disclosure. The shared
area leaves empty space transparent to canvas input; each panel retains its own
visibility lifecycle.

## Verification and review
<!-- doc-review {"version":1,"fingerprint":"c4a88da8906f9e8acfe1fe376ce508d7c780d5a557b7aa04380504df9ac91e93","dependencies":"docs/development/.reviews/ui-ux/verification-and-review.json","dependencyDigest":"31b44bf51bc5714f21353e12a1741a3f601d9d05a5cfe61ed37462b8a4d34789","disposition":"still accurate","rationale":"The linked workflow now records observed data with optional media. Real participant protocols and the distinction between automation and human acceptance remain unchanged."} -->

Use the manifest's `workbench-content-lifecycle` invariant and
[registered browser check](../../scripts/manifest.json#check=verify-workbench-content)
with normal change discovery. `npm run inspect:change -- --files <paths>` identifies
owners, associated invariants, conservatively selected browser checks and affected
explanations. Unknown changes stay conservative. Registration is not execution.

[Scope controls](../../test/workbench-content.test.mjs) cover meaningful and wrong
states; the [browser journey](../../scripts/verify-workbench-content.mjs#source)
checks requested learning/results, scope against changed parts, preserved operations
and non-mutating help. Existing manipulation, inspector, mirror, connection and input
checks retain their guarantees when locators move. Extend the appropriate check for
new behavior; demonstrate new tests failing before the repair. Do not bless arbitrary
word counts, screenshots or button counts as proof of good design.

Before closure, inspect rendered Build, active operation, Run/Paused and requested
content states at 1280×720, plus the smaller/zoomed layout affected by the change.
Exercise real targeting, keyboard focus, cancellation, long content and return visits.
Record what was observed and what was not tested in the change description. Relevant
hover/focus help must remain readable and dismissible; no essential action is available
only through hover, color or a shortcut. Overlays must not intercept placement.

`npm run docs:prepare` identifies source-stale explanations in this document as well
as other development docs. Review each affected section, then use `npm run verify:local`.
The existing CI documentation check rejects stale review evidence. Merge/release and
milestone work still require `npm run verify:final`; no extra UX completion command
or independent inventory is introduced.

Automation checks the named behaviors, not comprehension, enjoyment or completeness.
For a material new journey or layout, obtain an unassisted review that includes a
prediction before movement, a construction/repair attempt and recovery from an error.
Separate newcomers from returning users and distinguish unfamiliarity from persistent
failure. Agent review is useful fault finding, never a human acceptance receipt.
Use the existing [playtesting workflow](playtesting.md#remote-setup) and versioned
assessment protocols for real participants; do not require a new human session for
every cosmetic edit or claim a green test supplies F1.
