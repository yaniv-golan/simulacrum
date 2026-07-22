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
