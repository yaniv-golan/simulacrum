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

Drag a part picture from the side palette into the scene. In Build mode, use **Select · V** and drag a part directly to move it on its horizontal plane; drag empty space or right-drag to orbit. **Move** / **Rotate** handles and Position & rotation fields remain available.

Arrow keys move 2.5 cm in camera-relative ground directions; Page Up/Down adjusts height. Alt + arrows rotates 90° without translating. **C** or **Ctrl/Cmd+C** duplicates the selected part one metre toward the camera, skipping occupied positions (up to 100 attempts). The copy preserves its settings and material and starts disconnected. **X/Delete** deletes; **Ctrl/Cmd+Z** undoes; **Esc** cancels a drag or clears selection. Shortcuts leave text/number inputs alone, and build edits are disabled during simulation. Open **Controls · ?** for help.
**Exploded view** separates parts for inspection without changing the machine. Select a part or a dashed connection to trace its endpoints and purpose. **Assembly view** restores the original layout. Camera framing eases with the separation and return; orbiting takes control immediately. Edits and Run return to it automatically. The inspection state and display offsets are included in playtest recordings.

The right-hand inspector keeps the selected part, its main control and connections together. Open **Machine** to choose another part. Component inspectors use a flat instrument layout with socket symbols and aligned readings. Motors provide a drive slider, Reverse / Off / Forward presets and an exact numeric value. Motor **Drive setting** controls the default open-loop command, not a guaranteed speed; a connected signal source owns the command instead. **Engineering details** reveals ratings, material and live measurements. The guided build highlights attachment endpoints before a step and confirms the actual connection afterward, distinguishing rigid mounts, rotating axles and power wires. Connection actions open directly beneath their port. Mechanical attachments move the smaller connected group, keeping the larger assembly in place; equal-sized groups keep the selected part in place. Hover or focus an attachment choice to see a labelled preview of what will move. Escape cancels the preview; Undo restores an attachment.

**Check machine** explains missing power or axle connections, empty cells, stopped commands and rigid mount paths that lock a driven axle. Each finding links to the relevant part. Low shaft speed under power is a symptom: check clearance and load before changing motor ratings. A check with no findings is not proof of physical feasibility.

Connected ports remain selectable for inspection in Build, Run and Paused; return to Build to change connections or settings. A fixed mount prevents relative movement; a wheel axle attaches a wheel to a motor or bearing while allowing the intended rotation. The axle connection itself holds the wheel, so it does not need a separate fixed mount.

Attached parts move together; disconnect first to reposition one part separately.
Undo/Redo and Ctrl/Cmd+Z reverse edits. **Follow motion** keeps a running machine
in view; **F** frames it. Build resets and reframes the machine for editing.
Save and Load preserve authored machines. A falling-body
engineering probe remains at `/test/browser/`.

For a stable local playtest, use `npm run build` followed by `npm run preview`.
The running page displays its build identifier. Use that identifier when recording
a human assessment; automated browser success is not human evidence.

Run `npx playwright install chromium` once before browser checks. `npm run gate`
executes the current cumulative milestone gate, including required browser checks.
`npm run test:unit` selects affected tests conservatively; `npm run test:all` runs all
unit/property tests. `npm run replay -- <bundle.json>` verifies a failure bundle
against the current implementation and runtime. Generated validation is refreshed
with `node scripts/generate-schema.mjs` and checked by the gate.

## Contributing

Read [AGENTS.md](AGENTS.md), [runtime contract](docs/contracts/runtime-v1.md) and
[Course contract](docs/contracts/course-v1.md). The manifest owns milestones and
executable gates. A green engine test is not walking evidence. Final completion
requires the ordinary legged machine's unbroken Course under frozen robustness,
plus real participant evidence for the human product bars.

At this stage each power circuit admits one cell and one motor, and a mechanically
connected assembly admits one motor. Coupled actuator allocation is required before
the multi-joint feasibility stage. Motor drivers account for charge, copper/cell
heat and measured shaft work. The current ground contact is not Course qualification.

MIT licensed. Product features are not partitioned into paid add-ons.

To report an interaction problem, open **Record an issue** in the left sidebar and choose **Start recording** before reproducing it. **Stop recording**, then **Save recording** exports a local JSON file with the build, starting checkpoint, elapsed event times, workshop controls, command results and UI context. Nothing is uploaded. Text-field keystrokes are omitted; pointer movement is sampled at 100 ms. Capture is bounded to 10,000 events or 2 MB and stops visibly at a limit. The latest recording survives reload in this browser; a recording interrupted by closing the page is an incomplete prefix. This diagnostic timeline is not a full video or a qualification replay.

Remote playtests can use `node scripts/playtest-server.mjs` with `PLAYTEST_PUBLIC_DIR` pointing at a frozen build, a separate private `PLAYTEST_DATA_DIR`, and a random `PLAYTEST_TOKEN` of at least 32 characters. The server binds loopback port 4180; expose it through an HTTPS tunnel and share `/join?token=...`. The invitation grants access to the workshop, not stored sessions. The player explicitly starts tab capture and can send text or microphone feedback tied to a view/state anchor. Pending uploads persist in IndexedDB and retry; keep the tab open until all are received. Tab capture requires a desktop browser supporting screen sharing; choose the workshop tab. Microphone use is optional. Server limits are 2 MB/event, 10 MB/media chunk and 1 GB/session; the browser stops capture if its offline queue reaches 100 MB. To review received evidence locally, run `node scripts/export-playtest.mjs <private-session-directory>` and open the resulting `review.html`. Remote usability recordings do not replace qualification evidence.

Remote playtests show a receipt beside each submitted comment after the server acknowledges it. Finishing stops capture and waits for the final recording uploads before confirming that the session is saved and the tab can be closed.

The remote feedback bar stays the same size while recording. Video and action uploads run automatically; routine queue counts are hidden. Upload problems remain visible, and Finish session confirms success only after all recording data is received.

**Snap to surface** aligns a selected part with a suitable top, side or underside
face. Click a face in the scene, or choose **Target surface**, then slide on that
face or use **Turn ±90°**. **Precise position** exposes millimetre offsets and an
angle; the grid offers 25 mm, 1 mm and free placement. **Attach** creates the fixed
mount. Uncheck **Attach after snapping** to position without connecting.
**Adjust mount** on the mounted part moves it and its attached wheel while the
receiving chassis stays in place. **Detach** preserves the current position.
Escape cancels and Undo restores the whole edit. With **Surface snap** enabled,
dragging a part onto a compatible face previews attachment on release. Orbiting
can reveal underside faces. Bases must fit and have clearance; a thin chassis
edge may be too small for a motor base, so use its top face near that edge.

Select a part and choose **Rename** beside its name in the inspector. Save name applies it everywhere; Escape cancels. Names persist in saves and support Undo/Redo. Added parts and copies receive distinct names, such as Chassis, Chassis-2 and Chassis-3.
