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

The additive `RigidClusterDescriptorV1` family and `compileAssembly()`
`rigidClusters` result are queued for the next minor release after `0.2.0`.
They describe derived physical topology only and do not change blueprint,
workspace, or share wire schemas. The same minor addition makes
`GeometryMassPropertiesV1.endpointPointMasses` explicit when endpoint-lumped
mass exists; it documents already-emitted compiler data. Its Newton-Euler
reconstruction function accepts the live compiler-owned rigid-cluster
descriptor as its first argument and serialized member/load/root-pose data as
its second argument, so world cut points remain derived authored data rather
than a second caller-owned authority. The cut-frame helper likewise requires a
serialized root pose or an internally issued immutable state. Accepting only recursively
immutable compiler-owned descriptor objects is part of this unreleased API's
initial contract, not a later narrowing. Compiler provenance is not publicly
mintable. Assembly compilation and multibody startup likewise initially accept
only serialized snapshots/catalogs or package-issued immutable roots; this is
not a later narrowing of an already released input contract. The oracle's load
arguments are also explicit in the initial contract:
gravity is required, each external load has a unique identity, application
point, and couple, and the result is conditional evidence with
`failureAuthority: false`. The result's supplied-load projection contains the
complete canonical load values rather than an ID-only summary. Before release,
`EndpointPointMassV1` was
correspondingly completed
with explicit source port, target part/port, and position-frame owner fields;
the compiler validates those fields against active topology before composition.

Checkpoint envelope version 2 remains current, but the
`compiled-topology`, `physics-world`, and `solver-contact` state-owner versions
advance from 1 to 2 in the next minor release. The same integrity cutover uses
owner version 2 for every owner except `flexible-line-runtime` and
`release-couplers`, which remain version 1. Their payloads now bind the
canonical complete compiled physical-semantics fingerprint, the direct
multibody state advances from version 1 to 2, and older owner/direct states fail
closed rather than restoring under a different capacity, frame, mass,
collision-exclusion, or cluster-authority model. This is an intentional
pre-1.0 minor-version checkpoint cutover and changes the checkpoint wire schema
owner-version constants. Restore also rejects collision-exclusion identity-set
disagreement, duplicate or mismatched physics-body identity against compiled
and live ownership, or serialized activity that contradicts restored
constraints. Runtime-consumed compiler collections now have one canonical
execution order, and the compiled physical fingerprint preserves it because
finite solver and network iteration order are execution policy. Direct
multibody and body-registry restore validate inert serialized or
exporter-issued,
closed candidates before mutation, so rejected version-2 state cannot alter
hidden solver order or leave partially imported physics behind.
Body-registry checkpoint validation/import is now a package-internal owner port
bound to constructor-owned connection identities. The observable registry
revision changes from a mutation counter to a content digest, making successful
rewind and failed-restore rollback exact without accepting a caller-selected
history value. Persisted constraint energy, dissipation, absolute temperature,
and thermal derate also reject nonphysical finite values.
Direct compiler input also rejects duplicate part or connection identities,
and accepted multibody restore now authenticates collision/endpoint provenance
while preserving constraints owned by other runtimes in their existing solver
order. Dynamic mass now reconstructs from its existing owners before exact
physics/registry matching; fixed frames, constraint scalar projections, and
tire-state schemas reject forged or incomplete state. Body-registry
construction also rejects duplicate source identities. Command and external
input-trace checkpoint maps now use injective typed IDs, so
numeric/string homographs no longer alias. Input-trace wire version 2 is an
intentional pre-1.0 minor cutover because version 1 erased that type distinction;
version-1 traces are rejected rather than heuristically routed. The package-internal checkpoint mass
planner/reconstructor do not appear on the public system class. The public
world-adapter checkpoint projection deliberately adds its fixed-step solver
profile to this same unreleased minor-version contract, so live iteration or
tolerance drift cannot hide behind a constant run identity; configuration
creation requires and hashes the effective adapter projection. The compiler
also exposes an explicit solver-order class on constraints instead of deriving
numerical policy from source-provenance cardinality. The pre-existing public
`MultibodyRuntime.commitMassProperties()`
and `BodyRegistry.setMassProperties()` signatures remain present but now reject
direct calls: the only live mutation path is the package-internal coordinated
owner transaction. That transaction rejects executable or custom-prototype
input, non-finite derived engine values, and rolls back exact engine caches and
fixed frames after late application errors. Coordinated checkpoint capture also
requires exact live registry/physics mass agreement before hashing state and
fully validates the live engine projection rather than trusting exported mass
metadata. Restore prevalidation purely derives target mass, COM, inertia, and
collision frames from target owner payloads before the first importer runs.
Runtime start shares the same finite reciprocal preflight, mutates no engine
body until every compiled body is representable, and rolls back exact installed
authority after a late installation failure. Initialization,
ordinary fixed ticks, and checkpoint reconstruction require the exact canonical
typed-ID record sequence from every compiled mutable-mass owner; missing,
duplicate, extra, reordered, or wrong-kind records fail closed. These are
stricter validations and deterministic owner ordering within the same
unreleased minor-version contract, not new public API surface.
The unreleased `MultibodyRuntime` constructor's former `materialForPart` option
is replaced before release by `materialForKey`: engine material identity comes
only from compiled collision primitives, and authored symmetric material pairs
own contact behavior. No released compatibility surface is removed.
The attachment-frame `sourceConnectionId`, fixed-edge capacity,
outgoing-boundary, and runtime-mass capability witness fields are additions
within the same unreleased rigid-cluster contract.
The complete authored powered-rotary law, solver-metered source-energy
settlement, strict actuator-ledger checkpoint equality, and injective
flexible-line provenance are corrections within this same unreleased minor
contract. No demo-conditioned controller or compatibility behavior is added.
