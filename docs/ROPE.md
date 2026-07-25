# Rope

Rope is an ordinary player-authored component backed by the engine-neutral
`flexible-line-v1` capability. Its two named mechanical ports are `END_A` and
`END_B`. Either end may be free or attached, so a Rope can be dropped, hung,
used as a tether, connected as a span, or composed with other parts in a saved
design.

## Building with Rope

Add **Rope** from the Motion category. Select one end and an ordinary compatible
mechanical port or structural surface to create an attachment. Surface clicks
preserve the exact picked local anchor in metres. While stopped, use
`Alt+A`/`Alt+B` to attach `END_A`/`END_B` through the normal connection workflow,
and `Alt+Shift+A`/`Alt+Shift+B` to detach that end.

To rig two existing components in one action, multi-select exactly two parts and
choose **Connect selected components with Rope** in the Inspector. Enter extra
cut length for slack. The editor creates one Rope and two ordinary attachments
as one undoable transaction; if either attachment is invalid, nothing is added.

The editable physical inputs are unstretched length, diameter, material,
discretization target, axial stiffness and damping, linear density, and break
load. The built-in braided-nylon preset derives density, stiffness, damping, and
strength from diameter. Values are stored and simulated in SI units.

## What the simulation means

Rope is a deterministic chain of distributed masses and circular contact
elements. Adjacent elements are joined by unilateral axial constraints: they
can pull after the local slack is consumed, but cannot push in compression.
There is no rigid proxy body, hidden support, animated curve, or force applied
between part centres.

Gravity produces sag. Contact and friction come from the same Cannon world and
reviewed material-pair authority used by ordinary machine bodies and the
Workshop Test Reserve. Non-neighbour Rope elements may collide, while adjacent
elements do not collide with each other. Attachments use point constraints, so
they transmit force at the authored anchor without imposing an orientation.
An off-axis anchor on a rotating body therefore produces real moment and Rope
motion. An anchor on the rotation axis does not magically wind Rope onto the
body.

The fixed release model supports external contact and bounded non-neighbour
crossing prevention, but does not claim robust dense coils, knots, arbitrary
initial routes, multi-layer winding, torsion, creep, wetting, aerodynamic drag,
or fluid drag/buoyancy. Wind and water encounters publish an
`unsupported-envelope` validity state instead of silently pretending those
effects were modeled.

## Wheels, drums, and pulleys

Attaching one Rope end to a wheel-like component attaches that named end at the
selected local point:

- use the wheel's ordinary `SURFACE` attachment and pick an exposed point;
  `AXLE` is a rotating shaft coupling inside the wheel and deliberately rejects
  a Rope termination;
- an on-axis point on an exposed side face rotates in place and supplies no
  winding radius;
- an off-axis anchor travels around the axis, pulling the Rope and applying an
  equal-and-opposite torque to the wheel;
- the exposed Rope can collide with the wheel or other geometry and friction
  can redirect it; and
- stored turns, paid-out length, retention in a groove, and controlled
  retraction do not appear merely because the target is wheel-shaped.

A one-ended Rope initially leaves its attachment toward the Rope's authored
placement. This preserves the visible build instead of spawning the line along
a hidden fixed direction through the target. The ordinary placement height also
keeps a new free Rope's complete straight centerline above the workbench.

A powered winch is therefore a future ordinary assembly/component that owns
drum inertia, bearing, motor, power, capacity, and paid-out-length control. A
pulley/sheave owns its bearing, groove geometry, retention, and rating. Both
must interact with the same Rope through ordinary anchors, collision, and
friction; neither may switch Rope into a named simulation mode. Coiling and
knots are instead future Rope-model capabilities because they require robust
self-contact, bending/friction response, and arbitrary initial-route authoring.

## Completed telemetry and failure

The Inspector, `render_game_to_text()`, replay, Failure Lab, challenges, and
external Core consumers share completed `systems.flexibleLines` telemetry. It
includes solved centreline, unstretched/current arc length, end-to-end span,
slack, extension, endpoint and internal tension, maximum strain, elastic
energy, damping/contact dissipation, bounded contact samples, governing failure
margin, boundary state, active internal edges, validity, and unsupported
effects.

Endpoint hardware uses the ordinary connection capacity and fails through the
normal structure system. Internal material overload breaks one deterministic
governing Rope edge per component per tick. The event identifies the exact
compiled edge and position, material/failure law, load, rating, predecessor
connections, active elements, surviving fragments, and completed tick. The
fragments remain physical and replay retains the same centreline and break.

Checkpoints persist every element pose and velocity, active edge and attachment
state, accumulated damping work, and topology revision. Restore validates the
compiled identity and reproduces both the split topology and subsequent failure
tick.

## Portability and limits

Rope is part of the current strict blueprint, workspace, subassembly, share,
fingerprint, mechanism-artifact, replay, and checkpoint contracts. Unknown
fields, materials, endpoints, or invalid values fail closed; no compatibility
reader or Rope-only file format exists.

One Rope is limited to 64 axial elements (65 physical nodes) and one compiled
assembly to 512 flexible entities. Contact samples in completed telemetry are
bounded to 16 per Rope with explicit truncation. These limits are part of the
deterministic release envelope, not presentation detail.

For the reusable compiler surface, see [Core API](CORE_API.md) and the
[`flexible-line.mjs`](../examples/core-extensions/flexible-line.mjs) example.
