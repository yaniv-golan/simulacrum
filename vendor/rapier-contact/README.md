# Spring and contact dependency

This local package adds read-only contact observations and a bounded elastic solver
to Rapier's pinned npm 0.20.0 source. It preserves legacy contact accumulators because
those feed subsequent solver behavior. The spring changes are explicitly opt-in through
`SymplecticSpring`; this is not an official Dimforge release.

The application admits active elastic mechanisms whose native joint graph is a tree,
with all immovable bodies identified as ground. Unsupported cycles are rejected before
world construction. A fixed connection path, including separate grounded fixed
components, proves zero relative mobility; those springs retain their authored energy
and configuration but do not enable native elastic actuation. Unrelated nonelastic
components retain their existing solve. This does not qualify cyclic spring mechanisms.

The added model uses a semiimplicit elastic sample at each of the four frozen native
temporal subdivisions. A scalar joint-component solve resolves elastic and bilateral
rows together; existing unilateral limits and contacts follow. Independent joint
components remain separate even when contact puts them in the same island. The
post-integration pass refreshes joint lever arms while preserving the elastic sample.
The coordinate gradient uses one shared linear-reaction point, and scalar quaternion
basis conversion uses the homogeneous normalized formula. These geometry corrections
also affect legacy scalar joint rows; this is not a trajectory-neutral dependency.
Physical damping and funded motor impulses remain owned by the application.

The bounded application uses unbounded native elastic rows and does not expose generic
native motor targets, finite native motor limits or multibody articulations. The tree
factorization eliminates body and joint blocks of at most six rows. Balanced component
discovery and two small matrix products avoid dependence on joint ordering and dense
whole-component factorization. At most three iterative refinements reuse the factors;
the original equations must satisfy a checked componentwise backward-error bound.
This numerical check is not a universal forward-error or physical-fidelity guarantee.
A singular factor or unresolved residual fails explicitly instead of silently using
a dissipative fallback. This is not a general constrained optimizer.
Changing this domain requires new physical, restoration and performance qualification.

`provenance.json` binds the source archive, patch and WASM artifact. `Cargo.lock`
pins resolved Rust dependencies; upstream npm lockfiles pin the binding build tools.
The source commit is the npm publication's gitHead and SLSA provenance commit.
Publication provenance signatures were not independently verified.

`build.sh` rebuilds at the fixed public path `/tmp/simulacrum-rapier-contact-build-v1`,
refusing an existing directory and retaining its outputs. Cargo path identities affect
WASM symbol ordering; embedded source locations are also remapped to public paths. It requires
Node 24.18.0, Rust 1.94.0 and its wasm32 target; wasm-pack 0.12.1 uses wasm-bindgen
0.2.128 and wasm-opt 111. Build tools may need network access. The recipe does not
replace the checked artifact automatically. Compare hashes and rerun dependency
qualification before adopting any rebuild; cross-host bit reproducibility is not
established. Ordinary application installation needs no Rust toolchain.

The added normal accumulator excludes the previous tick's retained seed and sums
solved temporal subdivisions, including their warm starts and final restitution.
Friction uses the same bookkeeping, counted once per solver friction group. The
legacy accumulator includes that seed and is not a physical tick impulse.

The diagnostic supports `maxCcdSubsteps <= 1`. Larger configured values clear the
observations rather than reporting the last slice as the full tick. Unprocessed
contacts, including sleeping contacts, have absent observations. The application
pins one CCD slice and validates that setting on restore.

Normal direction is the frozen solver manifold normal. Tangential and pure-twist
vectors act on manifold body 1; normal impulse acts opposite the manifold normal.
Pure twist is not total angular impulse: normal and tangential forces also have
moments through frozen solver lever arms. These fields include velocity stabilization
and do not claim to measure continuous contact time or final-pose contact geometry.

The added fields change the opaque solver snapshot format. Application envelopes
must reject incompatible prior snapshots before deserializing them. Authored
blueprints remain independent of this binary format. Upstream source and this local
patch are Apache-2.0; see `LICENSE`.

Remove this package when an upstream release provides equivalent tick-impulse and bounded elastic semantics
and passes the same independent load, impact, friction, lifecycle, snapshot, elastic
energy, angular momentum, topology, power and performance controls. An upgrade must re-trace the accumulator and friction grouping in
that exact source revision, reproduce the artifact, version incompatible snapshots and
rerun existing completion checks. Do not carry this patch blindly across solver changes.
