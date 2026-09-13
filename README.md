# Simulacrum Foundry

A browser mechanical workshop: build ordinary components, connect power and controls,
then run the machine to understand its motion and failure.

The current construction loop includes motors, cells, keyboard receivers, surface
mounts, wheel hubs, powered steering hinges, mirroring, Undo/Redo and machine saves.
Player-authored rules and a restricted TypeScript subset execute through bounded WASM
programs. Shared sensing, gears, springs, rope, reusable assemblies, powered cameras
and lamps extend the construction loop.

Implementation is distinct from qualification. Focused automated checks cover these
capabilities, but only source-bound completion evidence establishes verification for
a particular build. The manifest currently declares M3b; designated-player F1 acceptance
remains pending. The broader hostile-program S1 qualification, physical feasibility
probe, rover Course and legged Course qualification remain incomplete. The
[manifest](scripts/manifest.json) owns current allocation and registered checks;
`npm run gate` evaluates it rather than inferring progress from available features.
The `main` branch contains the v2 workshop. The previous implementation is retained
at the [`v1-final-2026-09-11` tag](https://github.com/yaniv-golan/simulacrum/tree/v1-final-2026-09-11)
and `archive/v1` branch for reference. Legacy v1 machine files are not a supported
import format for v2; keep their originals and use v1 to open them.
The [released versions](https://github.com/yaniv-golan/simulacrum/releases) remain available.

Use Node 24.18.x (with nvm installed):

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open the printed local URL. Start guided build teaches a supported three-wheel
machine; Try driving example provides an editable car. Read the [player guide](docs/player-guide.md).

For development, run `npm run ci`; use `npm run gate` for the actual current milestone,
including its human obligations. See the [developer guide](docs/development/README.md),
[architecture map](docs/development/architecture.md), [change recipes](docs/development/recipes.md)
and [playtesting guide](docs/development/playtesting.md).

[AGENTS.md](AGENTS.md), the [runtime contract](docs/contracts/runtime-v1.md),
[Course contract](docs/contracts/course-v1.md) and [manifest](scripts/manifest.json)
own architecture and qualification. A green smoke test is not Course or human acceptance.

MIT licensed. Product features are not partitioned into paid add-ons.
