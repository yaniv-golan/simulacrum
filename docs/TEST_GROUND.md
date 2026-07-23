# Workshop Test Reserve

The Workshop Test Reserve is a 480 m x 360 m physical proving ground around
the construction plate. It is available to every build: the reserve does not
choose a vehicle mode, add hidden stabilization, change control commands, or
substitute a special demo simulation.

## Open and use the reserve

1. Stop the simulation.
2. Choose **Test Ground** in the workshop header.
3. Use **Free test from current position**, or deploy the complete stopped
   assembly to the Surface Lanes, Terrain, Water, Runway, or Helipad staging
   pad. The construction board remains the normal starting position.
4. Optionally choose a guided trial. Its route appears on the map and the panel
   recommends a staging pad.
5. Close the panel and start simulation. The mission card reports the next
   gate, unmet physical requirement, contacted material, and progress.

Deployment rotates and translates the existing assembly as one rigid edit. It
does not alter relative part transforms, repair damage, add supports, or change
the machine. The operation is one undoable history entry. A deployment is
rejected without mutation when the machine does not fit the pad's clear volume.
Pads and trials are disabled while simulation is running.

## Physical site

The reserve has nine districts: the workshop apron, handling ground, surface
lanes, ride and durability strip, terrain park, water park, trail and grove,
airfield, and open experiment lawn. The map uses labels and patterns as well as
color to distinguish materials.

Dry and wet asphalt, weathered concrete, compacted soil, short grass, loose
gravel, dry sand, saturated mud, and low-grip polymer are physical contact
materials rather than visual labels. The same immutable site definition owns
surface regions, terrain height, water depth, fixtures, zones, staging pads,
and routes. Collision, mobility telemetry, the map, and trial evaluation query
that shared authority.

The field includes graded and rolling hills, ditches, a berm, a washboard
strip, a shallow ford, a 3.2 m pool, a 240 m runway, a helipad, and collidable
trees, rocks, logs, curbs, and signs. Water interaction follows ordinary
buoyancy, drag, and bed contact. Tire, foot, skid, landing-leg, and loose-part
support comes from the actual completed contact point and material law.

## Guided trials

Trials evaluate ordered gates and completed physical telemetry. The examples
below describe outcomes, not required machine types.

| Trial                | What it proves                                                       |
| -------------------- | -------------------------------------------------------------------- |
| Surface Sampler      | Contacts asphalt, grass, gravel, and mud, then stops intact          |
| Brake Lab            | Enters at the required speed and stops in the braking box            |
| Suspension Shakedown | Crosses the washboard strip and finishes intact                      |
| Hill and Home        | Reaches the measured hill summit and returns under control           |
| Trail Finder         | Traverses the grove's ordered rock-and-log route                     |
| Ford Crossing        | Enters and exits the shallow ford intact                             |
| Deep Water Rescue    | Reaches the deep-water target, passes the exit, and stops ungrounded |
| Runway Circuit       | Takes off, remains airborne through approach, lands, and stops       |
| Helipad Precision    | Approaches airborne, lands on the helipad, and holds position        |
| Mixed Reserve Relay  | Crosses road, trail, and water-edge districts before the lawn finish |

A gate crossing is accepted only in route order. A trial may additionally
require a particular contacted material, fluid visit, grounded or airborne
state, speed band, structural integrity, and a controlled hold at the finish.
The evaluator only observes immutable completed telemetry; it cannot issue an
actuator command or modify grip, forces, damage, contacts, or integration.

## Retry, records, and evidence

Starting a trial captures the exact stopped build and deployment. While that
trial is running, **Retry exact start** (shown with `Ctrl/Cmd+R`) restores the
same machine, part transforms, placement, site, material map, and route. It is
not a repair or a new solution.

The reserve stores attempts, successful runs, personal best time, and
reliability in the same local challenge record store used by Challenge Lab.
Records are comparable only when their site definition, contact-material map,
route, and exact deployment fingerprints match. A successful portable proof
also binds the blueprint, controller-program digests, physical component,
environment, terminal criteria, and run configuration. Missing identity or
program evidence fails closed rather than being guessed.

## Contributor contract

The DOM-free `TestSiteTelemetrySystem` publishes canonical completed site,
district, surface, terrain, fluid, fixture, and zone state.
`TestCourseSystem` evaluates routes after physics. Presentation may derive
dust, spray, tracks, ruts, and map graphics from completed telemetry, but those
effects are never solver inputs.

Relevant focused verification includes:

```bash
TEST_FILTER=verify-test-site-contract,verify-test-site-physics-authority,verify-course-evaluators,verify-test-course-records npm test
TEST_FILTER=verify-testing-playground-browser,verify-testing-playground-user-loop,verify-test-site-lifecycle-browser npm test
npm run mutation:test-site
```

See [Architecture](../ARCHITECTURE.md) for ownership boundaries,
[Challenge Lab](CHALLENGE_LAB.md) for the complementary payload contracts, and
[Core API](CORE_API.md) for the exported telemetry and evaluator systems.
