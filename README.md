# Simulacrum

**Play it: https://simulacrum.build**

Simulacrum is a mechanical workshop in your browser for curious 14–17-year-olds who have
outgrown builders where the parts do the thinking for you. You build machines from
ordinary parts — motors, cells, wheels, beams, hinges, gears, springs, lamps, cameras —
join them with mounts and rope, connect power and controls, press Run, and watch how
the machine moves and why it fails.

## Status

**Experimental. Latest release: v0.3.0 (September 2026).**

What works today: place parts, mount them to each other, wire a cell to a motor and a
motor to a wheel, drive with the keyboard, mirror, undo, save and reopen your machine,
and open **Learn & examples** for a guided build or an editable example car. Motors,
rolling and impacts make sound once you turn Sound on. Rules and small programs are
there if you want them; you never need code to make a wheel turn.

Known gaps: there are still few parts (one beam length, no small pivot pin, no brake),
and the first session is rough — moving a part up, copying a part, and seeing which
connections a motor still needs are harder to find than they should be. These come
straight from playtest feedback and are being worked on.

Say what happened: use the **Give feedback** button in the workshop. It sends your
note to Yaniv for review, with a picture of your workshop and a copy of your machine
unless you untick them.

Each release passes its automated checks before it is published, but the
human-acceptance and course milestones are not yet met; the [developer guide](docs/development/README.md#milestone-status)
records exactly where the project stands.

## Run it locally

Use Node 24.18.x (with nvm installed):

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open the printed local URL. Start guided build teaches a supported three-wheel
machine; Try driving example provides an editable car. Read the
[player guide](docs/player-guide.md).

## Develop

See the [developer guide](docs/development/README.md) and [AGENTS.md](AGENTS.md).

The previous implementation (v1) is kept at the
[`v1-final-2026-09-11` tag](https://github.com/yaniv-golan/simulacrum/tree/v1-final-2026-09-11)
and the `archive/v1` branch; v1 machine files are not a supported import format for v2.

MIT licensed. Product features are not partitioned into paid add-ons.
