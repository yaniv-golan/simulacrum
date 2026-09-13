# Rapier spring and contact runtime

This directory owns the pinned Rapier compatibility dependency, its complete source
patch and rebuild recipe. The package uses uniform f64 physical arithmetic and
Float64Array physical bindings. Debug colors remain Float32Array; index and handle
encodings retain their original integer/opaque semantics.

The application checks runtime version `0.20.0-simulacrum.spring.10.f64`. The physics
snapshot envelope records that backend identity and rejects incompatible
backend envelopes before native deserialization. Authored configurations
are unchanged; opaque checkpoints from earlier backend versions are incompatible.

The patch preserves contact impulse diagnostics, symplectic spring integration,
sparse tree elimination and a dense complement only for loop-closing rows. The
application's bilateral response uses an owned numerical factor from the same
row/CFM convention and factorization. If tree refinement stalls at extreme stop
row scales, the final correction uses independent native joint blocks (at most six
rows each). Acceptance still checks every original equation with the same residual
bound and three-correction limit. Both tree and cyclic original-equation checks
include a coefficient-weighted minimum-subnormal rounding allowance when the
relative term underflows. Ordinary rows that satisfy the finite relative bound
return before the underflow calculation. The normal relative tolerance is unchanged; finite
inputs and finite bounds remain required, and no physical state is clamped.
Factors contain no live world references;
the physics door releases them at the end of their preparation lifetime. Derived
world inertia refreshes from local mass properties and world-axis lock settings
following each existing rotation integration. Unbounded bilateral components use
this factorization even when no elastic axis is active. Finite motor caps and
unsupported body mobility retain the ordinary bounded solver. Within each fixed-pose
biased iteration batch, worker-local factors are reused for the same ordered
component. Every pass still rebuilds the velocity/impulse-dependent right-hand side,
checks the original residual, and applies limits in the original order. Prepared row geometry, component partitioning, admission and raw tree responses
share that batch lifetime. Raw responses are reused only for an exactly equal RHS;
residual checks and clamp/body updates still execute on every pass. Body-local
response accumulation retains the original row/endpoint order and f64 arithmetic.
The cache is discarded before integration; unbiased refreshes, later substeps and restored
worlds start with fresh factors.

`parry.patch` fixes previous-simplex witness ownership in Parry 0.30.2. It also
omits a redundant GJK contact only when both local endpoints coincide with an
existing feature contact within a coordinate-scaled floating-point error bound.
Distinct contact witnesses remain present. Near touching contacts retain a checked
support-plane direction instead of normalizing a vanishing witness difference.
GJK carries each best support bound with its proving direction, including the
initial direction, and applies its existing convergence tolerance at zero-simplex
exits. Genuine penetration outside that tolerance still uses EPA.
Coulomb friction minimizes the coupled
positive-semidefinite quadratic over its impulse disk, including accumulated
impulses and generalized endpoints; it checks feasibility and KKT residuals.

## Joint reaction diagnostics

`RawImpulseJointSet.jointAppliedLinearImpulse(handle)` returns a copied f64 XYZ
impulse on the joint's native body1, in world coordinates and N s. Native body2
receives the opposite linear impulse. An absent handle or a joint without a completed
active solve returns no receipt. A solved zero is distinct from absence. The receipt
resets once per external pipeline step, sums all CCD subdivisions and internal
substeps, and records the actual scalar, SIMD and coupled row applications. It
includes applied warm starts exactly once, preserves vectors through row rebuilds,
and deduplicates padded SIMD writeback lanes. It is a force diagnostic, not a torque
or capacity measurement. The transient native receipt is excluded from serialization;
the application owns completed receipt checkpoint history.

`RawBilateralResponse.projectWithJointImpulses` and
`responseWithJointImpulses` preserve the existing body impulse/velocity prefix and
append one XYZ correction impulse on body1 for each input joint, in input order.
The factor retains each row's joint identity before accumulation into bodies.
Queries remain read-only. Only a response actually applied by the physics door,
with the same physical scale, contributes to a completed reaction receipt.

The recipe runs `test-joint-reactions.mjs` on its built package: suspended-force and
per-tick momentum checks over multiple masses, gravity values and subdivisions,
free fall, copied receipts, restore continuation and prepared attribution. These
bounded native checks complement the application's force-sensor witnesses and the
heavy native qualification below; they do not establish arbitrary-assembly accuracy.

## Rebuild

Run `build.sh` with Node 24.18.0, Rust 1.94.0 and its wasm32-unknown-unknown target,
wasm-bindgen 0.2.128, wasm-opt 111, Python 3, npm and patch available on PATH.
Install repository dependencies first; the recipe uses its pinned TypeScript 5.9.3.
It verifies the pinned Rapier and Parry sources, applies both patches, runs the
pure friction and residual-bound regression tests and builds only the
3D f64 package. It acquires `/tmp/simulacrum-rapier-contact-build-v2` exclusively as the physical
compilation root so Cargo external dependency identities remain stable. Each run
starts with fresh sources and targets. On normal success or failure, all files move
to its separately reserved output directory; the compilation root is then released.
An occupied root is never stolen. After interruption, inspect its `owner.txt`, wait
for any compiler descendants to exit, preserve the files, and remove the empty root
manually before rebuilding. Interrupted or failed archival never silently releases
the root. The generated package is retained in the output directory.

Set `RAPIER_SOURCE_ARCHIVE` to an existing copy of the pinned archive to skip its
download. `PARRY_SOURCE_ARCHIVE` selects the pinned Parry crate archive; otherwise
the recipe checks the Cargo cache before downloading it. `RAPIER_OFFLINE=1`
requires both source archives and all npm/Cargo dependencies already available.
Provenance records the exact source, patch, toolchain, WASM and package hashes.

## Repeatable qualification

`npm run native:qualify -- /path/to/inputs.json` executes the retained six-case,
2640-tick cache comparison plus cold restores, stale-factor/RHS controls and two
clean rebuilds. This heavy native-change qualification is separate from CI. It
does not qualify arbitrary assemblies or other platforms. Input roles are `baseline`,
`candidate`, `staleFactor`, `staleRhs`; each supplies absolute `package`, `patch`,
`packageSha256`, `patchSha256`, and `version` (spring.6, spring.7, spring.8, spring.9 or spring.10 f64). Preserve
the controlled source patches and build evidence with those artifacts. Each non-candidate role also requires `reviewedDifferenceSha256` (SHA256 of candidate
patch bytes, a NUL byte, then control patch bytes) and `reviewRationale` describing the
reviewed change. The runner freezes all inputs, rebuilds each role from its patch,
compares the package bytes, and executes that newly built package. This is semantic
review of a controlled change, not a role-name assertion. It derives all variants
from one frozen application snapshot and checks their bytes again after execution.
The current candidate must match provenance.json. Each run retains its private
directory and fails on absent controls, infrastructure-only failures or differing
package/WASM outputs. Existing RAPIER_OFFLINE and source archive inputs apply.
`RAPIER_BUILD_DIR` chooses a new, nonexistent retained output directory outside the
compilation root; otherwise mktemp reserves one. Builds are serialized across
checkouts while their retained outputs remain separate. No installed package changes.

Physical equivalence uses the same test-only adapter in every frozen role: it keeps
physical response queries/applications and all native snapshot payload bytes, while
suppressing the new diagnostic reads. Envelope comparison normalizes the backend
version and its length/checksum only. Exact replacement guards and source hashes
record the adapter. This comparison proves bounded physical equivalence; the native
reaction probes and independent application force tests separately check diagnostics.
Historical packages lack the new diagnostic API, so their reviewed build recipes omit
only its probe. The retained spring.8 controls also omit the spring.9 residual-bound
unit probe whose source is absent. Candidate builds retain every current probe, and
the report records historical omissions and each reviewed compound difference.
