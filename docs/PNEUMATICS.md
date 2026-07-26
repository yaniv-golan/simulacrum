# Pneumatic tires and dry-air circuits

Pneumatic pressure is physical simulation state. A chamber stores dry-air mass
and internal energy; temperature and absolute pressure are derived from that
state and the solved chamber volume. Gauge pressure is always relative to the
local atmosphere. No UI control, demo name, or controller command can write a
tire pressure directly.

## Tire models and stock calibration

The wheel contract is an explicit tagged choice. `memoryless-brush-v1` retains
the fixed-compliance model for existing authored assets.
`pneumatic-brush-v1` requires the complete chamber, volume, heat-transfer,
damage, pressure-limit, and `AIR`-port contract. Loading never converts one
model into the other or infers missing pressure from carcass stiffness.

The stock Grip Wheel calibration is a declared generic engineering
approximation for the authored 1.3 m-diameter geometry, not a fit to a named
commercial tire. Its reference values are:

| Quantity                                   |                                          Stock value |
| ------------------------------------------ | ---------------------------------------------------: |
| Reference chamber volume                   |                                              0.15 m³ |
| Minimum chamber volume                     |                                              0.12 m³ |
| Cold gauge pressure                        |                                              220 kPa |
| Cold gas temperature                       |                                             293.15 K |
| Volume loss                                | `0.32 u² + 0.4 u³` m³, with deflection `u` in metres |
| Baseline rolling coefficient               |                                                0.015 |
| Load-deflection energy loss per revolution |                                                   5% |
| Working absolute-pressure limit            |                                              650 kPa |
| Burst absolute pressure                    |                                              900 kPa |

The deterministic calibration oracle spans 0, 80, 220, and 400 kPa gauge at a
5 kN static load. Increasing pressure must increase gas mass, reduce solved
deflection and hysteresis loss, and increase rim-clearance margin. Zero gauge
at zero deflection supplies no pneumatic force. These are model-contract
oracles rather than claims of real-world certification.

## Building a circuit

A live circuit uses ordinary parts and connections:

- a pneumatic Grip Wheel or rated Air Reservoir as a dry-air control volume;
- an Electric Air Compressor with mechanical, power, signal, and `AIR` ports;
- a powered Three-Way Pneumatic Valve with `SUPPLY` and `TIRE` ports;
- a powered Tire Pressure Sensor connected to the chamber and controller; and
- resource connections with explicit `compressible-gas-v1` transport.

The valve command is `position`: positive supplies the tire, zero holds, and
negative vents to the local atmosphere. The compressor command is `inflate`.
Both commands target the exact connected component endpoint and still require
ordinary power and signal routes. A reusable **Four-wheel central tire
inflation system** in My Parts demonstrates four independently routed corners,
a reservoir, and a normal TypeScript controller. Its strict subassembly and
share-package round trips preserve every chamber, transport, binding, and
program field.

## Fixed-step ownership

`PneumaticNetwork` filters the canonical compiled resource topology to exact
dry-air, compressible-gas edges. It snapshots chamber/device state, resolves
bounded choked or subsonic mass and enthalpy transfers in stable identity
order, and publishes one completed transaction. Tire contact consumes the
frozen chamber state and emits tire-wide volume/work. The post-integration
pneumatic commit applies that work, heat transfer, leaks, and failure state.
The normal mass-property commit then includes gas mass and authored gas-volume
inertia for the next tick.

The `pneumatic-gas` checkpoint-v2 owner contains chamber mass, energy, volume,
device dynamics, leak/damage state, and transaction cursors. Restore validates
all identities and finite bounds before committing any state. Blueprint v1,
subassembly v1, and share-package v1 remain strict because their existing
extension points contain complete tagged pneumatic fields; checkpoint v1 is
rejected because it cannot contain the required owner.

## Telemetry, courses, and failures

Completed `systems.pneumatics` telemetry is the sole read model for the running
Inspector, engineering flow arrows, controller pressure readings, checkpoint
and replay consumers, failure evidence, and `render_game_to_text()`. It carries
chambers, live topology components, devices, transfers, conservation
residuals, warnings, and transaction identities. Running pressure is read-only;
stopped cold gauge pressure is authored in Pa and displayed in kPa.

The Test Reserve's **Tire Pressure A/B/C** durability route records minimum and
maximum gauge pressure, maximum deflection, rim load, rolling-loss coefficient,
temperature, gas-mass change, failure state, and transaction span for each
wheel. Repeat the same start state and inputs at low, nominal, and high
pressure to compare physical outcomes.

Underpressure increases solved deflection and rim-contact risk. Deterministic
excess rim/sidewall impulse can create a puncture; overpressure or excessive
gas temperature can burst or fail a chamber. The resulting bounded leak vents
mass and enthalpy to ambient. Pressure-rated lines fail in the structure phase,
immediately partition completed topology, and carry exact causal failure
provenance.

## Verification

Focused pneumatic verification is available with:

```bash
npm run test:focused -- verify-pneumatic-tire-runtime verify-pneumatic-ctis verify-pneumatic-course verify-pneumatic-tire-browser
npm run coverage:pneumatics
npm run mutation:pneumatics
```

The full release gates remain `npm run check`, `npm test`, `npm run build`,
`npm run baseline:verify`, and `npm run release:soak`.
