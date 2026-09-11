/** Consumes completed contact samples only; silent baseline after gaps/resets. */
export function createImpactEvents() {
  let epoch,
    tick = -1,
    previous = new Set(),
    available = false;
  return {
    read(sample) {
      if (epoch === sample.epoch && sample.tick <= tick) return [];
      const continuous =
        available && sample.available && epoch === sample.epoch && sample.tick === tick + 1;
      available = sample.available;
      epoch = sample.epoch;
      tick = sample.tick;
      const pairs = new Map();
      if (sample.available)
        for (const row of sample.rows) {
          if (!row.available || !row.solved || !row.normalImpulse) continue;
          const key = `${row.a}:${row.b}`;
          pairs.set(key, {
            a: row.a,
            b: row.b,
            impulse: (pairs.get(key)?.impulse ?? 0) + Math.hypot(...row.normalImpulse),
          });
        }
      if (!continuous) previous.clear();
      const events = continuous
        ? [...pairs]
            .filter(([key, row]) => !previous.has(key) && row.impulse > 0.01)
            .map(([, row]) => row)
        : [];
      previous = new Set(
        [...pairs]
          .filter(([key, row]) => previous.has(key) || row.impulse > 0.01)
          .map(([key]) => key),
      );
      return events.sort((a, b) => b.impulse - a.impulse).slice(0, 4);
    },
    reset() {
      epoch = undefined;
      tick = -1;
      previous.clear();
    },
  };
}

/** Illustrative material timbres, bounded independently of the simulation. */
export function createImpactSound() {
  let context,
    enabled = false,
    disposed = false;
  const voices = new Map();
  function stop() {
    for (const [voice, gain] of voices) {
      try {
        voice.stop();
      } catch {}
      voice.disconnect();
      gain.disconnect();
    }
    voices.clear();
  }
  return {
    enabled: () => enabled,
    async enable(value) {
      if (disposed) return false;
      enabled = value;
      if (!value) {
        stop();
        return false;
      }
      try {
        const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Audio) {
          enabled = false;
          return false;
        }
        context ??= new Audio();
        await context.resume();
        enabled = enabled && !disposed && context.state === 'running';
        return enabled;
      } catch {
        enabled = false;
        return false;
      }
    },
    play(events) {
      if (!enabled || context?.state !== 'running') return;
      for (const event of events) {
        if (voices.size >= 8) break;
        const oscillator = context.createOscillator(),
          gain = context.createGain(),
          now = context.currentTime;
        const tone = impactTone(event.materials);
        oscillator.type = tone.type;
        oscillator.frequency.setValueAtTime(tone.frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(90, now + 0.09);
        gain.gain.setValueAtTime(Math.min(0.12, 0.025 * Math.log1p(event.impulse)), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        oscillator.connect(gain);
        gain.connect(context.destination);
        voices.set(oscillator, gain);
        oscillator.onended = () => {
          voices.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(now);
        oscillator.stop(now + 0.13);
      }
    },
    stop,
    dispose() {
      disposed = true;
      enabled = false;
      stop();
      void context?.close();
    },
  };
}

/** Symmetric illustrative timbre: contact order and blueprint order have no voice. */
export function impactTone(materials = []) {
  const values = materials.length ? materials : ['surface'];
  const frequencies = values.map(
    (material) => ({ steel: 1100, aluminium: 750, rubber: 170 })[material] ?? 350,
  );
  return {
    type: values.includes('rubber') ? 'sine' : 'triangle',
    frequency: Math.exp(
      frequencies.reduce((sum, value) => sum + Math.log(value), 0) / frequencies.length,
    ),
  };
}
