/** Illustrative synthesis policy, never physical sound pressure or motor construction. */
export const AUDIO_POLICY = Object.freeze({
  motorVoices: 8,
  contactVoices: 4,
  impactVoices: 8,
  impactsPerFrame: 4,
  release: 0.03,
  grace: 0.025,
  impactOnset: 0.01,
  renewalRatio: 4,
  maxAge: 0.1,
  horizon: 0.05,
  deadband: 0.01,
});
const finite = Number.isFinite;
const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export function driveVoice(row) {
  const rotation = row.coordinate === 'rotation';
  if (!rotation && row.coordinate !== 'linear') return null;
  const speed = rotation ? row.speedRadS : row.speedMS,
    effort = rotation ? row.torqueNm : row.forceN;
  if (
    !vector(row.position) ||
    !(speed === null || finite(speed)) ||
    ![row.currentA, row.currentScaleA, effort].every(finite) ||
    row.currentScaleA <= 0
  )
    return null;
  const rate = Math.abs(speed ?? 0),
    load = clamp(Math.abs(row.currentA) / row.currentScaleA);
  return {
    ...row,
    key: `drive:${row.emitterKey}`,
    wave: rotation ? 'triangle' : 'noise',
    frequency: rotation ? clamp(60 + rate * 4, 60, 2400) : clamp(160 + rate * 350, 160, 700),
    motionGain: (rotation ? 0.014 : 0.009) * clamp(rate / (rotation ? 20 : 0.08)),
    loadGain: 0.004 * load,
  };
}
function validContact(row) {
  return !(
    !row.valid ||
    !vector(row.position) ||
    ![row.normalImpulseNs, row.normalLoadN, row.slipSpeedMS].every(finite) ||
    row.normalImpulseNs < 0.01 ||
    row.normalLoadN < 0 ||
    row.slipSpeedMS < 0 ||
    !(row.rollingSpeedMS === null || finite(row.rollingSpeedMS))
  );
}
export function contactVoice(row) {
  if (!validContact(row)) return null;
  const slip = row.slipSpeedMS,
    roll = Math.max(0, row.rollingSpeedMS ?? 0),
    load = clamp(Math.log1p(row.normalLoadN) / 6);
  const blend = 1 - clamp(slip / Math.max(0.01, roll));
  return {
    ...row,
    key: `contact:${row.pairKey}`,
    frequency: 180 + Math.min(1200, slip * 300),
    scrapeGain:
      row.frictionEligibility === 'positive' && slip > 0.01 ? 0.012 * load * clamp(slip) : 0,
    rollGain:
      row.geometryClass === 'curved' && roll > 0.01 ? 0.008 * load * blend * clamp(roll) : 0,
  };
}
export function spatialMix(position, listener) {
  if (!vector(position) || !vector(listener?.position) || !vector(listener?.right))
    return { pan: 0, gain: 1 };
  const delta = position.map((v, i) => v - listener.position[i]),
    distance = Math.hypot(...delta);
  return {
    pan: clamp(
      delta.reduce((sum, v, i) => sum + v * listener.right[i], 0) / Math.max(1, distance),
      -0.8,
      0.8,
    ),
    gain: 1 / (1 + 0.15 * Math.max(0, distance - 1)),
  };
}
export function selectVoices(rows, incumbents, limit) {
  return rows
    .filter((r) => finite(r.score) && r.score > 0)
    .sort(
      (a, b) =>
        b.score * (incumbents.has(b.key) ? 1.25 : 1) - a.score * (incumbents.has(a.key) ? 1.25 : 1),
    )
    .slice(0, limit);
}
/** Per-tick semantics are independent of renderer batching. Gaps establish silent baselines. */
export function createMechanicalEvents() {
  let epoch,
    tick = -1,
    available = false,
    episodes = new Map();
  return {
    read(packet) {
      const empty = { impacts: [], drives: [], contacts: [], reset: false };
      if (epoch === packet.epoch && packet.tick <= tick) return { ...empty, duplicate: true };
      const timelineContiguous =
        epoch === packet.epoch &&
        packet.tick === tick + 1 &&
        finite(packet.interval) &&
        packet.interval > 0;
      const contiguous = available && packet.available && timelineContiguous;
      if (!contiguous) episodes.clear();
      epoch = packet.epoch;
      tick = packet.tick;
      available = packet.available;
      for (const key of packet.separations ?? []) episodes.delete(key);
      const impacts = [],
        contacts = [];
      for (const row of packet.contacts ?? []) {
        if (!packet.available || !validContact(row)) {
          episodes.delete(row.pairKey);
          continue;
        }
        const previous = episodes.get(row.pairKey);
        const recent =
          previous &&
          (tick - previous.tick) * packet.interval <= AUDIO_POLICY.grace + packet.interval;
        const renewed =
          previous && row.normalImpulseNs > previous.support * AUDIO_POLICY.renewalRatio;
        // A spatially distinct new patch may strike while another patch still supports the pair.
        const newPatch =
          previous?.patches?.length &&
          row.patches?.some(
            (p) =>
              p.impulse > 0.01 &&
              previous.patches.every(
                (q) =>
                  Math.hypot(...p.a.map((v, i) => v - q.a[i])) > 0.02 &&
                  Math.hypot(...p.b.map((v, i) => v - q.b[i])) > 0.02,
              ),
          );
        if (contiguous && (!recent || renewed || newPatch))
          impacts.push({ ...row, tick, impulse: row.normalImpulseNs, materials: row.materialPair });
        if (previous && previous.tick === tick - 1) contacts.push(row);
        episodes.set(row.pairKey, {
          tick,
          support: recent
            ? 0.8 * previous.support + 0.2 * row.normalImpulseNs
            : row.normalImpulseNs,
          patches: row.patches,
        });
      }
      for (const [key, value] of episodes)
        if ((tick - value.tick) * packet.interval > AUDIO_POLICY.grace + packet.interval)
          episodes.delete(key);
      return {
        impacts,
        contacts,
        drives: packet.drives ?? [],
        reset: !timelineContiguous,
      };
    },
    reset() {
      epoch = undefined;
      tick = -1;
      available = false;
      episodes.clear();
    },
  };
}
