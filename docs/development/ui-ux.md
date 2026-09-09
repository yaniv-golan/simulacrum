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
<!-- doc-review {"version":1,"fingerprint":"142374b4aa0ba7c11be8329aa39684190dbb04aa88972be68c5711e965106efc","dependencies":"docs/development/.reviews/ui-ux/learning-content-policy.json","dependencyDigest":"ee6ada73368fb7e3420e4735b2d1aae34dd7cb4749e635bafc2ff1ac76ff7b5e","disposition":"updated","rationale":"Recorded the learning policy against the isolated commit source. Existing guide prompts, inspector-owned parameter edits and preset replacement remain the referenced entrypoints; this documentation change adds no product behavior or claim of comprehension."} -->

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
<!-- doc-review {"version":1,"fingerprint":"7ef64f62d6138a3a3b603bdc487bf7a4c733a7f67425bfacffb8ec5820e32b65","dependencies":"docs/development/.reviews/ui-ux/current-surfaces-and-lifecycle.json","dependencyDigest":"637e5595c5629627f1307f641a0a5aa858f7b5f2be5fdab4261ee72e50ba129a","disposition":"still accurate","rationale":"Canvas screenshot capture is an injected recording callback with no new permanent workshop panel; existing shell regions, requested measurements and lower-panel layout are unchanged."} -->

The [workshop view](../../src/presentation/workshop-view.mjs#source) owns the shell:
document and run actions in the header; parts in the left catalogue; separate edit
and view groups at the workbench edge; selected properties and operations in the
inspector. The [layout](../../src/presentation/workshop.css#source) owns their sizing/reflow.
These are presentation responsibilities, not additional model or simulation authority.

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
