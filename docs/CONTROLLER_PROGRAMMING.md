# Controller programming and debugging

Each Logic Controller owns an independent, blueprint-persistent program. It
reads the previous completed physics step and writes commands for the next one.
Programs cannot inspect the DOM, call the network, bypass power, reach an
unconnected part, or override a control conflict.

## Visual Logic

Visual Logic is a serializable data-flow graph, not a separate simulation path.
Sensor, constant, arithmetic, comparison, selection, clamp, and actuator nodes
are validated for missing inputs and feedback cycles, then compiled directly
into the same typed control IR and metered WebAssembly tier as source programs.
Dragging changes presentation coordinates only. Connections between sockets
define evaluation order.

After creating named physical bindings, a speed governor can demonstrate the
complete flow:

1. A Speed sensor is compared with a configurable limit.
2. Select chooses drive power or zero.
3. Actuator writes its exact motor binding.

Add a Clamp node when a computed value needs an explicit actuator range.

Switching language preserves each source buffer. Graphs survive undo, blueprint
export/import, reusable subassemblies, and local blueprint saves.

## Physical sensors

There are no ambient world readings or global sensor names. Add a physical
sensor or Command Receiver, connect its power and blue signal route, then add a
named input binding in **Named Physical I/O**. The binding records one exact
component ID, port, and reading. The API browser labels every bound reading
with its unit and source part ID.

| Component       | Readings                                     | Physical source                          |
| --------------- | -------------------------------------------- | ---------------------------------------- |
| Rotation Sensor | RPM                                          | Mechanically attached shaft              |
| 6-axis IMU      | roll, pitch, yaw; angular rate; acceleration | Component pose and motion                |
| Contact Switch  | contact, contact force, water contact        | Solver contacts and support force        |
| Thermal Probe   | temperature, heat flux                       | Component thermal state                  |
| Air Data Probe  | static pressure, dynamic pressure, density   | Local altitude and relative airflow      |
| Load Cell       | load and rated-load ratio                    | Loads on the cell's physical connections |

The IMU follows the same right-handed, Y-up frame used by assembly transforms:
positive yaw rotates about +Y, positive pitch about +X, and positive roll about
+Z. Angular-rate channels use those same axes. A controller that needs a
vehicle-relative convention should transform these physical readings in its
visible program rather than relying on a hidden flight-specific remap.

There are no demo flags in this route: a sensor asks the completed physical
state of the component carrying it. Disconnected, unpowered, or failed routes
make that binding invalid on the next completed step. They never retain a
hidden last value. A Field Remote can reach code only through a powered Command
Receiver; its value is exposed one completed step later, preventing same-step
feedback.

## Debugger

The runtime copies the exact sensor input and allowlisted command output from
the synchronous fixed-step boundary into a bounded ring buffer. The workbench can therefore:

- watch several sensor or command values without rerunning physics;
- plot recent samples on a time-based oscilloscope;
- show the latest named variables and output channels;
- pause when a selected value crosses a comparison breakpoint; and
- advance one exact 1/120-second simulation tick while paused.

Clearing the trace does not change the machine. A breakpoint pauses the shared
`SimulationSession`; it does not terminate or rewrite the program. Every
controller receives a fresh deterministic fuel and output budget each tick. A
trap discards that controller's partial writes and leaves every other controller
running.

## TypeScript and WebAssembly

TypeScript implements `tick(api, dt)`, using literal `api.read(bindingId)` and
`api.write(bindingId, value)` calls. Each output binding resolves to exactly one
physical actuator endpoint; it never broadcasts by channel. Its strict numeric
subset supports persistent state, locals, finite helper functions, arithmetic,
comparisons, conditionals, `if`, and `Math.abs/min/max`; loops, recursion,
objects, imports, and dynamic calls are rejected structurally. WebAssembly/WAT
imports `read_binding(i32)` and `write_binding(i32, f32/f64)`; the canonically
alias-sorted binding manifest is the authoritative index map.
Both modes compile to synchronous, fuel-metered WebAssembly and share the same
signal routing, command arbitration, source-size, output, and trap-isolation
contracts as Visual Logic.

Changing a binding changes executable identity and invalidates trust. Copying a
subassembly remaps endpoint component IDs while preserving controller-local
aliases and program source. If two powered controllers bind the same physical
target/channel, that channel reports `CONTROL CONFLICT` and neither controller
wins.
