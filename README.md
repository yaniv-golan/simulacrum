# Simulacrum Foundry

A browser mechanical workshop: build ordinary components, connect power and controls,
then run the machine to understand its motion and failure.

The current construction loop includes motors, cells, keyboard receivers, surface
mounts, wheel hubs, powered steering hinges, mirroring, Undo/Redo and machine saves.
Human acceptance, sandboxed programs and locomotion qualification remain incomplete.
The [released version](https://github.com/yaniv-golan/simulacrum/releases) remains available.

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
