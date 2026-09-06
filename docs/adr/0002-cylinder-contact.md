# Cylinder contact representation

Canonical cylinders keep their authored radius, length, solid-cylinder mass and
analytical inertia. Collision uses a regular inscribed convex prism, for every
cylinder, with resolution owned by `src/model/geometry.mjs`: 64 sides. Rendering
uses the same resolution. Maximum radial approximation error is
`radius * (1 - cos(pi / 64))`, approximately 0.121% of radius (0.1205 mm at 0.1 m).
This is a declared contact approximation, not an exact curved-surface solver.

The native cylinder collider in the selected Rapier build produced increasing
motion in a stationary, unpowered, supported assembly: approximately 9.05 m in
30 seconds despite zero motor work. Removing gravity or the assembly joints
removed that observation; replacing wheel contacts with balls reduced drift to
approximately 3 mm. Increasing solver iterations did not converge to rest.
Rounded cylinders and contact skin also failed that passive experiment.

Convex contact probes at 32 and 64 sides settled within 10 mm. A 128-side probe
drifted approximately 0.385 m, so increasing resolution is not assumed to improve
stability. The 64-side choice must retain a powerless control, a powered travel
test, identity invariance and checkpoint continuation. These experiments qualify
the starter fixture only; they do not qualify tires, terrain or legged contact.

Collider mass properties explicitly use `Ixx = mass * radius^2 / 2` and
`Iyy = Izz = mass * (3 * radius^2 + length^2) / 12`. Checkpoint admission compares
the actual convex vertices and indices, collider properties and plant topology
against the newly constructed numeric configuration. A shape tag alone is not
accepted as proof of matching geometry. Changing resolution invalidates build
and replay evidence and requires rerunning the physical controls.
