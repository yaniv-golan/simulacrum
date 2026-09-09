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

## Learning content policy
<!-- doc-review {"version":1,"fingerprint":"fbd1432f36485012725515c6618c738740a36f53ac05371996387f6b84d87737","dependencies":"docs/development/.reviews/ui-ux/learning-content-policy.json","dependencyDigest":"f433a4d372f2bbf852e28250092a97ba723e3a930841be5b1deba40e02d847d9","disposition":"still accurate","rationale":"No entry for the assembly fix: the existing Spring strut moves into authoring collections. The separately committed curated examples and their admission decisions remain intact."} -->

Learn & examples is a curated collection of things players can learn to do.
Adding a feature requires a teaching decision, not automatically a catalogue entry.
Apply this policy when adding or changing lessons, examples, experiments, challenges
or their contextual invitations. It governs content admission; it does not require
a new browser layout, progress system or tutorial engine.

**Decide whether content is needed**

In the normal change description, record **no entry / extend / replace / add** and:

- The concrete player need and intended outcome: after this activity, what can the
  player build, predict, diagnose or change? Identify observed confusion, a foundational
  gap or a new construction capability. An untested foundational need is a hypothesis,
  not a player observation.
- The closest existing lesson, example or contextual explanation and why improving
  it is sufficient or insufficient. If none exists, state that. A new part name,
  impressive fixture or differently worded outcome is not sufficient justification.
- For a separate activity, its distinct purpose, prerequisite and observable result;
  for replacement, what useful content and actions it preserves. Do not create a
  second decision database or duplicate the part/command inventory.

Prefer no entry when ordinary controls or contextual help suffice. Fix confusing
interaction before teaching a workaround. Extend when a variation serves the same
experience; replace when the existing content is misleading or superseded; add when
a distinct experience remains necessary after this comparison. These decisions are
reviewable judgments, not a numeric score that proves educational value.

**Choose the teaching format**

| Format | Required player experience |
| --- | --- |
| Guided build | Use ordinary authoring actions, explain consequential connections, then offer a concrete independent edit or repair. |
| Editable example or experiment | Show an inspectable behavior and offer a meaningful change or prediction. For comparisons, name what changes and what stays constant. |
| Challenge | State the goal, constraints and observable success; offer optional hints and allow alternative solutions that satisfy the goal. |

These are content contracts, not required tabs or exclusive categories. One fixture
may support several formats. Reuse canonical explanations and fixtures where practical;
allow separate instruction, independent practice and transfer activities with the
same skill outcome when their distinct purposes justify them. Do not inflate the
catalogue with parameter-only variants, or eliminate useful practice solely because
two activities teach the same skill.

**Author and place the experience**

Before launch, state the outcome, format, essential prerequisites and whether the
action edits the current machine or opens a replacement. Add an actual fixture preview
when spatial understanding or choosing between entries needs it; do not substitute a
decorative image or require a preview system solely to admit a useful small activity.
Start with one concrete goal and enough instruction for an immediate attempt. Follow
action with visible consequence and explanation where useful. Offer a meaningful next
change, prediction or repair without requiring quizzes or lesson completion for free play.

Keep part settings in the inspector, control reference in Help, fault explanations
with faults and reusable components in their authoring library. Contextual help may link
to an activity; it must not create a duplicate settings owner or hide essential actions.
Use the existing requested-content, keyboard access, dismissal and replacement
lifecycles below. An ordinary parameter edit preserves the rest of the machine;
loading a preset resets authored choices and is an explicit replacement, not a
single-variable comparison. Define retained state and recovery for any new lifecycle.

Examples use ordinary player-authorable components, commands and physical laws within
the admitted milestone. Teaching may highlight and explain; it may not grant hidden
forces or successful behavior. Required observations and measurements must exist and
describe the actual quantity; lack of instrumentation cannot justify invented success.
An intentional failure needs an inspectable symptom and a reachable repair/restart.

**Curate and review**

Order content by player goals and readiness, not feature release order. Keep the
starting selection deliberate and the remaining content retrievable. Prerequisites
advise readiness; they do not lock sandbox capabilities behind lessons. Automatic
recommendations require a demonstrated discovery need, explicit trigger and respectful
dismissal/retrieval behavior; this policy does not itself authorize a hints subsystem.
The exact category layout remains a usability decision, not a mandated three-tab design.

When adding or revising content, inspect neighboring entries for extension, consolidation
or replacement. Retire obsolete or misleading content while preserving useful learning
and unique actions. Revisit affected content when its controls, fixture or physical
behavior changes; do not demand a catalogue-wide rewrite for every feature.

Verify loading, claimed behavior, ordinary edits, reset/replacement, cancellation and
state preservation through existing relevant checks. For material learning journeys,
use the player review described below to assess finding an activity, predicting an
effect, making an independent change and recovering from failure. Authored-step
completion proves neither comprehension nor enjoyment. Separate automation, source
inspection and observed player evidence; cosmetic edits need no new participant session.

The current [browser and guided-build presentation](../../src/presentation/workshop-view.mjs#source),
[guide step generation](../../src/application/starter-guide.mjs#source),
[example loading](../../src/application/workshop-app.mjs#source) and
[spring parameter controls](../../src/presentation/spring-controls.mjs#source) are
implementation entrypoints for applying these rules, not additional policy owners.
Their source dependencies make affected content review discoverable through the normal
documentation workflow. Documentation checks detect stale references and reviews;
they do not automatically judge whether a new activity deserves admission.

## Current surfaces and lifecycle
<!-- doc-review {"version":1,"fingerprint":"3d676d30037cc5ef4bfca733ab64192b7b66c99a1082052b0a5d1f507c4e0d9c","dependencies":"docs/development/.reviews/ui-ux/current-surfaces-and-lifecycle.json","dependencyDigest":"b27c2613e3d910c7d440b162f23c7bbd25740a01a37f510fb3ba108f0291da88","disposition":"still accurate","rationale":"The combined source retains curated examples and their dismissal routes, plus built-in and personal assembly collections. The assembly top-right icon retains the accessible Close label and focus return."} -->

The [workshop view](../../src/presentation/workshop-view.mjs#source) owns the shell:
document and run actions in the header; parts in the left catalogue; separate edit
and view groups at the workbench edge; selected properties and operations in the
inspector. The [layout](../../src/presentation/workshop.css#source) owns their sizing/reflow.
These are presentation responsibilities, not additional model or simulation authority.

Assemblies opens a bounded, searchable browser with rendered geometry and All assemblies,
Built-in and My saved filters. Spring strut is supplied as a built-in definition by the
application; it is not seeded into personal browser storage. Built-ins share the placement
preview and have no rename/remove actions. The separate Spring strut palette button is removed.
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

Learn & examples opens a bounded browser. The top-right close control, Escape, or a
click outside dismisses it; clicks within its content keep it open. Starting a lesson moves its current step
into the parts area; leaving removes it. New examples enlarge this browser, not the
ordinary toolbar. The three activities identify their format and outcome: a guided
rolling build with an independent motor-setting attempt, a keyboard driving task, and
a spring-settling experiment. The spring inspector offers a requested damping comparison
through the ordinary Damping edit and Undo, preserving other tuning instead of loading
a second preset. Existing machines
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
<!-- doc-review {"version":1,"fingerprint":"68e4e0de871f2c41597762c0d5e9876fa35124b77b4a23a36f332ee66c1333ff","dependencies":"docs/development/.reviews/ui-ux/verification-and-review.json","dependencyDigest":"87408929c7b14cb6f5fd35802fb45d43374e3408e0271d1690d5b555eb9e3792","disposition":"still accurate","rationale":"The existing workbench journey now also proves clicks inside retain the dialog and outside clicks dismiss it before reopening and continuing construction. Its documented lifecycle and preservation responsibilities remain accurate."} -->

Use the manifest's `workbench-content-lifecycle` invariant and
[registered browser check](../../scripts/manifest.json#check=verify-workbench-content)
with normal change discovery. `npm run inspect:change -- --files <paths>` identifies
owners, associated invariants, conservatively selected browser checks and affected
explanations. Unknown changes stay conservative. Registration is not execution.

[Scope controls](../../test/workbench-content.test.mjs) cover meaningful and wrong
states; the [browser journey](../../scripts/verify-workbench-content.mjs#source)
checks requested learning/results, scope against changed parts, preserved operations
and non-mutating help. The [learning example journey](../../scripts/verify-learning-examples.mjs#source)
checks the independent motor edit, Run and Undo, and a zero-damping comparison that
preserves other spring tuning. It also checks cancellation of example replacement.
Existing manipulation, inspector, mirror, connection and input
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
