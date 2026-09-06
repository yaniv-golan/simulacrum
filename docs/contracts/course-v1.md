# Course contract v1

This version defines acceptance measurements independently of simulation behavior. Fixture
bindings describe what an evaluator measures; they confer no physical authority. The helpers in
`scripts/course-contract.mjs` are executable predicate witnesses, not a completed Course evaluator
or evidence that any machine passes. An integrated evaluator must derive measurements from
committed telemetry, validate its input schema, and enforce the complete contract below.

## Freeze and setup

Qualification requires a frozen artifact naming this contract version, evaluator digest,
implementation and runtime identities, environment geometry and material selections, gravity,
start pose, ramp entry and exit lines, departure unit vector, machine blueprint and programs,
input trace, and the robustness commitment. Store every dimension in SI units. Exploration
fixtures cannot qualify. No physical dimensions are frozen by this document: measure the built
apparatus, its usable power margin and geometry first. Approach distance is at least 1 m;
ramp slope is at most 0.15 rad. Return tolerances below are requirements, not tuning parameters.
Revising a frozen fixture invalidates all qualification evidence and requires a reason independent
of the candidate's observed performance.

Bind the root part and eligible support shapes explicitly. A legged fixture binds exactly two
sole shapes; only those soles may support it. A wheeled fixture binds drive and idler wheel
shapes; only wheels may support it. Validate shape kinds against authored geometry. Never infer
bindings from names or roles. W0 is total blueprint mass times gravity; pre-run measured support
load must agree within 5%. H0 is root clearance over the local surface in the initial hold.
L is a frozen nominal stride (legged) or drive-wheel circumference (wheeled).

Preflight must establish geometric compatibility: the S4 start must be within 1.00 m of the ramp
foot, since its end must be within 0.60 m of its start and 0.40 m of the foot. On a straight S3
starting at the foot this requires 5L <= 1.00 m. This constrains the apparatus and machine
fixture; it does not authorize shortening S3 or selecting a convenient subinterval of S4.

## Measurements

Sample every committed 1/120 s tick. Position and path are projected into the plane normal to
gravity. Heading is the root forward axis in that plane, continuously unwrapped. Step projection
uses heading at the later touchdown. Signed yaw and signed enclosed area are compared by
magnitude, so mirrors remain valid. S1 efficiency is endpoint displacement divided by traversed
arc length; zero arc cannot pass. Cross-track is distance from the fixed start-to-entry line.

A sole unload requires load below 0.02 W0 for two successive ticks; clearance requires sole-to-
surface distance at least 0.02 m for two successive ticks. A touchdown crosses above 0.10 W0
only after both conditions. Touchdowns must strictly alternate. The first scored touchdown
uses the opposite sole's initial stable-contact anchor; subsequent steps use the preceding
opposite touchdown. L1a requires strictly positive projection. In Course S3 each qualifying step must project
strictly more than 0.02 m forward; other segments impose no additional projection threshold.
Stance slip is maximum gravity-plane displacement from touchdown until valid unload: at most
0.02 m on level surfaces and 0.06 m on the ramp.

Stable hold lasts 600 consecutive ticks: root speed <= 0.01 m/s, angular speed <= 0.05 rad/s,
tilt <= 0.20 rad. Legged holds require both pads >= 0.10 W0 and total >= 0.80 W0. Wheeled
holds require all drive wheels contacting and must persist with parking brakes released on
the level plate. Fall is tilt > 1 rad OR root clearance < 0.45 H0 for 30 consecutive ticks.

Forbidden impulse sums contact normal-impulse magnitudes (N s), once per unique contact per
tick, only where exactly one participant belongs to this machine and that participant is not
eligible. Internal contacts do not count; terrain cannot be the offending shape. Conflicting
records with one contact ID invalidate telemetry. Failure occurs above 0.02 W0 / 120 for ten
consecutive ticks OR above 0.05 W0 * 2 in any rolling 240-tick window (short initial windows
use the same total bound). Brief periodic bracing therefore cannot evade detection.

## Circuit and annexes

Start from the complete initial hold. The run permits one initial go command, no subsequent
operator input, resets or checkpoint restores. Segments enter once in this order:

| Segment | Exit and requirements |
| --- | --- |
| S1 approach | Entry after displacement > 0.05 m; latch passage of ramp entry. Cross-track <= 0.15 m, efficiency >= 0.70; legged >=4 qualifying touchdowns. |
| S2 descent | Latch passage of exit line; wait for >=2 contacting eligible shapes, each load >=0.10 W0, all contacting eligible shapes on ground. Horizontal speed <=1.5 times S1 mean speed. Legged >=2 ramp touchdowns. |
| S3 advance | Signed displacement along the frozen departure direction >=5L. Arc length and oscillation cannot substitute. Legged >=5 further qualifying touchdowns. |
| S4 loop | Over the ENTIRE segment: absolute heading sweep >=350 degrees, traversed arc >=3 m, absolute shoelace area >=0.8 m², maximum distance from the tick-sampled path centroid <=2 m, endpoint separation <=0.60 m. End <=0.40 m from ramp foot and heading error <=0.35 rad toward ascent. |
| S5 ascent | Positive vertical progress in every full rolling 240-tick interval wholly within S5. Latch upward passage of ramp entry; wait for >=2 loaded eligible supports and all contacting eligible supports on plate. Legged >=2 ramp touchdowns. |
| S6 return | Position <=0.30 m and heading <=0.35 rad from initial pose throughout the terminal 600-tick stable hold. |

A latched crossing persists while trailing supports arrive, but readiness also requires the root
to be currently beyond the line. Empty contact sets never satisfy
arrival. Count unique shapes rather than contact manifold points. Every contacting eligible
shape must be on the destination; the load floor applies to each counted arrival support.
Closure must pass before shoelace area can qualify: the numerical closing edge alone is not
traversed arc. Do not select a smaller loop interval. Strict alternation and slip limits apply
throughout, including S4. All segments enforce finite state, no fall, damage, forbidden support
or saturation failure. The complete run, including terminal hold, takes at most 240 s.

For wheeled runs, all drive wheels maintain contact except ramp-lip episodes of at most 24 ticks.
For each wheel, derive the forward velocity of its axle relative to the contacted surface,
projected along the wheel's rolling tangent in the surface plane. Signed omega*r uses that
same tangent orientation. With v_min=0.05 m/s, ratio |omega*r-v|/max(|omega*r|,|v|,v_min)
is <=0.30 on level surfaces and <=0.40 on ramps. If |v|<v_min, |omega*r|>v_min fails immediately;
otherwise axle displacement in the surface's co-moving gravity-plane frame is <=0.02 m from
the low-speed episode anchor. Anchor at contact acquisition. Only six successive ticks with
both speed magnitudes >=v_min end the low-speed episode and refresh the anchor; threshold
chatter cannot reset it. Contact loss ends that episode but is independently limited by the
24-tick ramp-lip rule. Surface changes alone never erase a continuing-contact episode: transform
the anchor into the new surface frame. Lateral sliding counts toward low-speed displacement.

## Actuator saturation

The fixture owns positive angle tolerance (rad), speed tolerance (rad/s), torque tolerance
(N m), and speed floor (rad/s), frozen from measurement resolution and rated actuator capability
before qualification. Commands cannot widen them. Position mode fails a sample when at a
physical torque/current limit and angle error exceeds tolerance. Velocity mode uses rate error.
Torque mode has no commanded speed: a fixture-owned motion expectation table, indexed by
actuator and segment interval, declares minimum required speed in rad/s. A sample fails when
nonzero commanded torque is delivered within torque tolerance, measured speed is below the
floor and the fixture requires motion above it. Static load-bearing torque with zero motion
expectation is legitimate. Require a table entry for every torque actuator; zero entries need
an explicit static-load justification. Sixty consecutive failing samples of one actuator cause
run failure. A mode change does not erase consecutive failures. Also investigate fixture,
contact, clearance, coordination and engine causes on ascent; torque and charge are hypotheses.

## Standalone L1a

Begin after a 600-tick hold on level ground. Achieve at least eight strict alternating qualifying
forward touchdowns and signed departure displacement >=L, then a new 600-tick terminal hold.
The whole measured interval after initial hold, including terminal hold, is <=60 s. Initial and
terminal holds cannot overlap stepping. The terminal hold starts after the last touchdown;
a new touchdown restarts its timer. Timing records use half-open tick intervals: initial hold
ends at tick zero, every touchdown is strictly after zero and before the terminal hold starts,
and terminal hold ends by tick 7200. Each hold spans at least 600 ticks. The helper checks these
intervals and strictly increasing touchdown ticks; an integrated evaluator must establish hold
conditions and touchdowns from telemetry rather than accepting player-authored summaries.
All whole-run invariants and ground slip limits apply.
This is a separate stepping-and-stopping probe, not a substitute for any circuit segment.

## Bounded robustness and disclosure

Before tuning, freeze nine dimensions and their three numeric levels (nominal, low, high):
start lateral position ±0.10 m; start longitudinal position ±0.10 m; heading ±0.15 rad;
mass factor 0.9/1/1.1; payload case with exact off-centre mass and attachment transform;
supported ramp slope; named friction lane; one S3 disturbance with force, direction, duration
and trigger; and mirror transform. Categorical numeric levels resolve through an immutable
fixture table; binary dimensions may duplicate a level. Mirror the complete machine, commands,
sensors and Course consistently; separately check passive symmetry first.

Generate nominal plus each one-off nonnominal level plus exactly twenty seeded combinations,
deduplicate, deterministically shuffle, and divide ceil(N/2) tuning cases and floor(N/2) held-out
cases. At most 39 cases exist. The seed and envelope must be sealed before any tuning. The
provided generator emits tuning cases and authenticated encrypted held-out cases with a digest.
A separate custodian keeps the seed and encryption secret; the tuning operator must not receive
them or the unsealed held-out cases. Merely encrypting while retaining that secret in the tuning
context does not establish independence. Preserve the sealed package and commitment as evidence.

Seal candidate implementation, blueprint, programs and configuration before opening held-out
cases. Run every case through the same evaluator, from setup through complete unbroken circuit;
require all to pass with the same sealed candidate identity. A failure is a qualification failure,
not permission to tune on that case. Any candidate or envelope change after disclosure requires
a fresh custodian seed, fresh split and full qualification. Never claim independence if the
custodian procedure has not been performed. The result manifest includes each input trace and
all replay identities, not just a pass boolean. L2 additionally compares deterministic projections
under two recorded renamings; repeated identical nominal runs are not robustness evidence.
