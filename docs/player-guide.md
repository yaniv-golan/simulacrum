# Player guide

Start with **Start guided build** to place and connect a supported three-wheel machine. It travels in a curve and has no steering. **Try driving example** opens an editable four-wheel machine. Or choose individual parts to build freely.

## Build and inspect

Drag a part picture from the side palette into the scene. In Build mode, use **Select · V** and drag a part directly to move it on its horizontal plane; drag empty space to orbit; right-drag to pan. **Move** / **Rotate** handles and Position & rotation fields remain available.

Arrow keys move 2.5 cm in camera-relative ground directions; Shift+↑/↓ or Page Up/Down adjusts height. Alt + arrows rotates 90° without translating. **C** or **Ctrl/Cmd+C** places a copy of the selected part beside it on the 2.5 cm grid, toward the camera, stepping past occupied positions (up to 256 grid steps); the view stays put when the copy is already visible. The copy preserves its settings and material and starts disconnected. **X/Delete** deletes; **Ctrl/Cmd+Z** undoes; **Esc** cancels a drag or clears selection. Shortcuts leave text/number inputs alone, and build edits are disabled during simulation. Open **Controls · ?** for help.
**Exploded view** separates parts for inspection without changing the machine. Select a part or a dashed connection to trace its endpoints and purpose. **Machine view** restores the original layout. Camera framing eases with the separation and return; orbiting takes control immediately. Edits and Run return to it automatically. The inspection state and display offsets are included in playtest recordings.

The right-hand inspector keeps the selected part, its main control and connections together. Open **Machine** to choose another part. Component inspectors use a flat instrument layout with socket symbols and aligned readings. Motors provide a drive slider, Reverse / Off / Forward presets and an exact numeric value. Motor **Drive setting** controls the default open-loop command, not a guaranteed speed; a connected signal source owns the command instead. **Engineering details** reveals ratings, material and live measurements. The guided build highlights attachment endpoints before a step and confirms the actual connection afterward, distinguishing rigid mounts, rotating axles and power wires. Connection actions open directly beneath their port. Mechanical attachments move the smaller connected group, keeping the larger connected group in place; equal-sized groups keep the selected part in place. Hover or focus an attachment choice to see a labelled preview of what will move. Escape cancels the preview; Undo restores an attachment.

**Check machine** explains missing power or axle connections, empty cells, stopped commands and rigid mount paths that lock a driven axle. Each finding links to the relevant part. Low shaft speed under power is a symptom: check clearance and load before changing motor ratings. A check with no findings is not proof of physical feasibility.

Connected ports remain selectable for inspection in Build, Run and Paused; return to Build to change connections or settings. A fixed mount prevents relative movement; a wheel axle attaches a wheel to a motor or bearing while allowing the intended rotation. The axle connection itself holds the wheel, so it does not need a separate fixed mount.

Move and Rotate move attached parts together. Use **Adjust mount** to reposition a
surface-mounted group on its receiving part; detach to move it freely.
Undo/Redo and Ctrl/Cmd+Z reverse edits. **Follow motion** keeps a running machine
in view; **F** frames it. Build resets and reframes the machine for editing.
Save and Load preserve authored machines.

To report an interaction problem, open **Record an issue** in the left sidebar and choose **Start recording** before reproducing it. **Stop recording**, then **Save recording** exports a local JSON file with the build, starting checkpoint, elapsed event times, workshop controls, command results and UI context. Nothing is uploaded. Text-field keystrokes are omitted; pointer movement is sampled at 100 ms. Capture is bounded to 10,000 events or 2 MB and stops visibly at a limit. The latest recording survives reload in this browser; a recording interrupted by closing the page is an incomplete prefix. This diagnostic timeline is not a full video or a qualification replay.

## Place, attach and resize

Picking a part from the catalog opens one row over the bench: the part, its state,
**Precise position** for exact X, Y and Z, **Place part** and **Cancel**. Click the
bench to place it there, or press Enter in a coordinate field; Escape cancels. Moving
over a mounting face hands the part to the surface panel, which owns faces and turning.

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

## Drive and diagnose

Command Receivers offer saved **Keyboard control** presets: forward/reverse,
steering, mixed left/right drive and custom keys. Rename a receiver to name its
action, then connect its Control output to the motor it controls. **Machine controls**
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

**Mirror parts…** copies a chosen group across a reference part’s center plane.
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

Select a motor or hinge for **Connect & test**; it opens by itself while power or the shaft is still missing. Follow the named power path, control
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
one rigidly connected group share a receiver but have opposing command-adjusted axes,
Check machine suggests checking direction alongside clearance and load; it does
not assume the intended vehicle behavior.


See [playtest instructions](development/playtesting.md) for sharing recorded feedback.

## Wiring display

The **Wiring** checkbox shows power and signal connections as schematic lines.
These lines do not restrict movement. Wiring starts on in Build and off in Run;
Pause and Step share the Run setting. Each setting lasts until you reload the workshop,
including when you start or load another machine.

Open a port to find its **Trace** actions. With Wiring off, **Trace**, an open **Connect & test** panel, and a selected wiring
port temporarily reveal their connections. Ordinary part selection does not reveal
hidden wiring. “Inspection connections shown” explains this temporary display;
the checkbox keeps your preference. Clear the trace, close the panel or cancel the
connection to end its reveal. Exploded view shows all connections through the return
to machine view. Mechanical attachments and shafts remain visible independently.
