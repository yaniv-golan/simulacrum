# Open construction challenges

The Challenge Lab contains two complementary kinds of work:

- **Calibration challenges** load a known reference blueprint. They teach one
  measurable physical behavior and provide a useful baseline.
- **Open construction challenges** define an outcome, a physical payload, and
  safety limits without prescribing a machine. Start with only the payload or
  bring the machine already on the plate.

## Open contracts

| Contract    | Physical objective                                      | Example approaches                          |
| ----------- | ------------------------------------------------------- | ------------------------------------------- |
| Cargo Relay | Secure 80 kg, travel 30 m, and stop on the ground       | wheels, articulated legs, rotors, or hybrid |
| Water Haul  | Secure 80 kg, enter and exit water, and travel 55 m     | amphibian, wader, boat, or hybrid           |
| Air Courier | Move 80 kg 25 m horizontally and 18 m upward, then hold | multirotor, wing, rocket, or hybrid         |
| Up and Home | Carry 80 kg above 30 m and return below 8 m/s intact    | rotor, rocket, glider, or hybrid            |

The listed approaches are inspiration, not vehicle modes. A contract completes
when ordinary simulation telemetry satisfies every criterion. The evaluator
does not inspect the active demo name or require a stock topology.

Reference controls are ordinary declarative challenge data. Each setup entry
names one loaded remote profile and control plus its initial value and active
state. Duplicate control or target/channel authority is rejected. Preparation
does not guess whether a component is powered: after the first network step,
the same completed power and signal telemetry used by scripts produces an
explicit online/offline criterion.

## Payload and starts

The Mission Payload is an ordinary 80 kg catalog component with four mechanical
mounts. It contributes its real mass to the assembly and only counts as secured
when a live mechanical or gear-mesh connection attaches it to the machine.
Proximity, selection, and signal wiring do not secure cargo.

- **Start empty** clears the plate and places only the Mission Payload.
- **Use current build** keeps the existing parts, wiring, tuning, programs, and
  controller layout, then adds a payload if one is not already present.
- **Retry exact start** restores the complete pre-test assembly rather than
  rebuilding a demo or retaining damage from the failed run.

## Evaluation and scoring

`ChallengeRun` consumes the same immutable `TelemetrySnapshot` used by the HUD
and automation. It derives motion capabilities from active physical systems:
wheel suspension and ground contact, articulated contact, component-resolved
flight, or mechanism output. Hybrid machines can expose more than one of these
capabilities in the same run.

The live contract card reports each independent condition, including payload
attachment, distance or altitude, water contact, controlled finish, structural
integrity, and fatigue. A solution must satisfy all mandatory criteria at once.

Target-rendezvous contracts name a registered environment-body ID and accept
only valid completed Range Sensor provenance from the bound physical assembly.
They can constrain surface range, range rate, and hold duration without reading
a presentation object or flight-runtime flag. An unpowered, signal-isolated,
unbound, occluded, or out-of-cone sensor cannot complete the objective.

Every criterion includes immutable diagnostic evidence: source channel, unit,
reference frame, completed tick, validity, and provenance. Objective kinds
that have no registered evaluator fail closed rather than being treated as a
successful or generic delivery objective.

Every design starts from the same 10,000-point completion value. Elapsed time,
total mass, part count, consumed battery energy, failed links, and detached parts
reduce the score. These factors reward efficient engineering without making one
construction method mandatory.

Completed and aborted attempts are stored locally. Reliability is successful
runs divided by total attempts, and the record also retains the distinct
physical solution classes that have completed the contract. This makes a robust
repeatable design more valuable than one lucky test while explicitly recognizing
multiple valid solutions.

## Reusable contract

The evaluator is DOM-free and exported from the source-checkout workspace
package `@yaniv-golan/simulacrum-core`:

```js
import {
  ChallengeRun,
  challengeReliability,
} from "@yaniv-golan/simulacrum-core";

const run = new ChallengeRun(contract, assembly.snapshot());
const result = run.step(session.telemetry(), 1 / 120);
const reliability = challengeReliability(savedAttempts, contract.id);
```

Presentation owns contract browsing, criterion cards, and responsive layout.
Application code owns start/retry workflows and persistence. Neither layer may
change physical results based on challenge identity.
