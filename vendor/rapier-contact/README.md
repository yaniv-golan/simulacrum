# Rapier spring and contact runtime

This directory owns the pinned Rapier compatibility dependency, its complete source
patch and rebuild recipe. The package uses uniform f64 physical arithmetic and
Float64Array physical bindings. Debug colors remain Float32Array; index and handle
encodings retain their original integer/opaque semantics.

The application checks runtime version `0.20.0-simulacrum.spring.7.f64`. Physics
snapshot envelope version 4 records that backend identity and rejects previous
precision/layout envelopes before native deserialization. Authored configurations
are unchanged; opaque checkpoints from earlier backend versions are incompatible.

The patch preserves contact impulse diagnostics, symplectic spring integration,
sparse tree elimination and a dense complement only for loop-closing rows. The
application's bilateral response uses an owned numerical factor from the same
row/CFM convention and factorization. If tree refinement stalls at extreme stop
row scales, the final correction uses independent native joint blocks (at most six
rows each). Acceptance still checks every original equation with the same residual
bound and three-correction limit. Factors contain no live world references;
the physics door releases them at the end of their preparation lifetime. Derived
world inertia refreshes from local mass properties and world-axis lock settings
following each existing rotation integration. Unbounded bilateral components use
this factorization even when no elastic axis is active. Finite motor caps and
unsupported body mobility retain the ordinary bounded solver. Within each fixed-pose
biased iteration batch, worker-local factors are reused for the same ordered
component. Every pass still rebuilds the velocity/impulse-dependent right-hand side,
checks the original residual, and applies limits in the original order. The cache
is discarded before integration; unbiased refreshes, later substeps and restored
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

## Rebuild

Run `build.sh` with Node 24.18.0, Rust 1.94.0 and its wasm32-unknown-unknown target,
wasm-bindgen 0.2.128, wasm-opt 111, Python 3, npm and patch available on PATH.
Install repository dependencies first; the recipe uses its pinned TypeScript 5.9.3.
It verifies the pinned Rapier and Parry sources, applies both patches, runs the
pure friction regression tests and builds only the
3D f64 package. It uses `/tmp/simulacrum-rapier-contact-build-v2` as a fixed path
and refuses to overwrite an existing run. Preserve or remove that directory
explicitly before another build. The generated package remains in that directory.

Set `RAPIER_SOURCE_ARCHIVE` to an existing copy of the pinned archive to skip its
download. `PARRY_SOURCE_ARCHIVE` selects the pinned Parry crate archive; otherwise
the recipe checks the Cargo cache before downloading it. `RAPIER_OFFLINE=1`
requires both source archives and all npm/Cargo dependencies already available.
Provenance records the exact source, patch, toolchain, WASM and package hashes.
