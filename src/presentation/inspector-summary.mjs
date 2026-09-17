import { CATALOG } from '../model/catalog.mjs';
/** Player-facing names for connection kinds; shared by the inspector's lists and summary. */
export const CONNECTION_LABELS = Object.freeze({
  spring: 'Slide',
  power: 'Power',
  shaft: 'Shaft',
  gear: 'Gear mesh',
  fixed: 'Mount',
  pivot: 'Pin',
  signal: 'Signal',
  rope: 'Rope',
  cord: 'Elastic cord',
});
// The connection that says most about what a part does, before how it is held.
const PRIORITY = ['shaft', 'gear', 'power', 'signal', 'spring', 'rope', 'cord', 'pivot', 'fixed'];
/**
 * One line under the selected part's name: its type, the primary compiled connection and the
 * count of compiled connections. A connection the compiler rejected is not wired.
 */
export function inspectorSummary(part, blueprint, compiled = []) {
  const rejected = new Set(compiled.filter((c) => c.reasonCode !== 'OK').map((c) => c.id));
  const wired = blueprint.connections.filter(
    (c) => !rejected.has(c.id) && (c.a.part === part.id || c.b.part === part.id),
  );
  const type = CATALOG[part.type]?.name ?? part.type;
  if (!wired.length) return `${type} · no connections yet`;
  const rank = (c) => {
    const index = PRIORITY.indexOf(c.kind);
    return index < 0 ? PRIORITY.length : index;
  };
  const primary = wired.reduce((best, c) => (rank(c) < rank(best) ? c : best));
  const other = primary.a.part === part.id ? primary.b.part : primary.a.part;
  const peer = blueprint.parts.find((p) => p.id === other)?.name ?? other;
  const label = CONNECTION_LABELS[primary.kind] ?? primary.kind;
  return `${type} · ${label} to ${peer} · ${wired.length} wired`;
}
