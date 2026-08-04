# Simulacrum Foundry

An interactive Three.js mechanical construction workshop. Components are real selectable objects with named ports, editable behavior, visible connections, and mechanism-specific simulation.

> **Documentation version:** This README describes the current unreleased
> `main` branch. The latest tagged stable release is 0.1.0 and does not include
> every feature described below. Download 0.1.0 from **Releases**, or use
> **Code → Download ZIP** for the current source checkout. See the
> [changelog](CHANGELOG.md) for the exact differences.

## Choose your path

- **Play for the first time:** follow [Install and play](#install-and-play--beginner-friendly-guide), then [Recommended first session](#recommended-first-session).
- **Look up controls:** jump to [Controls](#controls) or use the in-game **Learn** panel.
- **Understand a feature or contract:** use the [documentation map](docs/README.md).
- **Contribute:** start with [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
- **Review project policy:** see the [changelog](CHANGELOG.md), [security policy](SECURITY.md), [code of conduct](CODE_OF_CONDUCT.md), and [MIT license](LICENSE).

## Install and play — beginner-friendly guide

Simulacrum runs locally on your computer. It does not need Steam, a game launcher, an account, or a server. Installation takes roughly five minutes and only needs to be done once.

### What you need

- A Windows or macOS computer.
- A modern browser such as Chrome, Edge, Firefox, or Safari.
- An internet connection for the first installation.
- About 1 GB of free disk space for the source and installed dependencies.

### Step 1: Install Node.js

Node.js is the small program that starts Simulacrum on your computer. It also installs `npm`, which downloads the game’s required software automatically.

1. Visit [nodejs.org](https://nodejs.org/).
2. Download the version marked **LTS**. Do not choose the **Current** version.
3. Open the downloaded installer.
4. Accept the default options and finish the installation.
5. If a Terminal or PowerShell window was already open, close it and open it again.

Simulacrum 0.1.0 uses Node.js 24.18 LTS. Install the **LTS** download offered by the Node.js website; Node 20 is end-of-life and is not supported.

### Step 2: Download Simulacrum

The easiest method does not require Git or developer tools:

1. Open the public [Simulacrum repository on GitHub](https://github.com/yaniv-golan/simulacrum). No GitHub account is required.
2. For the latest stable version, open [Releases](https://github.com/yaniv-golan/simulacrum/releases), choose the newest release, and download **Source code (zip)** under **Assets**. To try the newest unreleased changes instead, use the repository's green **Code** button and choose **Download ZIP**.
3. Open the downloaded ZIP file and extract it.
4. Move the extracted `simulacrum` folder somewhere easy to find, such as Documents.

Do not run commands while the project is still inside the ZIP file.

### Step 3: Open a command window in the Simulacrum folder

#### Windows

1. Open the extracted `simulacrum` folder in File Explorer.
2. Click the address bar at the top of File Explorer.
3. Type `cmd` and press Enter.
4. A black Command Prompt window should open in the correct folder. Its prompt should end with the location of your `simulacrum` folder.

Command Prompt is recommended because some Windows PowerShell configurations block npm scripts. If you prefer PowerShell and it reports that `npm.ps1 cannot be loaded because running scripts is disabled`, close it and use the `cmd` method above; you do not need to weaken Windows security settings.

#### macOS

1. Open the Terminal application. It is in **Applications → Utilities → Terminal**.
2. Type `cd` followed by one space, but do not press Return yet.
3. Drag the extracted `simulacrum` folder from Finder into the Terminal window.
4. Press Return.

### Step 4: Install the game’s required software

Copy the following command, paste it into Command Prompt on Windows or Terminal on macOS, and press Enter:

```bash
npm install
```

Text will scroll while installation runs. This is normal. Wait until the command prompt reappears. You only need to run `npm install` again after downloading a newer version of the project.

### Step 5: Start Simulacrum

In the same window, run:

```bash
npm run dev
```

When the window displays a line beginning with **Local**, open the shown address in your browser. It is normally:

[http://localhost:5173](http://localhost:5173)

`localhost` means the game is running only on your own computer. Keep Command Prompt or Terminal open while playing.

### Starting the game next time

You do not need to reinstall anything:

1. Open Command Prompt or Terminal in the `simulacrum` folder using Step 3.
2. Run `npm run dev`.
3. Open [http://localhost:5173](http://localhost:5173).

### Stopping the game

Return to Command Prompt or Terminal and press **Ctrl+C**. On Windows, confirm with `Y` if Command Prompt asks **Terminate batch job?** Closing the command window also stops the game.

### Common problems

**Windows: “node” or “npm” is not recognized**

- Close and reopen Command Prompt after installing Node.js.
- If that does not work, restart the computer.
- Run the Node.js LTS installer again and keep its default options.

**macOS: `command not found: node` or `command not found: npm`**

- Close and reopen Terminal after installing Node.js.
- If that does not work, restart the Mac.
- Run the Node.js LTS installer again and keep its default options.

**`npm install` reports an error**

- Confirm that the computer is connected to the internet.
- Confirm that Command Prompt or Terminal is inside the extracted `simulacrum` folder. That folder must contain `package.json`.
- Delete the `node_modules` folder if it exists, then run `npm install` again.

**The browser says the page cannot be reached**

- Confirm that `npm run dev` is still running and its command window remains open.
- Use the exact **Local** address printed in that window. Another program may cause Simulacrum to choose a port other than 5173.
- If Windows asks whether Node.js may communicate on private networks, choose **Allow**.

**I downloaded a newer ZIP**

- Extract it into a new folder rather than mixing it with the old copy.
- Follow Steps 3–5 again. Designs stored in Blueprint Exchange remain available as long as the same browser and local address are used; download important designs as `.simshare` files for a portable backup.

## Optional: create a production build

This is intended for technical users who want optimized static files:

```bash
npm run build
npm run preview
```

The optimized files are placed in `dist/`. Normal players should use `npm run dev` instead.

## Recommended first session

Choose **Start Guided Build**. The six-step tutorial teaches the actual interaction model, including adding a real power source:

1. Place a Powered Motor.
2. Place a 12T Pinion Gear.
3. Connect the motor's `SHAFT` port to the pinion.
4. Place a Power Cell and connect its `POWER` port to the motor.
5. Place a 24T Spur Gear and connect its `MESH` port to the pinion.
6. Start simulation and observe the resulting mechanism.

The included gearbox uses a 12-tooth pinion driving a 24-tooth gear. The output rotates in the opposite direction at half speed, with twice the ideal torque.

## Component library

- **Structure:** alloy beams and mounting plates.
- **Mechanical:** axles, 12T and 24T gears, powered motors, hinge joints,
  levers, springs, dampers, linear guides, power-limited linear actuators,
  powered release couplers, rounded wheels, and distributed Rope.
- **Smart:** logic controllers, rotation sensors, batteries, electric motors, fixed-pitch rotors, and pressure nozzles.
- **My Parts:** select one component or a connected multi-part mechanism, press **+**, give the assembly a name and accent, and reuse it from the persistent personal library. Relative transforms, tuning, controller programs, and every internal connection are retained. Saved assemblies remain available after reloading the browser and can be removed from their library card.
- **Pneumatics:** Grip Wheels, Electric Air Compressors, Three-Way Pneumatic Valves, Tire Pressure Sensors, and rated Air Reservoirs build ordinary dry-air circuits. The reusable **Four-wheel central tire inflation system** shows independent wheel regulation without a vehicle-wide pressure command.

Component silhouettes, interfaces, and rendered motion come from the same
canonical geometry descriptors used by editing and simulation. Rounded tires,
meshing toothed gears, helical springs, pressure vessels, compressors, valves,
sensors, lamps, and thrusters retain their authored envelopes and port frames.
Spring coils compress and extend from completed mechanism coordinates rather
than a presentation-only animation. Bounded material finishes and a procedural
reflection environment distinguish steel, aluminum, rubber, Rope, composites,
ablative surfaces, and player-painted structure. Camera-aware detail tiers
preserve part IDs, selection, ports, and major silhouettes; assemblies above
128 parts use reduced shadows and performance projections automatically.

Connections are classified and drawn by function: orange for power, mint for mechanical links, gold for meshed gears, and blue for signals. In Build and Connect modes these colors expose the complete authored relationship graph. During simulation, mechanical and mesh relationship arcs disappear while power, signal, and resource connections with canonical physical terminal frames remain as live conduits attached to their moving endpoints. Gear meshes automatically use tooth-count ratios.

Motors do not receive free energy. A motor only turns when its POWER network reaches a charged Power Cell. The inspector reports **POWERED** or **NO POWER**, and battery charge drains according to configured motor load while simulation runs.

Mechanical connections are physical placement operations, not abstract torque links. Connecting a gear hub to a motor SHAFT snaps the hub onto the shaft axis. A Grip Wheel connected through `AXLE` snaps onto the nearest free end of a Steel Axle, with the second wheel automatically using the opposite end; a wheel may also mount directly to one motor shaft. Connecting two gears snaps their centers using their pitch radii and tooth counts. Moving a hub radially off-axis, beyond its axial seat, or out of angular alignment marks the connection red and **MISALIGNED**; torque no longer transfers until the parts are reconnected and aligned.

## Fast assembly editing and engineering overlays

- Drag a box on neutral workbench space to select many components. Left-to-right selects only fully enclosed parts; right-to-left uses a dashed amber box and selects every part it touches. Ctrl/Cmd/Shift-drag adds to the current selection.
- A multi-selection names its mint primary component explicitly in the viewport, entity tree, and Inspector. Choose another selected component from the Inspector to make it primary without changing the selection. Exact XYZ pivot coordinates, alignment, and equal-spacing distribution use that primary; each edit is one undoable history entry.
- Exact positions use the authored Workshop frame in metres: positive X is east, positive Y is up, and positive Z is north, so the workbench is the XZ plane. The displayed value is the selection pivot; yaw rotates about Y.
- The Inspector reports exactly how many components, external connections, and cross-selection controller bindings an action affects. **Frame** fits the complete selected set. **Isolate** hides other components and wires only in the current view; **Show All** restores their prior visibility and the previous camera without changing the blueprint, history, physics, or selection.
- Press **+** in the component-library header to save the complete connected selection as a reusable subassembly. Placing it creates fresh part and connection IDs, so multiple instances remain independent.
- Open **Tools → Engineering** to replace the catalog with a focused analysis drawer. Toggle center of mass, full-submersion center of buoyancy, nominal thrust axis, and unconnected solid-interference overlays independently. The readouts come from the same component mass, material-density, orientation, and engine-force contracts used by simulation.

Complete-machine Blueprints and My Parts serve different scales: Blueprints include mission/remotes and restore the whole workbench, while a reusable subassembly is a small connected mechanism intended to be placed repeatedly inside other machines.

## Open construction challenges

Choose **Challenges** to open four outcome-based engineering contracts alongside
the five reference calibrations. Cargo Relay, Water Haul, Air Courier, and Up and
Home each add a physical 80 kg Mission Payload and accept more than one solution:
wheels, legs, rotors, wings, rockets, boats, and hybrids are all valid when the
ordinary physics telemetry meets the contract.

Choose **Start empty** to begin with only the payload, or **Use current build** to
test the machine already on the plate. The live contract shows payload security,
distance, altitude, water transit, controlled stopping, damage, and fatigue as
separate criteria. **Retry exact start** restores every pre-test part, connection,
setting, and script. Scores compare elapsed time, mass, complexity, energy use,
and damage; persistent reliability records both repeatability and distinct
successful solution classes. See [docs/CHALLENGE_LAB.md](docs/CHALLENGE_LAB.md).

## Workshop Test Reserve

Choose **Test Ground** while simulation is stopped to open a compact map of the
480 m x 360 m proving ground surrounding the construction plate. You can start
from the board, place the complete assembly on one of five clearance-checked
staging pads, run a free test, or select one of eleven guided trials. Deployment is
one undoable rigid transform of the current build; it does not repair,
stabilize, or replace the machine.

The trials cover side-by-side surface sampling, braking, suspension, measured
hills, trail navigation, shallow and deep water, runway operations, helipad
precision, and a mixed-district relay. Route gates observe immutable completed
telemetry. They may require real contacted materials, fluid entry, grounded or
airborne state, speed limits, intact structure, and a controlled finish, but
cannot change grip, forces, controller commands, or machine state. **Retry exact
start** restores the captured deployment and records compatible personal best
and reliability evidence against the exact site, material, route, and
deployment fingerprints.

See [Workshop Test Reserve](docs/TEST_GROUND.md) for the map, staging workflow,
trial objectives, exact retry behavior, and evidence rules.

## Buildable remote controls

Open **Remote** in the header to create and operate a command console. Commands are not global magic: a target component must have a blue signal connection to a Logic Controller, and that controller must have an orange power connection to a charged Power Cell.

Four templates provide useful starting points:

- **Powered Cart:** bidirectional drive throttle, steering, hold-to-brake, and lights.
- **Humanoid Robot:** gait speed, stride length, balance assist, crouch, and emergency stop.
- **Flight Drone:** collective thrust, yaw, pitch, roll, and altitude hold.
- **Space Mission:** arm, launch, main throttle, target altitude, staging, and abort.

Every control shows its channel, target component, keyboard shortcut, and live online/offline state. **Customize** provides a complete control designer:

- Rename the control and change its command channel.
- Switch between range, toggle, hold, and pulse widgets.
- Configure range minimum, maximum, and step size.
- Bind or clear a target component.
- Capture a unique keyboard shortcut.
- Assign the control to common Direct Control actions such as forward,
  reverse, left, right, brake, or lights, including the exact pressed and
  released values for range/hold actions.
- Move controls up or down, duplicate them, delete them, or add new auxiliary controls.
- Pin any profile as a compact **Direct Control** surface. The pinned panel is generated from these same editable controls, so changes appear in both places without privileged demo-only UI.

For range controls, pressing the assigned key increases the value by one configured step; `Shift` plus the key decreases it. Key repeat enables continuous adjustment. Toggle shortcuts toggle normally and `Shift` forces them off. Hold controls remain active while the key is held; pulse controls send once per keypress. Remote shortcuts take precedence over workshop shortcuts, but are disabled while typing in an input. Duplicate key assignments are automatically removed from the previous control.

Portable remote designs, semantic action bindings, targets, ordering, defaults,
and shortcuts persist in the machine blueprint. Current slider/toggle values,
selection, active profile, and controller-window state are local workspace
data, so rearranging the UI never changes the machine asset. A semantic action
always resolves to its one authored control, target, and channel; it never
commands every wheeled assembly or depends on a profile being named `cart`.
Ordinary receivers and Logic Controller programs then route those inputs to
the exact connected actuators.

## Field workshop environment

The 44 m construction plate and adjacent operations building anchor one
continuous physical campus. A closed perimeter/service-road network connects
the apron, handling ground, nine equal-length surface lanes, three-lane
durability field, terrain park, water park, dense trail grove, airfield, and
open experiment lawn. Its 22 surface regions, 11 measurable terrain features,
irregular 3.2 m pond with a dry island, shallow ford, physical bridge, 254 m
runway, helipad, seeded trees, rocks, logs, steps, curbs, markers, and signs all
derive from one strict `test-site-definition-v2` used by collision, rendering,
telemetry, the map, and trials.

The workbench is a finite raised platform, not an infinite ground plane. Its
south side has a continuously graded concrete ramp for routine access to the
Test Reserve; the north, east, and west edges remain exposed for deliberate
drop-and-landing tests. The mission display switches from `ROVER FALLING` to
`FIELD TERRAIN` when the rover reaches the grass.

Dry and wet asphalt, concrete, compacted soil, grass, gravel, sand, mud, and
low-grip polymer have explicit physical material identities. Tires report the
actual contacted surface and solve load-sensitive traction, combined slip, and
material-specific rolling resistance. Feet, skids, landing legs, and loose
parts use the same support-material authority. Soft ground adds bounded,
load-dependent foundation compliance and sinkage rather than acting as a renamed
low-friction plane. Water depth, buoyancy, drag, and bed contact agree with the
rendered basins.

Dust, spray, skid marks, wet tracks, and shallow ruts are bounded presentation
effects derived from completed contact telemetry and are cleared on reset.
Grass scatter reduces independently at distance or for large assemblies, while
physical fixtures, engineered surface regions, water, terrain, and colliders
remain present. The reserve map uses both labels and patterns so material
meaning does not depend on color alone.

## Earth-scale deterministic world

The workshop sits at a fixed numeric geodetic reference on a 6,371 km-radius Earth. Long-distance coordinates follow great-circle geometry. Generalized continent, ocean, island, and major inland-water outlines come from Natural Earth 1:110m physical geography, so the globe and ground classification follow recognizable real-world geography rather than invented landmasses.

The local world is generated in 512 m coordinate-addressed tiles. A deterministic hash of each tile coordinate drives continuous elevation noise, biome, hills, mountain relief, river contours, natural pools, trees, gravel areas, and roads. Returning to the same coordinate reconstructs the same feature signature without storing the tile on disk.

Only a 7×7 visual neighborhood is kept in memory, with physical heightfield colliders for the nearest 3×3 tiles. Distant tiles are disposed as the player travels. A floating origin rebases the local Three.js and Cannon coordinate frames while retaining global east/north position, preserving rendering and physics precision across an Earth-sized world. The authored workshop reserve blends continuously into generated terrain and remains clear of procedural roads, pools, and trees.

## Five-machine validation series

Open **Demos** in the header and follow the numbered complexity ladder. Loading a structure also opens its matching remote. Every stage remains an ordinary editable assembly rather than a locked showcase.

- **1 · Powered Gearbox:** battery, powered motor on two rear-flange uprights, controller, mounted 12T input gear, a 24T output gear carried between two pillow-block bearings on wide-foot structural pedestals, and an outboard rotation sensor. The enlarged mounting plate contains every component, at least 0.30 m of live clearance remains beneath the gear tips, and canonical power/signal terminals keep the real conduits visible during operation. It demonstrates electrical enablement, shaft alignment, opposite rotation, and exact 2:1 reduction.
- **2 · Suspension Rover:** powered dynamic chassis, four suspended wheels, motor, steering hinge, battery, controller, power network, command link, and two functional headlights. Each 1,600-lumen headlight uses inverse-square attenuation, a dipped soft-edged beam, dynamic shadow casting, and real 110 W combined battery draw. Its tire constraint provides longitudinal traction and lateral grip only while the wheels are supported; crossing the finite plate edge or a reserve-material boundary resolves the exact contacted surface law and publishes that provenance. Its visible controls are an ordinary pinned control surface generated from the editable Cart remote.
- **3 · Quad Drone:** crossed frame, flight deck, four independently powered shaft motors and fixed-pitch rotors, battery, controller, and flight-control network.
- **4 · Atlas Humanoid:** a 13-body physical robot with feet, shins, thighs, pelvis, torso, head, upper arms, and forearms; ten powered hip, knee, ankle, shoulder, and elbow hinges; a battery, motor, controller, 6-axis IMU, and balance gyro.
- **5 · Orbital Missile:** pressure-nozzle main engine, independent main/RCS propellant stores, two load-rated structural stages, a powered two-flange release coupler, one declared breakaway signal umbilical, ceramic aero nose, four stabilizing fins, battery, flight computer, and mission-control link supporting arm, launch, throttle, stage, and abort. The editable TypeScript program turns the ordinary Stage receiver's rising edge into the coupler's exact release command.

All structure connections are valid on load and all remote channels are online. Command lookup is isolated to the active structure’s remote profile, so identically named channels such as `throttle` cannot leak between machines.

## Time, atmosphere, and near space

Open **Environment** to set local solar time continuously from 00:00–24:00 or select Dawn, Noon, Sunset, and Midnight presets. The control changes solar elevation and azimuth, direct light color/intensity, moonlight, hemisphere and ambient fill, exposure, fog, sky color, shadows, star visibility, and persists between sessions.

Vehicle altitude drives a smooth transition from the ground atmosphere at 45 km to full space at the 100 km Kármán line. Stars fade in as scattering disappears, fog recedes, and a curved textured Earth with an atmospheric rim replaces the ground horizon. The Moon retains its physical reference distance of 384,400 km; a nearby render shell preserves WebGL depth precision while maintaining its realistic apparent angular size.

A 12 m-radius meteorite target hovers at `x = -100 m`, `y = 100,000 m`, directly left of the build area's vertical launch line. It is an ordinary registered environment body, not a hidden flight-runtime coordinate. The orbital blueprint carries a mechanically mounted, electrically powered Range Sensor whose finite cone, maximum range, and resolution observe the meteorite through an ordinary signal route to the flight computer. The challenge accepts a rendezvous only while that completed sensor telemetry proves the configured range and relative-speed limits. Removing its mount, power, signal, controller binding, or line of sight removes target knowledge. Proximity framing follows the same valid sensor fix.

### Atlas physical gait

Atlas is no longer animated by moving a single model through space. Each limb is a `cannon-es` rigid body and every orange joint is a torque-limited hinge constraint. Its feet have a dedicated high-friction contact material and can only generate support forces while touching the floor.

The controller recomputes the whole-body center of mass, current support center, foot contacts, torso pitch/roll, and angular velocity every physics step. Its gait is staged as double support, weight transfer, single support, swing, and landing instead of driving both legs with an unrestricted sine wave. A high-friction stance constraint is created only after the intended support foot reaches the floor; the other foot then follows a force-controlled lift-and-placement arc with equal-and-opposite reactions at the pelvis.

Atlas uses +Z as its single forward frame, matching the front-mounted head/IMU sensors. Hip, knee, ankle, arm, balance-velocity, swing-foot placement, and distance telemetry all use that same frame. Its directional feet have a heel, ankle mount, rubber sole, widened toe, and gold front bumper so toe direction is visually explicit.

Atlas’s toes, ankle pivots, swing trajectory, commanded velocity, and telemetry all define forward as world `+Z`. The stance leg drives the pelvis toward a bounded forward velocity while knee flexion clears the swing foot. If the support contact, COM, or attitude leaves its safe envelope, the controller cancels the swing and returns both legs to a recovery posture. Turning Balance assist off removes this stabilization, so the articulated robot can genuinely fall.

The mission display reports forward distance, gait phase, COM offset, planted feet, and balance loss. Set Walk speed to zero to inspect a two-foot balance hold, then increase it gradually and adjust Stride length from the remote.

## Engineering simulation tier

- **Rope and flexible load paths:** Rope is an ordinary authored component with two independently free or attached ends. Deterministic distributed masses, circular contact elements, and unilateral axial constraints produce gravity sag, slack-without-push, tension, endpoint reactions, off-axis torque, frictional contact, internal break location, and physical fragments in the same 1/120-second Cannon transaction as rigid bodies. Completed telemetry, replay, checkpoints, Failure Lab, and `render_game_to_text()` share the same solved centreline and loads. See [Rope](docs/ROPE.md) for authoring, wheel attachment, validity, and release limits.
- **Articulated constraints:** hinge joints integrate angular velocity and position using commanded target angle, available motor torque, inertia, viscous damping, configurable lower/upper stops, and inelastic limit reaction. The Atlas demo additionally uses native rigid-body hinge and lock constraints, ground contacts, and joint motors. Live reaction torque is calculated for every joint.
- **Mechanisms, suspension, and wheel contact:** springs, dampers, stops, guides, joints, power-limited actuators, axles, bearings, and wheels are ordinary authored parts and connections compiled into physical bodies and constraints. Wheels use rounded rotating collision geometry with distinct tire-envelope, sidewall, and rim contact regions—not ray casts or rectangular proxies. A stock Grip Wheel has an explicit dry-air chamber: conserved gas mass and internal energy determine absolute and gauge pressure as the tire-wide chamber volume changes under load, and that pressure contributes to normal support before the authored rim bottoms out. Connect its `AIR` port to an Electric Air Compressor through a powered Three-Way Pneumatic Valve to inflate, hold, or vent it during a run; a powered Tire Pressure Sensor exposes the connected chamber to an ordinary controller. The old `memoryless-brush-v1` fixed-compliance law remains valid only when explicitly authored. Normal impulse from the coupled contact solve bounds longitudinal and lateral tire force; carcass deflection, combined slip, rolling resistance, dissipation, gas/carcass temperature, and pressure evolve from the authored tire, gas, and material laws. Suspension motion emerges from its constructed topology, so a wheel climbs a small obstacle only when geometry, friction, torque, load, speed, pressure, and available travel permit it. Bottoming, rim contact, excessive obstacles, overpressure burst, or hard chassis impacts can produce ordinary failure evidence; no hidden vehicle rig supplies lift or stabilization.

See [Pneumatic tires and dry-air circuits](docs/PNEUMATICS.md) for stopped
pressure authoring, live component wiring, stock calibration, CTIS, failure,
telemetry, and verification contracts.

- **Physical release and staging:** a Release Coupler is an ordinary two-flange mechanism with authored frames, force/torque limits, a powered exact command endpoint, and finite latch energy. A valid command opens its constraint and only the network routes explicitly marked as breakaway umbilicals. The bare latch supplies no separation impulse; stages move apart only because their physical forces and stored energy do. Intentional release remains structural telemetry but is not mislabeled as a failure post-mortem.
- **Stress and fatigue:** mechanical and gear links calculate normalized stress from transmitted motor load, gear ratio, and dynamic shock. Loads above the endurance threshold accumulate fatigue; light operation permits slow recovery. At 100% fatigue the link fails, turns red, becomes invalid, and stops transmitting torque. The mission HUD reports overall structural health.
- **Conserved material propulsion:** Propellant Tanks and pressure-nozzle engine inlets use explicit, opposite-direction resource ports with one exact declared medium. Every fixed step converts ordinary endpoint throttle and gimbal commands into mass-flow demand, proportionally allocates reachable stores, debits the delivered mass, and derives thrust from exhaust momentum plus exit-pressure work against the local atmosphere. Empty, detached, partitioned, or wrong-medium feeds produce exactly zero material-backed force. Depletion and ablation update body mass, center of mass, and inertia through one post-thermal transaction, and checkpoints preserve the complete allocation, actuator, mass-frame, and telemetry state.
- **Shared aerodynamics and aerothermodynamics:** every physical part—not a special missile object—samples the same altitude-dependent atmosphere and wind, inverse-square gravity correction, transonic drag, authored aerodynamic surfaces, stagnation heating, drag-work heating, radiative cooling, material limits, and ablation laws. Forces act on the actual connected bodies, so placement, orientation, exposed geometry, fins, structural splits, and off-axis construction determine the resulting motion and loads. A single physical-component index follows those assemblies through breakups. Live telemetry projects only completed kinematics, force, impact, material, and thermal records; launch state, stabilization, and mission wording are not simulation inputs.
- **Narrow flight ownership and exact replay:** aerodynamic force generation, mutable thermal/ablation response, and completed flight telemetry are separate systems. Only temperature and ablation state are persisted in the `thermal-ablation` checkpoint owner; aerodynamic forces and physical grouping are reconstructed from the restored bodies and topology. This prevents saved read models or demo state from becoming a second physics authority.
- **Space guidance:** tower-clear lateral thrust-vector authority is derived from command-receiver targets, completed navigation/range-sensor readings, current horizontal error and velocity, throttle, and fin stability. Target detection comes from finite sensor geometry against registered environment bodies; flight physics has no mission-coordinate or target-completion branch.

## Blueprint Exchange and sharing

Open **Tools → Blueprint Exchange** to package or restore a complete editable machine. A blueprint v1 asset includes exact component behavior configuration, SI positions, canonical local-to-world quaternion orientations, scale, battery rated capacity and initial charge, explicit port-to-port connections with force/torque capacities, portable remote profiles and bindings, and every Logic Controller's endpoint-binding manifest, selected language, and source buffers. Euler rotations are editor state, not portable machine data. Runtime stress, fatigue, failures, selection, trust decisions, and controller-window state are deliberately excluded.

Add a title, creator credit, description, and tags, then save the design to the searchable local gallery, download a `.simshare` file, or copy a compressed share link. The import area accepts the current package through file picker, drag and drop, pasted package JSON, or pasted links; the canonical developer JSON facility accepts blueprint v1 only. **Add My Parts** shares reusable multi-part assemblies and custom single components; receiving players can install them directly into their component library.

Every package has a content fingerprint, dependency summary, remix attribution, and any challenge result proven by that exact machine. Results produced locally are labeled **Proven on this device**; proof arriving through a file or link is honestly labeled **Challenge proof attached**. Favorites and your personal star rating stay in browser storage and are deliberately excluded from shared files. See [docs/BLUEPRINT_SHARING.md](docs/BLUEPRINT_SHARING.md).

Simulacrum stores local work through one checksummed, transactional browser
snapshot, so a partially written preference cannot silently replace a valid
machine. Open **Tools → Local Data** to review what is stored or to reset this
browser's workshop. Reset requires a second confirmation, preserves unrelated
website data, and removes saved machines, My Parts, Exchange entries, challenge
history, preferences, and executable trust. Download important designs first.

## Visual Logic, TypeScript, and WebAssembly scripting

Select a Logic Controller and press **Program This Controller**. The top-level **Script** button reopens the currently selected or active controller. In **Named Physical I/O**, add an input or output, give it a local alias, and choose one route-valid component endpoint. Then choose **Visual Logic**, **TypeScript**, or **WebAssembly · WAT**. Visual Logic provides typed, draggable nodes and visible data-flow connections; it compiles directly to the same typed control IR and metered WebAssembly tier as source programs. All modes share the same endpoint bindings and deterministic fuel limits.

The controller must have electrical power. Its program can command only the exact component, port, and channel named by an output binding and reached through that controller's signal connections; code is not a global demo override and output never broadcasts by channel. Each controller stores its binding manifest, language, Visual Logic graph, and TypeScript/WAT source buffers in the machine blueprint. Every powered controller runs independently; conflicts on the same physical target/channel are rejected and reported. Remote input reaches a program through an ordinary powered Command Receiver and appears one completed physics step later.

## Development and architecture

The reusable DOM-free engine is built as the separately versioned workspace
package `@yaniv-golan/simulacrum-core`, with generated declarations and a
compatibility report. It is not published to npm yet; use it from this source
checkout. Its API is documented in [docs/CORE_API.md](docs/CORE_API.md), and the
[executable extension guide](docs/core-extensions.md) covers custom components,
ports, systems, sensors, challenges, controller programs, and telemetry
consumers. The [documentation map](docs/README.md) links the complete player,
contributor, and API guide set. [ARCHITECTURE.md](ARCHITECTURE.md) defines
ownership and dependency rules. Contributors should read
[CONTRIBUTING.md](CONTRIBUTING.md). Run `npm run check`, `npm test`, and
`npm run build` before submitting changes.
Critical decision logic also has an aggregate mutation gate (`npm run mutation`).
Before a release, run the isolated 30-minute load/start/stop gate with
`npm run release:soak`; it checks precise heap, renderer summaries, raw WebGL
resources, browser storage, controller runtimes, and thermal-material cleanup.

### TypeScript

TypeScript is parsed, allowlist-validated, and compiled locally when **Compile TS & Run** is pressed, so installation and normal game startup do not require an external compiler service. A script declares this entry point:

```ts
function tick(api: ControlAPI, dt: number): void {
  const speed = api.read("navigation.speed");
  api.write("leftMotor.throttle", speed < 10 ? 0.65 : 0);
}
```

The string literals are controller-local binding aliases, not global sensor or channel names. Physical sensor components provide connection-scoped readings: Navigation Sensor (position, velocity, speed, altitude, and wind), Rotation Sensor (RPM), 6-axis IMU (attitude, angular rate, and acceleration), Contact Switch (state, force, and water contact), Thermal Probe (temperature and heat flux), Air Data Probe (static/dynamic pressure and density), Load Cell (attachment load and rated-load ratio), Range Sensor (detection, surface range, range rate, and relative velocity), and Command Receiver (remote scalar input). A reading exists only when its exact sensor port has a live directed signal route to the controller and any required power. Mechanical readings also require their physical attachment. The workbench shows aliases, units, source part IDs, and route validity.

The Controller Debugger records the exact synchronous controller inputs and bounded outputs rather than inventing a second simulation view. Click a typed sensor to watch it, compare recent values on the oscilloscope, inspect commands and variables, arm a conditional breakpoint, and use **Step physics** to advance exactly one 1/120-second tick. Visual graphs and source buffers are stored with their controller and survive blueprint round-trips; transient traces reset with the simulation. See [docs/CONTROLLER_PROGRAMMING.md](docs/CONTROLLER_PROGRAMMING.md).

TypeScript scripts are limited to 32 KB of UTF-8 source and 64 KB of compiled WebAssembly. The control subset supports finite numeric state, local variables, numeric helper functions, arithmetic, comparisons, conditionals, `if`, `Math.abs/min/max`, and literal `api.read(bindingId)` / `api.write(bindingId, value)` calls. Unknown or wrong-direction binding aliases fail compilation. Imports, loops, recursion, object construction, browser/network/storage APIs, and dynamic code are structurally rejected by the AST compiler; submitted JavaScript is never evaluated.

### WebAssembly · WAT

WAT compiles locally to WebAssembly and must export exactly `tick(f32)` or `tick(f64)`.

Allowed imports:

- `env.read_binding(i32) -> f32/f64`: an input index in the controller's alias-sorted binding manifest.
- `env.write_binding(i32, f32/f64)`: an output index in the same manifest.

The WAT tier parses and validates the full module before compilation. It rejects unknown imports, memory, tables, indirect calls, loops, recursion, oversized/deep input, extra exports, and modules without the exact `tick` contract. Every finite function is instrumented with deterministic fuel; a trap discards that tick's writes and takes down only its own controller. The WebAssembly module receives no DOM, network, storage, worker, or filesystem functions.

Blueprint version 1 stores the strict endpoint-binding manifest, selected language, and exact Visual Logic, TypeScript, and WAT source buffers on every Logic Controller. Root-level programs, missing or ambiguous endpoints, missing ports, unsupported battery fields, and unsupported blueprint versions are rejected with an actionable error before the current machine changes.

## Controls

The in-game **Learn** panel and **Keyboard & commands** surface show the complete
active, remappable control set.

### Simulation and machine controls

- During a running test, press `.` or choose **▸│** to pause and advance exactly one 1/120-second physics tick. Use this to inspect controller, load, contact, structure, and thermal changes without timing ambiguity.
- Rover driving: after starting simulation, hold `W`/`S` for forward/reverse, `A`/`D` to steer, `Space` to brake, and `L` to toggle the physical headlights. The same semantic action bindings appear as sliders/buttons in Remote and its optional pinned Direct Control surface. The rover's visible TypeScript program reads four powered Command Receivers and drives four hub motors, two physical steering hinges, and two lamps through exact endpoint bindings. The panel reports `D`, `N`, or `R`; steering yaw reverses physically while backing up.
- Starting the rover enables physics but deliberately leaves throttle at zero. The Direct Control surface and mission display show the required input, live speed, throttle, steering, brake state, and headlights.

### Failure and replay tools

- A physical failure automatically opens a post-mortem with the first failed attachment, peak transmitted load, rated capacity, utilization, detached parts, and a causal chain. Choose **↶** or **Replay failure** for a bounded, read-only telemetry replay; scrubbing never reruns physics or sends commands.
- A stall, invalid tire contact, numerical anomaly, or structural failure also freezes exact 120 Hz diagnostic evidence. Open **Failure report** and choose **Export diagnostic bundle** to save its tick-zero checkpoint, external input trace, contact and solver provenance, and pre/post topology for deterministic verification.
- Failure sparks, impact dust, water spray, heat smoke, and procedural sound scale from recorded physical severity and environment data. They are presentation effects only and never influence the solver.

### Selection and editing

- Left-click a component to select it.
- Hovered parts receive a pale 3D outline. The selected part receives a bright bounding cage, floor halo, persistent name label, and inspector panel, so selection remains visible from any camera angle.
- Choose a library item and click the workbench to place it on the two-meter snap grid.
- Choose **Move** (`G`) or **Rotate** (`R`) to attach a direct 3D gizmo to the selected component. Movement snaps to 0.25 m and rotation to 15° increments.
- With canvas focus, press `C` to duplicate the current selection. Simulacrum first tries the outward face under the pointer, then a direction toward the camera, and advances along the 0.25 m authoring grid until the complete cloned group clears existing authored solids. Board-authored selections stay inside the workbench boundary; assemblies intentionally deployed into the Test Reserve stay editable in that coordinate space. `Ctrl/Cmd+D` remains an alias. The clones retain their relative transforms and internal connections, become the current selection, and enter Move for immediate refinement.
- With canvas focus, press `X` to delete the current selection. `Delete` and `Backspace` remain aliases. Duplicate and delete are single undoable operations; held-key repeat cannot apply either command more than once.
- Choose **Explode** or press `Shift+X` to temporarily spread every component away from the assembly center. The thicker color-coded power, signal, shaft, and gear connections remain attached to their endpoints. Parts remain selectable, but transform editing is locked until **Collapse** restores every exact position. Wiring or starting simulation also collapses the view automatically.
- Click any neutral area of the workbench to clear the selection.

### Camera

- On a Mac trackpad, `Option`+drag orbits, `Space`+drag pans, and pinch or two-finger scroll zooms toward the pointer. The same gestures use `Alt` and `Space` on Windows or Linux.
- With any mouse, secondary-button drag orbits and middle-button drag pans. Choose the visible **Orbit** or **Pan** button to turn an ordinary drag into that gesture. `Shift`+scroll pans sideways; `Alt`/`Ctrl`+secondary-drag dollies toward or away from the subject.
- Press `F` to frame the complete selected set. When nothing is selected, `F` frames the complete machine. `Shift+F` follows the primary selected component, and double-clicking a component selects and focuses it.
- Press Numpad `1`, `3`, or `7` for front, side, or top views. Number-row `1`, `2`, and `3` switch to Build, Connect, and Simulate instead. The `+`, `−`, and Home buttons zoom and reset the workshop view. The `?` button in the camera dock displays the complete control guide.
- With canvas focus, `O`/`P` activate Orbit/Pan, arrow keys orbit, `WASD` moves across the ground plane, `Q`/`E` moves down/up, `+`/`−` zooms, and `Home` resets the camera.
- `Ctrl+Shift+F` toggles fullscreen. Plain `F` retains the frame-selection action.

### Wiring and Rope

- Click a connection port to reveal its focused actions. An available port can
  start connection mode; a connected port names the exact counterpart and can
  select it, frame it, trace an owner-produced path, or disconnect that one
  connection as one undoable edit. Network traces distinguish authored paths
  from live tick evidence and never claim that a displayed path carried flow.
- Rope has named `END_A` and `END_B` ports. While stopped, `Alt+A`/`Alt+B` starts the ordinary attachment workflow for that end and `Alt+Shift+A`/`Alt+Shift+B` detaches it. Multi-select exactly two components to create a two-ended Rope as one undoable Inspector action.
- While connecting, a source banner remains on screen and a dashed live cable follows the cursor toward the hovered target. Incompatible target ports keep their exact reason visible and leave the source armed for another choice. `Esc` or the banner's Cancel button exits connection mode.
- `Esc` cancels placement or connection.

Printable editor and camera commands require canvas focus. While Simulate is
running, machine commands remain active when an ordinary button has focus, but
text entry, hotkey capture, menus, dialogs, and native widget keys take
precedence. The **Keyboard & commands** surface shows, remaps, clears, and
resets every active alias.

## Current scope

The current source checkout includes powered command networks, articulated
joint dynamics, suspension, fatigue and connection failure, conserved
propellant mass flow, physical release/staging, missile aerothermodynamics,
distributed Rope physics and authoring, pneumatic tires and powered dry-air
circuits, reusable subassemblies, engineering
overlays, failure post-mortems, bounded
telemetry replay, open-ended payload challenges, the Workshop Test Reserve,
complete blueprint persistence, and sandboxed TypeScript/WebAssembly control.
See the [changelog](CHANGELOG.md) for the exact contents of released version
0.1.0 and the unreleased changes on `main`. Future depth should include
collision-driven tooth contact, deformable structures, broader pressure-fed plumbing,
and a larger orbital world.
