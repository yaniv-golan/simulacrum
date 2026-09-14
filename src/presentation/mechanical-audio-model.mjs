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
  // Level policy. One nominal voice — a motor at 20 rad/s, an actuator at 0.08 m/s, a sliding
  // contact under full load — renders at this RMS on the master bus at unit spatial gain; the
  // output chain adds about +5 dB (0.9·tanh(2x)). Every layer gain below is derived from it
  // and from what the layer's waveform and lowpass leave, so the families come out at the
  // registered level instead of at whatever a raw gain literal happens to render.
  nominalRms: 0.06,
  // Every voice lowpass runs at this Q (Web Audio's dB-valued Q); the RMS factors derive from it.
  filterQDb: 0.5,
  // The noise buffer is generated at this rate so its bandwidth is the same on any device.
  noiseSampleRate: 48000,
  noiseNyquistHz: 24000,
  // Rotation lowpass sits at four times the fundamental so the harmonics that carry a motor's
  // pitch on small speakers survive; the drive floor keeps a slow motor above the speaker roll-off.
  driveCutoffRatio: 4,
  driveTextureCutoffHz: 280,
  contactTextureCutoffHz: 400,
  // Impact gain per log-impulse and its cap; held at four times the original gain until the
  // rolling episode classifier is judged (a rolling wheel renews patches ~40 times a second).
  impactGainPerLogImpulse: 0.032,
  impactGainCap: 0.16,
});
const finite = Number.isFinite;
const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const filterQ = () => 10 ** (AUDIO_POLICY.filterQDb / 20);
/** Magnitude of a second-order lowpass at `ratio` = f / fc. */
export function lowpassMagnitude(ratio, q = filterQ()) {
  return 1 / Math.hypot(1 - ratio * ratio, ratio / q);
}
/** RMS a unit triangle leaves through a lowpass at `cutoffRatio` times its fundamental: odd
 * harmonics of amplitude 8/(π²n²), each RMS 1/√2 of that, through the filter's response. */
export function triangleRms(cutoffRatio, harmonics = 64) {
  let sum = 0;
  for (let n = 1; n < 2 * harmonics; n += 2) {
    const amplitude = (8 / (Math.PI * Math.PI) / (n * n)) * lowpassMagnitude(n / cutoffRatio);
    sum += (amplitude * amplitude) / 2;
  }
  return Math.sqrt(sum);
}
export const TRIANGLE_RMS = triangleRms(AUDIO_POLICY.driveCutoffRatio);
/** RMS uniform noise (1/√3) leaves through a second-order lowpass whose noise-equivalent
 * bandwidth is (π/2)·Q·fc, against the noise buffer's Nyquist. */
export function noiseRms(cutoffHz, nyquistHz = AUDIO_POLICY.noiseNyquistHz) {
  return Math.sqrt(1 / 3) * Math.sqrt(clamp(((Math.PI / 2) * filterQ() * cutoffHz) / nyquistHz));
}
/** The gain that renders `weight` × the nominal level for a layer with the given RMS factor. */
export function layerGain(weight, rmsFactor) {
  return (AUDIO_POLICY.nominalRms * clamp(weight)) / rmsFactor;
}
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
    load = clamp(Math.abs(row.currentA) / row.currentScaleA),
    frequency = rotation ? clamp(110 + rate * 4, 110, 2400) : clamp(160 + rate * 350, 160, 700);
  return {
    ...row,
    key: `drive:${row.emitterKey}`,
    wave: rotation ? 'triangle' : 'noise',
    frequency,
    // Rendered level of the voice in nominal units; voice selection ranks by this, never by
    // the raw gains, which differ per waveform.
    level: clamp(rate / (rotation ? 20 : 0.08)) + 0.5 * load,
    motionGain: rotation
      ? layerGain(clamp(rate / 20), TRIANGLE_RMS)
      : layerGain(clamp(rate / 0.08), noiseRms(frequency * 2)),
    // A straining motor's texture at half the level of its motion.
    loadGain: layerGain(0.5 * load, noiseRms(AUDIO_POLICY.driveTextureCutoffHz)),
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
  const blend = 1 - clamp(slip / Math.max(0.01, roll)),
    frequency = 180 + Math.min(1200, slip * 300),
    scrape = row.frictionEligibility === 'positive' && slip > 0.01 ? load * clamp(slip) : 0,
    // Rolling texture at seven tenths of a scrape: present, never the loudest thing.
    rolling = row.geometryClass === 'curved' && roll > 0.01 ? 0.7 * load * blend * clamp(roll) : 0;
  return {
    ...row,
    key: `contact:${row.pairKey}`,
    frequency,
    level: scrape + rolling,
    scrapeGain: layerGain(scrape, noiseRms(frequency * 2)),
    rollGain: layerGain(rolling, noiseRms(AUDIO_POLICY.contactTextureCutoffHz)),
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
