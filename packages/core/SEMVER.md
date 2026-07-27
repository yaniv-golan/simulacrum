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

`GeometryDescriptorV2`, its strict definition/descriptor validators, canonical
port-frame connection checks, and the additive `flexible-line-v1` compiler,
runtime, material, system, topology, telemetry, and checkpoint exports are
queued for Core `0.2.0`. Descriptor v2 intentionally removes the ambiguous
geometry aliases from the public API and requires alternate catalogs to provide
a complete geometry contract. Repository-owned assets migrate their authored
part transforms and connections in the same cutover; consumers must do the same
instead of relying on inferred centered ports.

Endpoint-aware route evidence and `SimulationSession.routeEvidence()` are also
queued for Core `0.2.0`. The same transaction cuts the strict
`material-resources` checkpoint owner from version 1 to version 2 and the state
digest domain to `simulacrum-checkpoint-state-v2`; there is no compatibility
reader, while the 19-owner set and checkpoint envelope version stay unchanged.

The descriptor is derived from current catalog and part data. It is not added
to blueprint, workspace, share, or subassembly envelopes, so this cutover does
not advance a wire schema or add a compatibility reader. The package remains
`0.1.0` in the source workspace until the actual `0.2.0` release transaction.
