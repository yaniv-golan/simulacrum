/**
 * Player-facing release notes, newest first. Tracked and imported by the app, so the
 * served notes are the notes of the served build: this file is hashed into the build id
 * and bundled with the assets. A note lands in the same candidate as the change it
 * describes, written by that change's implementer in player language and reviewed as
 * player copy. Only player-visible behaviour earns an entry: a control, a part or
 * setting, a sound, a fix the player could have noticed. Tooling, verification,
 * documentation and refactors never do.
 *
 * Fields: `id` (landing date + slug, unique, ordering key), `date` (the landing date,
 * never the writing date), `name`, `summary` (≤ 140 characters, no URL), optional
 * `feature` (a UI_FEATURES key or catalog part type that must exist in this build) and
 * optional `example` (an existing Learn & examples card command, validated by the
 * browser check). `scripts/check-release-notes.mjs` enforces the shape.
 */
export const RELEASE_NOTES = Object.freeze(
  [
    {
      id: '2026-09-15-source-on-github',
      date: '2026-09-15',
      name: 'Find the source on GitHub',
      summary:
        'A GitHub icon beside Help opens the open-source repository; Help now says which release you are on.',
    },
    {
      id: '2026-09-15-motor-connections',
      date: '2026-09-15',
      name: 'New motors show what to connect',
      summary:
        'Selecting a motor or hinge with nothing connected opens Connect & test with its missing power, control and shaft.',
    },
    {
      id: '2026-09-15-lift-with-shift',
      date: '2026-09-15',
      name: 'Lift parts with Shift and the arrows',
      summary:
        'Shift with the up/down arrows raises and lowers the selected part; Page Up/Down still work.',
    },
    {
      id: '2026-09-15-guided-first-build',
      date: '2026-09-15',
      name: 'Guided first build from the empty workshop',
      summary: 'An empty workshop offers a button that starts the rolling-machine guide.',
    },
    {
      id: '2026-09-15-copies-beside-original',
      date: '2026-09-15',
      name: 'Copies land beside the original',
      summary:
        'Copy (C) now places the copy right next to the original on the grid and keeps your view when the copy is already in sight.',
    },
    {
      id: '2026-09-15-lamp-shadows',
      date: '2026-09-15',
      name: 'Lamps cast shadows',
      summary:
        'A lit lamp now throws shadows from the parts in its beam while the view runs smoothly.',
      feature: 'poweredLamp',
    },
    {
      id: '2026-09-15-beam-length',
      date: '2026-09-15',
      name: 'Beams with a length you choose',
      summary:
        'Set a selected beam’s length, 100 to 1000 mm, in the inspector; mass follows. Beams can lie flat on a plate or lap across each other.',
      feature: 'beam',
    },
    {
      id: '2026-09-14-sound-level',
      date: '2026-09-14',
      name: 'Machine sound plays at a proper level',
      summary:
        'Motors, rolling and impacts are clearly audible again, about 18 dB louder than before; the volume slider works as usual.',
      feature: 'mechanicalSound',
    },
    {
      id: '2026-09-14-feedback-context-default',
      date: '2026-09-14',
      name: 'Feedback includes your project by default',
      summary:
        'Give feedback now attaches your saved project and workshop state unless you untick them.',
    },
    {
      id: '2026-09-14-feedback-attachment-steady',
      date: '2026-09-14',
      name: 'Feedback attachments stay steady',
      summary: 'The attachment checkbox no longer flickers while your feedback draft is being saved.',
    },
    {
      id: '2026-09-14-motor-readout-steady',
      date: '2026-09-14',
      name: 'Connect & test holds still while you drive',
      summary:
        'The motor readout keeps its height as you drive, so Connect & test no longer jumps under your pointer.',
    },
    {
      id: '2026-09-13-dialog-close',
      date: '2026-09-13',
      name: 'One close control for every dialog',
      summary: 'Every dialog closes from the × in its top-right corner or with Escape.',
    },
    {
      id: '2026-09-13-mechanical-sound',
      date: '2026-09-13',
      name: 'Machines make sound',
      summary:
        'Motors, rolling and impacts have sound. It starts off; turn it on beside Try again.',
      feature: 'mechanicalSound',
      example: 'spring-launcher-example',
    },
    {
      id: '2026-09-13-authorable-scenes',
      date: '2026-09-13',
      name: 'Edit the scene',
      summary: 'Choose or edit the scene: ramps, bumps, steps and your own boxes.',
      feature: 'authorableScenes',
    },
    {
      id: '2026-09-13-powered-lamp',
      date: '2026-09-13',
      name: 'Powered Lamp',
      summary: 'A lamp part with colour, brightness and beam spread.',
      feature: 'poweredLamp',
    },
    {
      id: '2026-09-13-camera',
      date: '2026-09-13',
      name: 'Camera',
      summary: 'A camera part that takes photos you can view and save.',
      feature: 'cameraPhotos',
    },
    {
      id: '2026-09-13-load-cell',
      date: '2026-09-13',
      name: 'Load Cell',
      summary: 'A sensor that measures the force through a mount.',
      feature: 'loadCellSensor',
    },
    {
      id: '2026-09-13-release-coupler',
      date: '2026-09-13',
      name: 'Release Coupler',
      summary: 'A mount that lets go when powered — drop cargo or stage a launch.',
      feature: 'releaseCoupler',
    },
    {
      id: '2026-09-12-rope',
      date: '2026-09-12',
      name: 'Rope',
      summary: 'A rope connection with real stretch and sag.',
      feature: 'ropeWorkshop',
    },
    {
      id: '2026-09-12-part-finishes',
      date: '2026-09-12',
      name: 'Part finishes',
      summary: 'Parts have material finishes in the catalogue and workshop.',
    },
  ].map(Object.freeze),
);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = new Set(['id', 'date', 'name', 'summary', 'feature', 'example']);
const ID = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(-[a-z0-9]+)*$/;

/** Pure shape check. `latestDate` is the newest date a note may carry (ISO). */
export function validateReleaseNotes(notes, { featureKeys, partTypes, latestDate }) {
  const errors = [];
  if (!Array.isArray(notes) || notes.length === 0) return ['release notes: empty'];
  const bound = new Set([...featureKeys, ...partTypes]);
  const ids = new Set();
  let previousDate = null;
  for (const note of notes) {
    const id = typeof note?.id === 'string' ? note.id : '<no id>';
    const fail = (field, why) => errors.push(`${id}: ${field} ${why}`);
    for (const key of Object.keys(note ?? {}))
      if (!FIELDS.has(key)) fail(key, 'is not a release note field');
    const idMatch = ID.exec(id);
    if (!idMatch) fail('id', 'must be <date>-<slug> in lowercase');
    if (ids.has(id)) fail('id', 'is a duplicate id');
    ids.add(id);
    if (typeof note.date !== 'string' || !ISO_DATE.test(note.date) || isNaN(Date.parse(note.date)))
      fail('date', 'must be an ISO date');
    else {
      if (idMatch && idMatch[1] !== note.date) fail('id', 'must start with its date');
      if (note.date > latestDate) fail('date', 'is in the future of this build');
      if (previousDate !== null && note.date > previousDate)
        fail('date', 'breaks newest-first order');
      previousDate = note.date;
    }
    if (typeof note.name !== 'string' || note.name.length < 1 || note.name.length > 60)
      fail('name', 'must be 1 to 60 characters');
    if (typeof note.summary !== 'string' || note.summary.length < 1 || note.summary.length > 140)
      fail('summary', 'must be 1 to 140 characters');
    else if (/:\/\/|www\./i.test(note.summary)) fail('summary', 'must not carry a URL');
    if (note.feature !== undefined && !bound.has(note.feature))
      fail('feature', 'must name a UI feature or catalog part of this build');
    if (note.example !== undefined && (typeof note.example !== 'string' || !note.example))
      fail('example', 'must name a Learn & examples card command');
  }
  return errors;
}
