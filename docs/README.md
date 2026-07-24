# Simulacrum documentation

Use this page to choose the document that owns the question you are trying to
answer. Unless a section says otherwise, these guides describe the current
source checkout and strict version-1 contracts.

## Players and builders

| Need                                       | Start here                                          |
| ------------------------------------------ | --------------------------------------------------- |
| Install, start, and learn the workshop     | [Main README](../README.md)                         |
| Select, arrange, reuse, and analyze parts  | [Editor tools](EDITOR_TOOLS.md)                     |
| Build and debug controller programs        | [Controller programming](CONTROLLER_PROGRAMMING.md) |
| Attempt outcome-based engineering tasks    | [Challenge Lab](CHALLENGE_LAB.md)                   |
| Deploy and test a machine on the reserve   | [Workshop Test Reserve](TEST_GROUND.md)             |
| Build, attach, simulate, and diagnose Rope | [Rope](ROPE.md)                                     |
| Share machines and reusable parts          | [Blueprint Exchange](BLUEPRINT_SHARING.md)          |
| Diagnose failures and inspect replay       | [Failure analysis](FAILURE_ANALYSIS.md)             |

The in-game **Learn** panel remains the fastest reference for visible controls
and current player workflows.

## Contributors

| Need                                         | Start here                                |
| -------------------------------------------- | ----------------------------------------- |
| Setup, focused tests, and pull-request gates | [Contributing](../CONTRIBUTING.md)        |
| Layer ownership and dependency direction     | [Architecture](../ARCHITECTURE.md)        |
| Blueprint-to-physics compilation             | [Assembly compiler](ASSEMBLY_COMPILER.md) |
| Coding-agent operating rules                 | [AGENTS.md](../AGENTS.md)                 |

Executable code and tests take precedence when documentation disagrees with the
checkout. Fix the owning guide in the same change as a contract update.

## Core consumers

Simulacrum Core is currently a source-checkout workspace package; it is not
published to npm yet.

| Need                                | Start here                                           |
| ----------------------------------- | ---------------------------------------------------- |
| Public facade overview and examples | [Core API](CORE_API.md)                              |
| Executable extension examples       | [Extending Simulacrum Core](core-extensions.md)      |
| Package quick start                 | [Core package README](../packages/core/README.md)    |
| Compatibility rules                 | [Core versioning policy](../packages/core/SEMVER.md) |
| Package changes                     | [Core changelog](../packages/core/CHANGELOG.md)      |

## Project policy and history

- [Project changelog](../CHANGELOG.md)
- [Security policy](../SECURITY.md)
- [Code of conduct](../CODE_OF_CONDUCT.md)
- [MIT license](../LICENSE)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)

## Documentation maintenance

- Keep player workflows in the main README or the matching feature guide.
- Keep ownership and dependency rules in `ARCHITECTURE.md`.
- Keep reusable API contracts in `CORE_API.md`, `core-extensions.md`, or the
  package documentation.
- Describe future work explicitly as planned; do not mix it into current
  capability lists.
- Use the canonical workspace import name
  `@yaniv-golan/simulacrum-core` in reusable examples.
