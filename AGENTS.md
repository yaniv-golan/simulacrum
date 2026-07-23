# Working on Simulacrum

This file is the operational entry point for coding agents. Keep it concise.
Detailed product, architecture, and API documentation belongs in the linked
sources of truth rather than being duplicated here.

## Read first

1. [CONTRIBUTING.md](CONTRIBUTING.md) for contributor invariants and required
   gates.
2. [ARCHITECTURE.md](ARCHITECTURE.md) for dependency direction and ownership.
3. [README.md](README.md) for player-visible behavior and controls.
4. [docs/CORE_API.md](docs/CORE_API.md) and
   [docs/core-extensions.md](docs/core-extensions.md) when changing reusable
   contracts.

When these documents disagree with executable code or tests, verify the actual
contract, fix the stale document in the same change, and do not preserve a
known contradiction.

## Non-negotiable rules

- Behavior must emerge from components, configuration, transforms,
  connections, controller commands, the environment, and physical laws. Never
  dispatch simulation behavior from demo identity or add demo-only physics.
- Built-in demos are ordinary strict blueprints. Anything they do must be
  constructible from the same parts and tools available to players.
- Use SI units in model and simulation code. All real-time and deterministic
  advancement must use the same fixed 1/120-second `SimulationSession` path.
- Preserve the system order: sensor snapshot -> controller commands ->
  power/signals -> actuators/constraints -> environment/forces -> integration
  and contacts -> structure/failure -> thermal/ablation -> telemetry.
- Controllers read the previous completed sensor snapshot. They may command
  only connected actuators, require physical power and signal paths, and may
  not bypass sandbox, fuel, watchdog, conflict, or channel validation.
- Telemetry is the shared read model for presentation, HUDs, challenges,
  scripts, replay, and automated text state. Do not create a second UI-only
  truth.
- The current blueprint schema is the only accepted machine format. Never infer missing ports,
  programs, battery units, remote targets, or unknown fields. Portable assets
  and local workspace state have separate schemas; do not create a second
  authority or add compatibility readers.
- Preserve unrelated user changes. Do not delete a path merely because a text
  search looks unused; check public exports, dynamic imports, wire formats,
  compatibility loaders, tests, and generated artifacts first.

## Ownership and dependency direction

| Area               | Owns                                                                               | Must not own                                                        |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/model`        | Pure assemblies, catalog, ports, blueprints, policies, analysis                    | DOM, Three.js, Cannon bodies, browser storage                       |
| `src/simulation`   | Fixed-step physics, networks, constraints, environment forces, failures, telemetry | DOM, CSS, camera, panels, demo dispatch                             |
| `src/scripting`    | Restricted compilation and isolated controller execution                           | UI effects, privileged simulation access                            |
| `src/presentation` | Three.js objects, camera, input, panels, visual effects                            | Authoritative physics or persistence policy                         |
| `src/application`  | Use cases, feature composition, lifecycle, event wiring                            | Reimplemented model/simulation policy or a service-locator monolith |
| `src/core`         | Stable, DOM-free public facade                                                     | Private substitutes for exported contracts                          |

Keep `src/application/simulacrum-app.js` a bounded startup coordinator. Extend
the appropriate feature, subsystem, model, or simulation system instead of
moving behavior back into the coordinator. Architecture checks enforce layer
direction, cycles, forbidden browser/physics access, demo dispatch, and
coordinator growth.

## Working method

1. Inspect the relevant implementation, tests, and contract documentation.
2. Make the smallest coherent change at the owning layer.
3. Add or update a deterministic contract test for model/physics behavior and
   a browser assertion for visible behavior.
4. Run focused verification while iterating. The harness accepts exact suite
   names, for example:

   ```bash
   TEST_FILTER=verify-rover-runtime npm test
   TEST_FILTER=verify-five-demos,verify-hybrid-assembly npm test
   TEST_FILTER=verify-test-site-contract,verify-course-evaluators,verify-testing-playground-user-loop npm test
   ```

5. For visual or interaction changes, exercise the complete input-to-state
   flow, inspect screenshots at laptop and wide-monitor layouts, compare them
   with `window.render_game_to_text()`, and check console/page/request errors.
   Preserve `window.advanceTime(ms)` as the deterministic browser stepping
   hook.
6. Update the owning contract documentation when behavior, architecture, or
   validation changes. Put change history in the commit and pull-request
   description rather than a repository work diary.

## Verification matrix

| Change                                                   | Minimum focused verification                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Model, blueprint, import, or storage                     | Model-boundary, blueprint, and storage suites plus round-trip fixtures          |
| Power, signal, actuator, or controller                   | Network and controller suites plus multi-controller or relevant machine runtime |
| Physics, mechanisms, terrain, fluids, flight, or failure | Owning runtime suite plus five demos and hybrid assembly where applicable       |
| Test Reserve, material contacts, deployment, or courses  | Test-site contract/authority, evaluator/records, and visible user-loop suites   |
| Editor, camera, controls, panels, or responsive UI       | Owning browser suite plus accessibility/adaptive-workspace checks               |
| Rendering, resources, or performance                     | Render-resource and bundle checks; run the live baseline for systemic changes   |
| Public core export or extension contract                 | `npm run core:check`, `npm run examples:core`, and core-pack verification       |

Before completing a substantial change, run:

```bash
npm run check
npm test
npm run build
git diff --check
```

Run `npm run mutation` when changing critical schema, network, controller,
challenge, or failure decision logic. Run `npm run baseline:verify` for systemic
performance/lifecycle changes. Run the 30-minute `npm run release:soak` before a
release or after high-risk resource-lifecycle work; it is not an ordinary edit
loop. Run `npm run mutation:test-site` when changing reserve geometry,
materials, deployment, route evaluation, or course evidence.

## Generated and public artifacts

- Edit the JSON Schema 2020-12 family in `src/model/schema/`, then run
  `npm run generate:wire-validators`; do not hand-edit any
  `src/model/generated/*-wire-validator.js`. Run `npm run check:generated`,
  `npm run coverage:wire`, and `npm run mutation:wire` for boundary changes.
- `packages/core/etc/simulacrum-core.api.md` is the committed API compatibility
  baseline. Ordinary builds must not rewrite it. For an intentional public API
  change, run `npm run core:update-api`, review the report, update the core
  changelog, and apply the versioning policy in `packages/core/SEMVER.md`.
- Do not commit generated `dist`, `coverage`, `artifacts`, `output`,
  `packages/core/dist`, `.api-types`, or `temp` contents.
- `docs/internal/` is intentionally ignored and suitable only for local audits
  and plans. Durable contributor guidance belongs in tracked documentation.

## Definition of done

A change is not complete because it renders once. It is complete when the
owning contract is explicit, first-principles behavior is preserved, focused
and proportional regression coverage passes, visible and text telemetry agree,
generated/public contracts are current, documentation is accurate, and the
worktree contains no accidental files.
