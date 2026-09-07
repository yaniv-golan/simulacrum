# Simulacrum Foundry

A mechanical construction workshop for players who want to understand why their
machines move—and why they break. Motors draw real power, connections depend on
physical alignment, and controller programs operate ordinary components.
The interface aims for quick building with optional engineering depth.

This branch is under construction. The current implementation provides a DOM-free
construction API, strict machine saves, fixed physical attachments, deterministic
stepping, powered motors and receivers, checkpoints and failure replay. The first
playable construction loop is available; human assessment, sandboxed programs and
locomotion qualification remain incomplete. The released version remains
available from [Releases](https://github.com/yaniv-golan/simulacrum/releases).

## Local development

Use Node 24.18.x and run `npm ci`. `npm run dev` starts the local server. The current
workshop opens at `/`. Choose **Start guided build** to place and connect a supported
three-wheel machine. It travels in a curve; this starter has no steering. Every
part, rating and connection remains editable through the ordinary command surface.

Drag a part picture from the side palette into the scene. In Build mode, use **Select · V** and drag a part directly to move it on its horizontal plane; drag empty space to orbit; right-drag to pan. **Move** / **Rotate** handles and Position & rotation fields remain available.

Arrow keys move 2.5 cm in camera-relative ground directions; Page Up/Down adjusts height. Alt + arrows rotates 90° without translating. **C** or **Ctrl/Cmd+C** duplicates the selected part one metre toward the camera, skipping occupied positions (up to 100 attempts). The copy preserves its settings and material and starts disconnected. **X/Delete** deletes; **Ctrl/Cmd+Z** undoes; **Esc** cancels a drag or clears selection. Shortcuts leave text/number inputs alone, and build edits are disabled during simulation. Open **Controls · ?** for help.
**Exploded view** separates parts for inspection without changing the machine. Select a part or a dashed connection to trace its endpoints and purpose. **Assembly view** restores the original layout. Camera framing eases with the separation and return; orbiting takes control immediately. Edits and Run return to it automatically. The inspection state and display offsets are included in playtest recordings.

The right-hand inspector keeps the selected part, its main control and connections together. Open **Machine** to choose another part. Component inspectors use a flat instrument layout with socket symbols and aligned readings. Motors provide a drive slider, Reverse / Off / Forward presets and an exact numeric value. Motor **Drive setting** controls the default open-loop command, not a guaranteed speed; a connected signal source owns the command instead. **Engineering details** reveals ratings, material and live measurements. The guided build highlights attachment endpoints before a step and confirms the actual connection afterward, distinguishing rigid mounts, rotating axles and power wires. Connection actions open directly beneath their port. Mechanical attachments move the smaller connected group, keeping the larger assembly in place; equal-sized groups keep the selected part in place. Hover or focus an attachment choice to see a labelled preview of what will move. Escape cancels the preview; Undo restores an attachment.

**Check machine** explains missing power or axle connections, empty cells, stopped commands and rigid mount paths that lock a driven axle. Each finding links to the relevant part. Low shaft speed under power is a symptom: check clearance and load before changing motor ratings. A check with no findings is not proof of physical feasibility.

Connected ports remain selectable for inspection in Build, Run and Paused; return to Build to change connections or settings. A fixed mount prevents relative movement; a wheel axle attaches a wheel to a motor or bearing while allowing the intended rotation. The axle connection itself holds the wheel, so it does not need a separate fixed mount.

Move and Rotate move attached parts together. Use **Adjust mount** to reposition a
surface-mounted group on its receiving part; detach to move it freely.
Undo/Redo and Ctrl/Cmd+Z reverse edits. **Follow motion** keeps a running machine
in view; **F** frames it. Build resets and reframes the machine for editing.
Save and Load preserve authored machines. A falling-body
engineering probe remains at `/test/browser/`.

For a stable local playtest, use `npm run build` followed by `npm run preview`.
The running page displays its build identifier. Use that identifier when recording
a human assessment; automated browser success is not human evidence.

Run `npx playwright install chromium chrome` once before browser checks. `npm run gate`
executes the current cumulative milestone gate, including required browser checks.
`npm run test:unit` selects affected tests conservatively; `npm run test:all` runs all
unit/property tests. `npm run ci` runs the automated structural and unit checks
within the 180-second development budget, independently of human milestone approval.
`npm run test:browser` builds once and runs every manifest-registered browser check
serially, including performance qualification. `npm run test:browser:smoke` runs the
construction smoke subset; `npm run test:performance` runs the isolated performance
checks. Browser reports bind the served build and current source and include each
check's duration and output. CI runs the complete browser suite; Linux needs Xvfb
for tab-capture checks. The milestone gate still requires real human evidence.
`npm run format` applies the pinned formatter; generated validators are excluded.
`npm run replay -- <bundle.json>` verifies a failure bundle
against the current implementation and runtime. Generated validation is refreshed
with `node scripts/generate-schema.mjs` and checked by the gate.

## Contributing

Read [AGENTS.md](AGENTS.md), [runtime contract](docs/contracts/runtime-v1.md) and
[Course contract](docs/contracts/course-v1.md). The manifest owns milestones and
executable gates. A green engine test is not walking evidence. Final completion
requires the ordinary legged machine's unbroken Course under frozen robustness,
plus real participant evidence for the human product bars.

A power circuit can supply multiple motors from one cell. Multiple cells on the
same circuit are not supported. Separately powered motors can also share a mechanical assembly. Their ordered torque kicks account
for shared-body velocity changes before joint/contact integration. Motor drivers account for charge, copper/cell
heat and measured discrete shaft-kick work before contacts. The completed energy ledger separately exposes integration energy changes; these are not motor heat. The current ground contact is not Course qualification.

MIT licensed. Product features are not partitioned into paid add-ons.

To report an interaction problem, open **Record an issue** in the left sidebar and choose **Start recording** before reproducing it. **Stop recording**, then **Save recording** exports a local JSON file with the build, starting checkpoint, elapsed event times, workshop controls, command results and UI context. Nothing is uploaded. Text-field keystrokes are omitted; pointer movement is sampled at 100 ms. Capture is bounded to 10,000 events or 2 MB and stops visibly at a limit. The latest recording survives reload in this browser; a recording interrupted by closing the page is an incomplete prefix. This diagnostic timeline is not a full video or a qualification replay.

Remote playtests can use `node scripts/playtest-server.mjs` with `PLAYTEST_PUBLIC_DIR` pointing at a frozen build, a separate private `PLAYTEST_DATA_DIR`, and a random `PLAYTEST_TOKEN` of at least 32 characters. The server binds loopback port 4180; expose it through an HTTPS tunnel and share `/join?token=...`. The invitation grants access to the workshop, not stored sessions. The player explicitly starts tab capture and can send text or microphone feedback tied to a view/state anchor. Pending uploads persist in IndexedDB and retry; keep the tab open until all are received. Tab capture requires a desktop browser supporting screen sharing; choose the workshop tab. Microphone use is optional. Server limits are 2 MB/event, 10 MB/media chunk and 1 GB/session; the browser stops capture if its offline queue reaches 100 MB. To review received evidence locally, run `node scripts/export-playtest.mjs <private-session-directory>` and open the resulting `review.html`. Remote usability recordings do not replace qualification evidence.

Remote playtests show a receipt beside each submitted comment after the server acknowledges it. Finishing stops capture and waits for the final recording uploads before confirming that the session is saved and the tab can be closed.

The remote feedback bar stays the same size while recording. Video and action uploads run automatically; routine queue counts are hidden. Upload problems remain visible, and Finish session confirms success only after all recording data is received.

**Snap to surface** positions and attaches a selected part to a top, side or underside
face. Click a receiving face, or drag the preview along it, then release to attach.
A translucent preview and a nearby message distinguish pending placement from a
completed joint. Blocked placements explain the obstruction and remain uncommitted.
**Position only** places the part without a joint; each new placement defaults to
attachment. Choosing a target in the inspector previews it; **Attach** or Enter
confirms numerical adjustments. The same release behavior applies to direct part
dragging and palette drops with **Surface snap** enabled.

The center and diamond edge markers align the mounting footprint on the receiving
face. **Rotate on surface** turns around the mount. **Precise position** exposes
millimetre offsets, angle and **Move increment** (25 mm, 1 mm or Free). Free removes
the movement grid while center and edge inference remains available.
**Adjust mount** repositions the mounted group while its receiving part stays put.
**Detach** preserves the current position. Escape or a release outside the canvas
cancels pointer placement; Undo restores a completed edit. Bases must fit and have
clearance; a thin chassis edge may be too small for a motor base, so use its top face
near that edge.

Select a part and choose **Rename** beside its name in the inspector. Save name applies it everywhere; Escape cancels. Names persist in saves and support Undo/Redo. Added parts and copies receive distinct names, such as Chassis, Chassis-2 and Chassis-3.

Attachment status distinguishes **Unattached**, **Bolted to** and **Axle attached to**.
Surface placement keeps rejected poses visible with a red outline and identifies
obstructions. Surface edge markers align the mounting footprint to the indicated
edge; rotate the part to aim its shaft outward. Drag the preview to slide,
then release to attach. Socket previews also accept a click to attach; red
previews explain why attachment cannot proceed. Escape cancels either operation.
Underside inspection hides the ground visually; physics is unchanged. **Frame
machine** restores a useful angle and fits the machine clear of inspection overlays.

Select a wheel to change **Diameter (mm)** using the number field or slider
(100–1,000 mm). Input previews the size; releasing the slider or confirming the
number applies it. Escape cancels a preview. The axle and wheel width stay fixed;
collision radius, mass and rotational inertia follow the authored diameter and
material. Overlapping placements are refused with local feedback. Undo/Redo and
Save/Load preserve the diameter. An omitted diameter uses the canonical 200 mm
wheel size.

Escape discards an unconfirmed numeric property edit. Wheel diameter numbers accept precise millimetre values; the slider moves in 10 mm increments. Mechanical socket attachment smoothly reframes the assembled machine. Fine floor lines provide a stationary motion reference.

Solid parts cannot occupy the same space. This applies to free moves, numeric and
keyboard transforms, rotation, resizing, insertion, attachment and loaded machines.
A blocked drag has a red preview; releasing it restores the original placement and
explains the obstruction. Failed edits preserve Undo/Redo history. Touching surfaces
are valid; wheel checks use the canonical cylindrical hull, not its bounding-box
corners. Current parts have no authorable cutouts: a drawn hub detail is not a hole
through which another solid can pass. During Run, ordinary contact physics applies.

Command Receivers offer saved **Keyboard control** presets: forward/reverse,
steering, mixed left/right drive and custom keys. Rename a receiver to name its
action, then connect its Signal output to the motor it controls. **Machine controls**
shows actual keys and missing signal wires. Selection never redirects driving.
Hold releases to zero; Toggle switches on each press and resets on pause or focus
loss. Zero commands let a drive motor coast and make a powered hinge target center.
Custom actions use ordinary connected
components; naming an action does not create a mechanism.

On an empty workbench, **Try driving example** opens an ordinary editable machine
with a shared cell, two powered wheels and two keyboard receivers. W/S or up/down
drive; A/D or left/right mix the two wheel drives to turn. Release to coast; Space
pauses. The example's materials, gains, mounts and wiring can all be changed.
The motion readout reports mass-weighted speed and horizontal displacement from
start, including detached parts. Returning to Build keeps a last-run measurement
for comparison; different input sequences and durations affect the result. This
workshop activity is not Course qualification.

The workshop floor is 200×200 metres with a painted perimeter. The motion readout
warns near its edge and offers **Return to Build** if a machine leaves or falls.
It does not automatically brake, teleport or support a machine beyond the floor.

**Mirror assembly…** copies a chosen group across a reference part’s center plane.
The member list makes the scope explicit; the blue plane and preview show the copy
before creation. Internal connections and mechanical mounts to the reference are
copied. Other external connections are listed as omitted and must be reconnected.
Settings and materials remain unchanged, so test motor direction after mirroring.
The reference stays in place; Undo removes the complete mirrored copy. Overlapping
or geometrically unrepresentable reflections are refused.

A **Powered Hinge** turns its shaft toward a target angle using electrical power
and motor torque. Attach a **Wheel Hub** steering input to the hinge output, then
attach a wheel to the hub’s horizontal axle: the hub steers while the wheel spins
freely. Connect a cell and a receiver configured for steering. Zero command targets
zero angle; returning to center requires power and sufficient torque. Engineering
details exposes angular limits and motor/driver settings. These parts are included
in the current M3b construction scope; their availability does not qualify later
physical milestones.

Select a motor or hinge for **Connect & test**. Follow the named power path, control
source and moving output; missing links open the usual wiring controls. **Test in
Run** simulates the whole machine, including gravity and other powered components.
For a directly wired receiver, hold +/− to temporarily override its keyboard input.
Release returns to that input, or zero when no key or toggle is active. Receivers
owned by a wired controller cannot be overridden here. A motor may coast; a hinge
may move toward center. Live readings show
actual current and motion. **Return to Build** resets the machine for editing.

**Reverse direction** on an actuator reverses its response to both its default
setting and wired control. This is useful for opposite-facing wheel motors sharing
one receiver. Mirroring does not silently change it. When stalled wheel motors on
one rigid assembly share a receiver but have opposing command-adjusted axes,
Check machine suggests checking direction alongside clearance and load; it does
not assume the intended vehicle behavior.
