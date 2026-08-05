# Simulacrum Core versioning

Simulacrum Core follows semantic versioning. During the `0.x` line, the public
API is experimental: incompatible API or wire-contract changes may be released
in a new minor version, while patches remain backward compatible within their
minor line.

The package publishes one strict version of each Simulacrum-owned wire format.
Unsupported, missing, inferred, or future fields fail closed. When a future
release intentionally changes a wire contract, its schema and package minor
version advance together and the changelog describes the migration policy.

The committed API Extractor report in `etc/simulacrum-core.api.md` is the
compatibility baseline. Intentional API changes require review of that report,
this policy, the changelog, examples, and clean-package tests.

Version `1.0.0` will mark a stable public API and documented compatibility
guarantees.

Core `0.2.0` ships `GeometryDescriptorV2`, its strict definition/descriptor validators, canonical
port-frame connection checks, and the additive `flexible-line-v1` compiler,
runtime, material, system, topology, telemetry, and checkpoint exports are
part of the same release. Descriptor v2 intentionally removes the ambiguous
geometry aliases from the public API and requires alternate catalogs to provide
a complete geometry contract. Repository-owned assets migrate their authored
part transforms and connections in the same cutover; consumers must do the same
instead of relying on inferred centered ports.

Endpoint-aware route evidence and `SimulationSession.routeEvidence()` also ship
in Core `0.2.0`. The same transaction cuts the strict
`material-resources` checkpoint owner from version 1 to version 2 and the state
digest domain to `simulacrum-checkpoint-state-v2`; there is no compatibility
reader, while the 20-owner set and checkpoint envelope version stay unchanged.

The next checkpoint-integrity cutover advances every owner except
`flexible-line-runtime` and `release-couplers` to version 2 and advances the
state digest domain to `simulacrum-checkpoint-state-v3`. Checkpoints no longer
duplicate authored topology or environment, geometry, mass, inertia, fixed
frames, projected thermal state, solver/contact caches, tire projections, or
derived network telemetry. Live material, pneumatic, and aerothermal owners
rebuild mass properties before version-2 kinematic physics is applied, and the
body-registry read model is then reconstructed from that final physics state.
Optional-owner presence, cross-owner time coherence, external-body policy,
strict numeric domains, structural event replay, target articulated topology,
trapped-controller capture, and controller publication also fail closed.
World-owned external kinematics attest immutable mass, inertia, collision
geometry, material identity, and canonical pairwise/default contact laws
without persisting process-local Cannon IDs; observer exceptions after commit
are contained. There is no compatibility reader for the older owner layouts; the
20-owner set and top-level checkpoint envelope remain unchanged at version 2.

The descriptor is derived from current catalog and part data. It is not added
to blueprint, workspace, share, or subassembly envelopes, so this cutover does
not advance a wire schema or add a compatibility reader. The package is
`0.2.0` in the source workspace.

The owned Cannon transaction v3 rolling-support cutover likewise ships in Core
`0.2.0`. Its transaction identity changes deliberately so checkpoints
captured under v2 motor-energy/contact semantics fail closed instead of being
restored under the new pre-annotation rolling-contact path. The additive public
`dispose()` methods on `CannonSolverTransaction` and `CannonWorldAdapter` are a
minor-version API addition and ship in that same `0.2.0` cutover.
