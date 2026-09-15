import { CATALOG } from '../model/catalog.mjs';
import { PART_HELP } from './part-help-content.mjs';

const entry = (category, aliases, actions, related = '') => ({
  category,
  aliases: aliases.split('|').filter(Boolean),
  actions: actions.split('|').filter(Boolean),
  related: related.split('|').filter(Boolean),
});
// Discovery vocabulary only. Names, availability and physical meaning retain their owners.
export const PART_SEARCH = Object.freeze({
  powerCell: entry('Power', 'battery|batteries', 'energy|electricity|supply power'),
  poweredLamp: entry(
    'Power',
    'lamp|headlamp|headlight|light',
    'illuminate|lighting|shine|light up',
  ),
  poweredMotor: entry('Motion', 'engine', 'spin|drive|rotate|rotation|create rotation'),
  gripWheel: entry('Motion', 'tyre|tire', 'traction|roll|rolling|ground'),
  beam: entry('Structure', 'bar|link', 'frame|support|arm|length|adjustable'),
  plate: entry('Structure', 'platform', 'flat|floor|support'),
  steelAxle: entry('Motion', 'shaft|rod', 'transmit rotation', 'spin|rotation'),
  passiveBearing: entry('Motion', 'bearing', 'support axle|support shaft', 'rotation|spin'),
  linearActuator: entry(
    'Motion',
    'linear actuator|electric cylinder',
    'extend|retract|push|pull|linear motion',
  ),
  poweredHinge: entry('Motion', 'hinge|joint', 'bend|steer|turn joint', 'rotation'),
  releaseCoupler: entry('Motion', 'latch|release coupling', 'release cargo|detach tool|drop load'),
  ball: entry('Motion', 'sphere', 'roll|drop|catch'),
  gear12: entry('Motion', 'cog|teeth|gearing', 'transmit rotation|torque|speed ratio', 'spin'),
  gear24: entry('Motion', 'cog|teeth|gearing', 'transmit rotation|torque|speed ratio', 'spin'),
  wheelHub: entry('Motion', 'hub', 'connect wheel', 'axle|shaft'),
  shaftMount: entry('Motion', 'shaft mount', 'mount arm|crank|adapt axle'),
  spacerBlock: entry('Structure', 'spacer', 'gap|offset|clearance'),
  mountingBlock: entry('Structure', 'mount', 'mounting|support|offset'),
  chassis: entry('Structure', 'base|frame', 'support|car'),
  springGuide: entry('Structure', 'guide', 'spring|suspension|slide'),
  springCarriage: entry('Structure', 'carriage', 'spring|suspension|slide'),
  distributionBus: entry('Power', 'bus|splitter', 'distribute power|branch|wiring', 'electricity'),
  commandReceiver: entry(
    'Controls',
    'receiver|remote',
    'keyboard|keys|control with keys|drive with keys',
  ),
  positionRegulator: entry('Controls', 'regulator', 'automatic spring length|suspension'),
  logicController: entry('Controls', 'computer', 'program|rules|code|logic'),
  learningController: entry('Controls', 'learning', 'train|teach|learn|model'),
  camera: entry('Sensors', 'photo|photograph|camera', 'take pictures|view from machine|snapshot'),
  rangeSensor: entry('Sensors', 'range', 'detect distance|measure distance|distance ahead'),
  targetSensor: entry(
    'Sensors',
    'target distance',
    'detect distance|measure distance|distance to target',
  ),
  linearMotionSensor: entry(
    'Sensors',
    'velocity sensor',
    'measure speed|detect motion|linear velocity',
  ),
  tiltSensor: entry('Sensors', 'tilt', 'measure tilt|detect tilt|lean|balance'),
  jointAngleSensor: entry('Sensors', 'joint angle', 'measure angle|detect joint angle'),
  contactSensor: entry('Sensors', 'touch sensor', 'touch|hit|ground contact|detect contact'),
  loadCellSensor: entry(
    'Sensors',
    'load cell|force sensor',
    'measure force|measure tension|measure compression|attachment load',
  ),
  rotationSensor: entry(
    'Sensors',
    'rotation sensor',
    'detect rotation|measure rotation|measure spin',
    'spin',
  ),
  travelSensor: entry('Sensors', 'travel', 'measure spring length|detect travel|suspension length'),
});
export const ESSENTIAL_PARTS = Object.freeze([
  'powerCell',
  'poweredMotor',
  'gripWheel',
  'beam',
  'plate',
  'steelAxle',
  'passiveBearing',
  'poweredHinge',
  'ball',
]);
const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function near(a, b) {
  if (a.length < 4 || /\d/.test(a + b) || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const wrong = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
    return (
      wrong.length === 1 ||
      (wrong.length === 2 &&
        wrong[1] === wrong[0] + 1 &&
        a[wrong[0]] === b[wrong[1]] &&
        a[wrong[1]] === b[wrong[0]])
    );
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}
export function searchParts(query, available = Object.keys(CATALOG)) {
  const text = normalize(query);
  if (!text) return [];
  const tokens = text.split(' ');
  function match(fuzzy) {
    const results = [];
    for (const [order, type] of available.entries()) {
      const meta = PART_SEARCH[type];
      if (!meta || !CATALOG[type]) continue;
      const name = normalize(CATALOG[type].name);
      // A numeric constraint cannot be satisfied by an unrelated alias or a partial match.
      if (tokens.some((t) => /\d/.test(t) && !name.split(' ').includes(t))) continue;
      const fields = [
        [name, 0],
        ...meta.aliases.map((s) => [s, 1]),
        ...meta.actions.map((s) => [s, 2]),
        [PART_HELP[type].purpose, 2],
        ...meta.related.map((s) => [s, 3]),
      ];
      // A query may combine identity and function ("motor spin"). Combine
      // per-token evidence without letting many aliases inflate relevance.
      const evidence = tokens.map(
        (t) =>
          fields
            .flatMap(([phrase, tier]) =>
              normalize(phrase)
                .split(' ')
                .some((w) =>
                  fuzzy ? w === t || near(t, w) : w === t || (t.length >= 3 && w.startsWith(t)),
                )
                ? [{ phrase, tier }]
                : [],
            )
            .sort((a, b) => a.tier - b.tier)[0],
      );
      let best = evidence.every(Boolean)
        ? {
            type,
            related: false,
            rank: [0, Math.max(...evidence.map((e) => e.tier)), 1, -tokens.length],
            order,
            reason: fuzzy
              ? `Matched ${[...new Set(evidence.map((e) => e.phrase))].join(' · ')}`
              : PART_HELP[type].purpose,
          }
        : null;
      for (const [phrase, tier] of fields) {
        const words = normalize(phrase).split(' ');
        const covered = tokens.filter((t) =>
          words.some((w) =>
            fuzzy ? w === t || near(t, w) : w === t || (t.length >= 3 && w.startsWith(t)),
          ),
        );
        if (!covered.length) continue;
        const related = covered.length !== tokens.length;
        const rank = [related ? 1 : 0, tier, normalize(phrase) === text ? 0 : 1, -covered.length];
        const candidate = {
          type,
          related,
          rank,
          order,
          reason: fuzzy
            ? `Matched ${phrase}`
            : related
              ? `Related · ${PART_HELP[type].purpose}`
              : tier
                ? PART_HELP[type].purpose
                : '',
        };
        if (!best || compare(candidate, best) < 0) best = candidate;
      }
      if (best) results.push(best);
    }
    return results.sort(compare);
  }
  function compare(a, b) {
    for (let i = 0; i < a.rank.length; i++)
      if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
    return a.order - b.order;
  }
  const direct = match(false);
  // Weak partial matches must not prevent a complete conservative correction.
  const corrected = direct.some((row) => !row.related)
    ? []
    : match(true).filter((row) => !row.related);
  const correctedTypes = new Set(corrected.map((row) => row.type));
  return [...corrected, ...direct.filter((row) => !correctedTypes.has(row.type))].map(
    ({ type, reason, related }) => ({
      type,
      reason,
      related,
    }),
  );
}
