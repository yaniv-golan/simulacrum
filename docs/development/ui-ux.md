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

<!-- doc-review {"version":1,"fingerprint":"d47ffe30d4a9e74c8581ac4ae4c986bc7a076821503e3cfb70b945bd9bc4ca15","dependencies":"docs/development/.reviews/ui-ux/learning-content-policy.json","dependencyDigest":"8b9e3fb2d2cb86ee36936664a90ebd8c5066e674570152394eedc5e0d03d9710","disposition":"still accurate","rationale":"Integration of the physics/rendering performance branch (e964001) with main at ab3d799: no entry. Lifecycle fixes, measurement endpoint labels and shader warmup add no player task, lesson, example or mechanical capability, and main's sound controls are optional comfort feedback covered by existing activities. Existing controls and explanations suffice; no comprehension or listening acceptance is established."} -->


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

| Format                         | Required player experience                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Guided build                   | Use ordinary authoring actions, explain consequential connections, then offer a concrete independent edit or repair.                  |
| Editable example or experiment | Show an inspectable behavior and offer a meaningful change or prediction. For comparisons, name what changes and what stays constant. |
| Challenge                      | State the goal, constraints and observable success; offer optional hints and allow alternative solutions that satisfy the goal.       |

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

<!-- doc-review {"version":1,"fingerprint":"2eb7bd9c8206682b377bbab0316c6496103bd7204b0817a824ca78d5d3973ba6","dependencies":"docs/development/.reviews/ui-ux/current-surfaces-and-lifecycle.json","dependencyDigest":"73bbb7367e037451e7fafacf46fa6b4b147b4bda6bbb38477a6047614c501c50","disposition":"updated","rationale":"The merged section keeps main's compact Sound toggle, Volume popup, dismissal, preference and denied-audio retry text and adds the performance branch lifecycle notes: hidden Measurements suppress formatting while accumulation continues, inspector readouts replace DOM only when formatted values change, and the running health hint refreshes in 30-tick bands after tick 120 and drops its cached diagnosis on blueprint, session, epoch or mode change (verified in refreshHealth/refreshLive). No surface is added or displaced; before-draw errors reuse the existing status message and pause the clock while draw scheduling survives for the recovery controls."} -->



The [workshop view](../../src/presentation/workshop-view.mjs#source) owns the shell:
document and run actions in the header; parts in the left catalogue; separate edit
and view groups at the workbench edge; selected properties and operations in the
inspector. The [layout](../../src/presentation/workshop.css#source) owns their sizing/reflow.
These are presentation responsibilities, not additional model or simulation authority.

The [part catalog](../../src/presentation/parts-browser.mjs#source) uses real mesh thumbnails, Essentials and functional categories,
Recent and locally saved Favorites. Search covers the whole available catalog and
ranks names, aliases, actions and related roles in that order, preferring complete
query coverage across identity and function fields. Complete conservative typo corrections
precede partial direct matches; numeric identities are exact.
Clearing search restores browsing position. Searching and filtering retain the placement lock during an active assembly operation. Related assembly results open the existing
Assemblies browser. Vocabulary lives in presentation, never in physical admission.
Clicking or dragging a part opens the same nonmutating placement controller. Pointer
release assesses its final location, including touch taps. The existing surface owner
provides mounting faces, precision and attachment; empty-space placement uses the grid
with optional coordinates under Precise position. Confirmation sends one ordinary
cursor-guarded `place` or `surface-mount` command. Invalid and stale previews cannot
commit, and pending placement disables duplicate submission and cancellation.
Escape first cancels an active pickup, including when search has focus, and restores
the originating query, category, focus and scroll even after browsing changes. Normally only results scroll inside the tray; scaled text reduces the column count. When local Record an issue is open on desktop, the compact catalog scrolls as a whole so its search, categories, results and summary stay within their allocated region and cannot cover Stop recording. The compact
header and summary preserve complete visible tiles at the supported 1280 by 720 viewport.
At narrow widths a requested Parts browser replaces the sidebar, leaving the canvas
full width while Assemblies and recording remain retrievable.
Recent records accepted catalog placements. Expanded and compact catalogs are requested
surfaces; picking closes them and cancellation restores the origin. The existing About
window retains Overview and How to connect, with diagram links that reveal catalog
parts without placing them. Feedback and recording controls share the existing workshop footer.
The canvas, catalog and inspector retain their own pointer regions without per-control
offsets for a floating recording strip. The cell-to-motor example precedes optional power branching.
Learning admission: extend existing part help; no new lesson or example-browser entry.

Catalogue, part-help and assembly previews use the workshop’s part meshes and cosmetic finishes; preview lighting shares the same reflection field. These shared finishes improve recognition and connection authoring without adding a persistent panel or a learning-content entry.

The catalog offers Rope in Structure, All parts and rope/cable/towing searches.
This connection tool opens the selected part's requested
[rope inspector](../../src/presentation/rope-controls.mjs), shown only after requesting
Rope or selecting a part with a rope attachment. It does not displace controls on
unrelated parts. Build owns two explicit
surface attachments, length, diameter and material edits. Run shows completed length
and applied tension; authoring forms leave until Build returns. The same requested
help states the floor/body/self-collision exclusions, nominal material assumptions
and non-breaking overload stop. No lesson or permanent canvas panel is added.
Rope geometry follows physical nodes in Machine view and is hidden in exploded view.
Its contextual engineering explanation identifies stretch, damping and load limits
as uncalibrated assumptions of the simplified nylon model.

Paused camera images retain an explicit paused label even when view entry lands on
an exposure boundary. Feedback screenshots follow the visible canvas without changing
the optical sample.

Cameras are discoverable through catalog search and the Sensors category. Beginning
catalog placement returns to workshop view so the placement preview remains visible.
The selected camera inspector owns entry into the requested machine view and its
photo shortcut. The optional one-metre viewing cone is a temporary workshop-only
inspection guide, removed on selection change and hidden in machine view; it is not
a depth sensor or part of photographs. [Camera controls](../../src/presentation/camera-controls.mjs#source)
replace orbit/edit tools while viewing, keep vehicle controls and recovery reachable,
and restore the orbit on exit. Build is an explicitly unpowered placement preview;
Run shows power/live/stale/failure status; Paused may retain the identified old image.
The requested Photos dialog owns inspection, PNG/details export and explicit clearing.
Opening it releases held drive keys. Retained photos remain retrievable after camera
deletion and retries until this page closes. Camera help teaches mounting repair in
context; no additional learning entry is admitted for this delivery.

The selected receiver inspector owns Manual, Automatic, Learned and Off controls. Automatic
regulation shows measured and target total spring length, rather than extension from
rest length. Invalid targets preserve the accepted setting and explain the allowed
range. Pausing or losing window visibility leaves Automatic Off until deliberately
rearmed; the paused inspector keeps Off visible. Travel-sensor binding is a Build-only
operation in the selected sensor inspector. These controls leave with their selection.

The selected sensor inspector owns power/status readouts and explicit spring/joint
bindings. Requested range/contact/axis overlays leave with selection; the joint
angle diagram distinguishes an unavailable reading from zero. The Load Cell uses
this same selected inspector for signed axial force, the magnitude of the tick-average
force vector and unavailable-state explanations. Its selected +X arrow shows A-to-B
orientation from the completed pose; part help explains mounting, shear and explicit Automatic
rearming. These leave with selection or requested help, occupy existing regions and
displace no unique action. Learning-content disposition is **no entry**: extend the
existing part reference and sensor/Rules explanations for force units and invalid
readings; no new lesson or experiment entry is admitted.

The selected Logic
Controller inspector owns rules, generated code, draft preservation and Build-only
Apply. Rules may compare values or healthy missing-reading statuses. Editing code
disables rules; persisted Undo and cancelable Restore preserve the prior source.
Requested decision inspection shows the completed inputs, branch and applied
ownership together. Recent historical decisions survive repairs and offer export;
they do not replace live readings or become training examples.
The requested teaching window owns training, frozen candidates, failed-attempt
inspection and saved versions. Its live takeover strip remains reachable during
teaching or an active attempt. None of these surfaces grants broader observations
or inserts a permanent sensor dashboard. Optional contact/range/tilt/joint/motion
variants stay within the learning example collection. The passive loaded-pad variant invites an aluminium-to-steel material edit; tilt and encoder variants invite mount, zero and sign changes.

The document controls expose Choose scene and Edit scene in place of the old
Environment selector. The [scene editor](../../src/presentation/scene-editor.mjs#source)
replaces catalogue and inspector content while Editing scene is active; Done restores
the preceding machine context. Scene objects are selected in this scope only, and
machine parts remain protected. Move/Rotate handles and canvas positioning change
a draft; Apply scene publishes one ordinary command. V/W/E select the same tools
as their buttons; arrows and Page Up/Down move the proposal, and Alt plus these
keys rotates it. Space retains Run/Pause and period retains single-step through
the existing workshop handler, including while scene editing remains open in Run or Paused.
Unapplied scene drafts still block Run. Text fields retain native keyboard editing. A preview hides committed
scene meshes, including objects proposed for removal, and Cancel restores them.
Pointer capture loss or blur ends a gizmo gesture without publishing authored state. Frame scene explicitly frames
the physical setup without changing authored poses. Run/Paused retain the scene;
editing requires Build and Run requires finishing or cancelling a preview.

The bounded scene browser offers built-in and independently saved snapshots, an
actual-geometry footprint preview, scene-only import/export and explicit replacement
preview. Cancelling replacement retains the previous draft. Storage failure preserves
saved data and offers export recovery. Shared [document proposals](../../src/presentation/document-proposal.mjs#source)
bind scene and assembly previews to source document/cursor, require stale revalidation,
exclude duplicate/pending actions and reconcile uncertain replies against the exact
result in the source session. Context switches preserve camera and workshop history.
Detailed scene controls leave with selection and the browser leaves on dismissal.

Learning admission is **extend** for the existing suspension comparison: Edit scene
permits an independent bump edit, and comparisons still require matching scene,
approach speed and measurement window. The scene editor itself adds **no entry**;
Flat floor, Bump test, Hill climb and Steps are physical presets, not new lessons.

Measurements retains whole-machine motion and boundary warnings, and shows vertical
motion for the selected body when requested. Its acceleration value is the RMS of
100 ms-average vertical acceleration, computed from every completed 120 Hz sample,
not display frames or instantaneous shock peaks. The readout names the selected
body, origin tick, window and sample count. New runs, selection and restored session
identity start a visibly new window; missing completed history makes the measurement
unavailable. Closing measurements neither resets the plant nor hides boundary faults.

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

Every requested dialog dismisses through one shared top-right × from
[dialog close](../../src/presentation/dialog-close.mjs), named “Close <surface>”:
Help, Learn & examples, Check machine, Assemblies, Photos, Choose scene, recording
setup, project information, session completion, feedback and its privacy notice, plus
the nonmodal Teach a controller panel. The header row stays visible while long content
scrolls. Each owner keeps its close semantics and Escape behavior: feedback’s × uses the
same guarded close that saves or protects the draft; the privacy notice’s × only
dismisses the notice, and stopping tab recording remains an explicit action; closing
Photos keeps photos and closing session completion does not cancel delivery. Semantic
actions such as Send feedback, Keep or Discard draft, Retry uploads, Save photo, Clear
photos and Stop tab recording remain text buttons, never collapsed into the ×. Backdrop
dismissal remains a per-dialog choice. The nonmodal Part help window keeps its own
titlebar pair (expand and close) as an adjacent, separately owned surface.
Learn & examples opens a bounded browser. The top-right close control, Escape, or a
click outside dismisses it; clicks within its content keep it open. Starting a lesson moves its current step
into the parts area; leaving removes it. New examples enlarge this browser, not the
ordinary toolbar. The introductory activities identify their format and outcome: a guided
rolling build with an independent motor-setting attempt, a keyboard driving task, and
a spring-settling experiment. The spring inspector offers a requested damping comparison
through the ordinary Damping edit and Undo, preserving other tuning instead of loading
a second preset. Existing machine or nondefault scene work, including changed floor
settings with zero parts and obstacles, requires explicit replacement confirmation, with Download, Cancel and an explicit
replace action. A browser download request is not proof of a saved file: after download,
the player confirms they saved it before opening. Cancel and download failure preserve
the complete workshop. New, file opening and [example loading](../../src/application/workshop-app.mjs#source) uses ordinary load admission without an intermediate empty
machine; a rejected replacement keeps the dialog open. The catalogue retains focus,
expanded groups and scroll while simulation updates. Starting examples requires Build.

The requested Spring experiments collection includes editable sprung and rigid carts
on the same saved rounded bump, a pin-ended arm, manual/automatic adjustment and a
contact-release experiment. The rigid cart uses visible brace fasteners; disconnecting
them changes ordinary connectivity. Compare the same selected chassis body, matching
approach speed and measurement windows; different throttle histories or a smoother
ride do not establish lower energy use. Passive/driven wheel modules and the pin-ended
strut insert into the current machine through ordinary assembly commands. Pin mounts
and all parts remain editable; check clearance after changing mounting geometry.
These examples extend construction possibilities, not evidence of player comprehension
or qualification outside their tested finite operating envelopes.


Spur gears use the Motion catalog category and search, selected Connections and the existing part-help window.
Gear mesh explicitly leaves parts in place and requires independently supported
aligned shafts. The requested Learn & examples browser adds one editable gear-lift
experiment: predict the slower rotor, run the loaded arm, then disconnect the mesh
or reduce motor current and retry. Its prerequisite is motor/shaft authoring. This
adds a distinct speed-versus-load experiment; the rolling-machine example teaches
power and connection basics without a transmission load comparison. The need is a
foundational teaching hypothesis, not observed player confusion. It uses the existing
replacement/download/cancel lifecycle and adds no permanent workbench panel.
The [gear browser check](../../scripts/gear-browser-cases.mjs#implementation) exercises ordinary
palette, mesh, undo, save/reload and run actions, including construction from an
empty workshop with ordinary surface mounts, supported shafts and power wiring.
The lift uses an ordinary extension axle to separate its arm plane from the gears.
A gear motion-limit stop offers Build, shaft-support, motor-current and grounded
restart guidance through the existing message surface. It does not imply broken teeth.
Physical witnesses remain separate from player comprehension.

Release Coupler uses the Motion catalog category and search, the existing surface-snap operation, selected inspector
and requested part-help window. “Latch · Right” identifies its single opening attachment;
other faces remain ordinary mounts. Wire a cell and Command Receiver, hold W/Up in Run,
and inspect actuation or blocked-support status. Open attachments are identified as open
in the inspector and removed from the connection overlay. Cargo moves under existing
motion and forces. Build and Try again restore the authored start; saved machines retain
their Build connections. Crossing wires do not support cargo or disconnect automatically.
Ropes keep their authored attachments and tension after a fixed latch opens, including
when a rope shares the latch face. Only the released fixed attachment receives the open label.

Learning admission is **no entry**: the existing keyboard-driving activity covers cell
and receiver wiring, while contextual coupler help explains latch versus mount, interrupted
actuation and alternate paths. This adds no permanent lesson panel. The
[release browser journey](../../scripts/verify-release-coupler.mjs#implementation) constructs
from an empty workshop through visible controls, saves/reloads, releases cargo, exercises Try again after opening and interrupted actuation, and recovers
at ordinary and narrow layouts. Browser automation supplies no target-player acceptance.

The powered linear actuator uses the Motion catalog category and search, selected settings, existing receiver
controls and requested part help. Connect the existing Spring carriage, a cell and a
Command Receiver; W/up extends and S/down retracts. Releasing the keys opens active drive,
so an unpowered suspended load can fall. The inspector distinguishes completed travel,
stop proximity, low motion under power and electrical faults. Connection snap length
sets the next attachment; it does not reposition a connected carriage. The decorative
rod follows completed endpoints and adds no collider or physical support. Current
limit, maximum driven speed and travel settings stay in the selected inspector, while
material and winding details remain expandable. No permanent panel is added.
Learning admission is **no entry**: contextual power/receiver and part help cover the
bounded construction task; the passive spring lessons remain unchanged. This is a
teaching hypothesis, not observed comprehension. The ordinary browser construction
check includes a low-current failure, repair, key reversal, history and save/load.

The Ball uses the existing part catalogue and selected inspector: diameter is a
primary size edit; material and expandable Contact settings live in Engineering
details. Bounciness and Grip may inherit Material default or use Custom values;
changing material preserves visibly custom values, and choosing Material default
removes the corresponding override. These edits are Build-only.

The spring launcher now uses a loose Ball and an editable Catcher assembly of
ordinary solids; its connected roller wheels remain. The existing entry invites
moving the catcher and adjusting spring preload. Roll onto a spring extends the
same requested experiments collection with a gravity-driven supported beam and
spring plate. Neither addition creates a mandatory lesson or permanent explanation.
These finite fixtures are construction examples, not general contact qualification.

Try again and Sound occupy the existing machine-controls area. Try again appears
in Run/Paused and composes Build then Run, preserving authored edits, history,
selection and camera while creating a fresh attempt. Duplicate requests are blocked
until completion. [Sound controls](../../src/presentation/sound-controls.mjs#source) keep one compact
Sound off/on toggle and an adjacent settings icon beside Try again. The icon opens a small
Volume popup above the controls without expanding the panel; Escape and outside clicks close
it and restore focus. The range starts at 35%; 0% explicitly reads silent while retaining the
on preference. Sound starts off on each mount and requires a gesture. Build, retry and file
replacement retain preference; pause, hidden visibility, gaps and disposal silence existing
voices. Unavailable audio stays off with a retry message. Volume and button keyboard input
cannot drive receivers. Measured motor/travel and contact textures are illustrative; material
impact timbres combine both surfaces symmetrically. Visual motion remains readable without
sound. Learning admission: **no entry**; the existing motor and Ball experiments already provide
the activity. Missing contact history establishes a new silent baseline. File opening and retry
exclude one another before asynchronous reading or reset; rejected actions retain
recording receipts. Retry does not
reload a preset or move an individual live body to recover it.

Give feedback shares the existing workshop footer before, during and after recording. The view supplies this utility host to the application, so ordinary offline feedback adds no second workbench row and does not float over the canvas or inspector. The feedback button places its badge inline with reserved width and line height even when empty, keeping ordinary delivery updates from shifting controls. The footer retains its compact minimum height, wraps on narrow screens and permits longer recording errors to remain readable. During narrow-screen assembly placement, feedback and recording controls remain available while ordinary footer labels and shortcuts leave with the surrounding authoring chrome. When recording is unavailable, the row retains Give feedback and its draft/upload status while hiding unavailable recording controls. Active recording, delivery problems and received status remain visible when relevant; the compatible invitation opens dismissible recording setup, which Start recording can reopen. Capture requires its explicit Start action. Its task is to let the player explain an experience and know whether that contribution arrived. The dialog contains one optional voice clip and separately chosen image/context attachments; no attachment is selected by default. The scrollable body and visible actions fit narrow viewports. The top-right ×, Escape and Keep draft preserve recoverable work while composing; Back to building remains only as the primary return after sending or while reviewing history; Finish stops capture before resolving the unsent draft. Delivery confirmation uses a durable receipt and says “Sent to Yaniv for review,” without promising a response or fix. Draft and upload problems remain visible in the toolbar, with detailed history behind an explicit disclosure. Submitted voice, image and context remain inspectable in the receipt and local history. Context and images identify their actual capture time. The optional context contains the saved authored project and current workshop UI state, not a replay checkpoint or native physics snapshot. Reduced-motion preference removes feedback-button transitions. A rejected submission can become a corrected draft with a new identity; the original stays immutable, and another unfinished draft is preserved. View changes move keyboard focus to the new content without moving it during background delivery updates. The composer displaces the old recording-only feedback form and adds no permanent canvas panel. Learning-content disposition: **no entry**; the existing Help and examples remain sufficient because submitting feedback is a utility journey, not a new mechanical concept. Automated flow and layout checks do not establish delight, satisfaction or human acceptance.

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
Closing Measurements suppresses formatting of hidden readings while completed-tick
measurement accumulation continues. Reopening displays the retained window and
current readings. Boundary warnings remain independent of this preference.
Inspector readouts update their DOM only when formatted values change. The running
health hint refreshes in 30-tick bands after tick 120 and invalidates its cached
diagnosis when blueprint, session, epoch or operating mode changes.

Machine controls and measurements share a bounded layout at the lower workbench edge.
They sit beside one another where space allows and stack on narrower workbenches,
with independently scrollable contents and a reachable controls disclosure. The shared
area leaves empty space transparent to canvas input; each panel retains its own
visibility lifecycle.

Powered Lamp uses the searchable parts catalog, ordinary surface mounting and power/signal wiring.
Its selected inspector owns Light color, Brightness and Beam spread in Build, with
actual input, requested/delivered watts and modeled light output in Run/Paused.
Black tint warns that output is visually dark while consuming power. The existing
requested part help explains receiver replacement of default-on behavior, weak supply,
restart and the eight-lamp/no-shadow rendering limit. These controls leave with selection,
displace no unique action and add no permanent panel. Learning admission is **no entry**:
existing power and receiver explanations teach the same connection concept; contextual
lamp help suffices. A powered status lamp does not establish another actuator's success.

## Verification and review
<!-- doc-review {"version":1,"fingerprint":"ba960f0de8f0f5f124d6578a6e4ffe76607de2c66eee57474c988c2a4eb27531","dependencies":"docs/development/.reviews/ui-ux/verification-and-review.json","dependencyDigest":"b4fd89346c44ca0fc1a06d2df7f60b93b33663b8c639f22f9c879312325dea88","disposition":"updated","rationale":"The workbench content journey now also asserts that the examples header × stays inside the dialog and keeps a 36px target after scrolling at a 640×360 viewport; the authorable scenes journey only renamed the chooser close control to 'Close scene chooser'. Registration, scope discovery and remote-setup references are unchanged. Updated the journey description; automation remains separate from player evidence."} -->



Use the manifest's `workbench-content-lifecycle` invariant and
[registered browser check](../../scripts/manifest.json#check=verify-workbench-content)
with normal change discovery. `npm run inspect:change -- --files <paths>` identifies
owners, associated invariants, conservatively selected browser checks and affected
explanations. Unknown changes stay conservative. Registration is not execution.

[Scope controls](../../test/workbench-content.test.mjs) cover meaningful and wrong
states; the [browser journey](../../scripts/verify-workbench-content.mjs#source)
checks requested learning/results, scope against changed parts, preserved operations,
non-mutating help and the header × staying inside the dialog while examples overflow
a short viewport. The [learning example journey](../../scripts/verify-learning-examples.mjs#source)
checks the independent motor edit, Run and Undo, and a zero-damping comparison that
preserves other spring tuning. It also checks cancellation of example replacement
and the gear extension: construction from an empty workshop, palette insertion,
mesh disconnect/reconnect without
movement, Undo, downloaded save/reload and physical stepping.
The [scene journey](../../scripts/verify-authorable-scenes.mjs#source) covers authored
scene editing, pointer and keyboard tools, chronological history, a driven ramp
attempt and edited retry, library reuse, scene-only import/export and replacement/download
protection. It also exercises invalid loading, long saved lists and zoomed layouts.
[Editor controls](../../test/scene-editor.test.mjs#source) check real transform controls,
preview visibility and shared reconstruction geometry without a GPU. Existing manipulation, inspector, mirror, connection and input
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
as other development docs. Review each affected section, then use `npm run verify:candidate -- local`.
The existing CI documentation check rejects stale review evidence. Routine merges use
`npm run verify:candidate -- merge --base <commit>`; release and milestone work require
`npm run verify:candidate -- final`. No extra UX completion command or independent inventory is introduced.

Automation checks the named behaviors, not comprehension, enjoyment or completeness.
For a material new journey or layout, obtain an unassisted review that includes a
prediction before movement, a construction/repair attempt and recovery from an error.
Separate newcomers from returning users and distinguish unfamiliarity from persistent
failure. Agent review is useful fault finding, never a human acceptance receipt.
Use the existing [playtesting workflow](playtesting.md#remote-setup) and versioned
assessment protocols for real participants; do not require a new human session for
every cosmetic edit or claim a green test supplies F1.
