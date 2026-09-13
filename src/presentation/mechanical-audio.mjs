import { AUDIO_POLICY, spatialMix, selectVoices } from './mechanical-audio-model.mjs';
import { impactTone } from './impact-sound.mjs';

/** One lazy context. Numeric acoustic packets are the only machine input. */
export function createMechanicalAudio({
  createContext = () => {
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    return Audio ? new Audio() : null;
  },
  changed = () => {},
  wallTime = () => performance.now(),
  activationTimeoutMs = 1500,
} = {}) {
  let context,
    master,
    compressor,
    ceiling,
    noise,
    enabled = false,
    disposed = false,
    generation = 0,
    volume = 0.35,
    lastWall = null,
    starts = 0,
    problem = null;
  const drives = new Map(),
    contacts = new Map(),
    impacts = new Map();
  const groups = [drives, contacts, impacts];
  const state = () => ({
    enabled,
    volume,
    state: context?.state ?? 'unavailable',
    drives: drives.size,
    contacts: contacts.size,
    impacts: impacts.size,
    starts,
    problem,
  });
  function silence() {
    for (const group of groups) for (const voice of group.values()) release(voice);
    lastWall = null;
  }
  function contextChanged() {
    if (context.state !== 'running') {
      silence();
      if (enabled) {
        enabled = false;
        generation++;
        changed(state());
      }
    }
  }
  function graph() {
    if (master) return;
    master = context.createGain();
    master.gain.value = volume;
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 4;
    ceiling = context.createWaveShaper();
    ceiling.curve = Float32Array.from(
      { length: 4097 },
      (_, i) => 0.9 * Math.tanh(2 * ((i / 4096) * 2 - 1)),
    );
    master.connect(compressor);
    compressor.connect(ceiling);
    ceiling.connect(context.destination);
    noise = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 0x51a7;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed / 2147483648 - 1;
    }
  }
  function ramp(param, value, at = context.currentTime, duration = 0.05) {
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
    param.linearRampToValueAtTime(value, at + duration);
  }
  function release(voice) {
    if (voice.releasing) return;
    voice.releasing = true;
    const now = context.currentTime;
    ramp(voice.bus.gain, 0, now, AUDIO_POLICY.release);
    for (const source of voice.sources)
      try {
        source.stop(now + AUDIO_POLICY.release);
      } catch {}
  }
  function makeVoice(group, key, at) {
    const bus = context.createGain(),
      pan = context.createStereoPanner();
    bus.gain.value = 0;
    bus.connect(pan);
    pan.connect(master);
    const voice = { key, bus, pan, sources: [], nodes: [bus, pan], releasing: false };
    group.set(key, voice);
    voice.cleanup = () => {
      if (group.get(voice.key) === voice) group.delete(voice.key);
      for (const n of voice.nodes) n.disconnect();
    };
    return voice;
  }
  function layer(voice, type, frequency, at) {
    const source = type === 'noise' ? context.createBufferSource() : context.createOscillator();
    if (type === 'noise') {
      source.buffer = noise;
      source.loop = true;
    } else {
      source.type = type;
      source.frequency.value = frequency;
    }
    voice.nodes.push(source);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.5;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(voice.bus);
    voice.sources.push(source);
    voice.nodes.push(filter, gain);
    source.onended = () => {
      voice.ended = (voice.ended ?? 0) + 1;
      if (voice.ended === voice.sources.length) voice.cleanup();
    };
    source.start(at);
    return { source, filter, gain };
  }
  function updateContinuous(group, rows, limit, listener, kind) {
    const candidates = rows.map((row) => {
      const mix = spatialMix(row.position, listener);
      return {
        ...row,
        mix,
        score:
          mix.gain *
          (kind === 'drive' ? row.motionGain + row.loadGain : row.rollGain + row.scrapeGain),
      };
    });
    const selected = selectVoices(
        candidates,
        new Set([...group].filter(([, v]) => !v.releasing).map(([k]) => k)),
        limit,
      ),
      keys = new Set(selected.map((r) => r.key));
    const spare = [...group].filter(([key, voice]) => !keys.has(key) && !voice.releasing);
    for (const row of selected) {
      let voice = group.get(row.key);
      if (voice?.releasing) continue;
      const now = context.currentTime;
      if (!voice && spare.length) {
        const [oldKey, reused] = spare.shift();
        group.delete(oldKey);
        voice = reused;
        voice.key = row.key;
        group.set(row.key, voice);
      }
      if (!voice) {
        if (group.size >= limit) continue;
        voice = makeVoice(group, row.key, now);
        voice.motion = layer(voice, kind === 'drive' ? 'triangle' : 'noise', row.frequency, now);
        if (kind === 'drive') voice.travel = layer(voice, 'noise', row.frequency, now);
        voice.texture = layer(voice, 'noise', kind === 'drive' ? 280 : 100, now);
      }
      const motion = kind === 'drive' ? row.motionGain : row.scrapeGain,
        texture = kind === 'drive' ? row.loadGain : row.rollGain;
      ramp(voice.bus.gain, row.mix.gain, now, 0.03);
      ramp(voice.pan.pan, row.mix.pan);
      ramp(
        voice.motion.gain.gain,
        kind === 'drive' && row.wave === 'noise' ? 0 : motion,
        now,
        0.03,
      );
      if (voice.travel) {
        ramp(voice.travel.gain.gain, row.wave === 'noise' ? motion : 0, now, 0.03);
        ramp(voice.travel.filter.frequency, row.frequency * 2);
      }
      ramp(voice.texture.gain.gain, texture, now, 0.03);
      if (voice.motion.source.frequency) ramp(voice.motion.source.frequency, row.frequency);
      ramp(voice.motion.filter.frequency, row.frequency * 2);
    }
    for (const [, voice] of spare) release(voice);
  }
  return {
    enabled: () => enabled,
    read: state,
    async enable(value) {
      const request = ++generation;
      if (disposed) return false;
      if (!value) {
        enabled = false;
        silence();
        changed(state());
        return false;
      }
      problem = null;
      try {
        if (!context) {
          context = createContext();
          context?.addEventListener?.('statechange', contextChanged);
        }
        if (!context) throw Error('Audio unavailable');
        let timer;
        try {
          await Promise.race([
            context.resume(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(Error('Audio activation unavailable')),
                activationTimeoutMs,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        if (request !== generation || disposed) return false;
        enabled = context.state === 'running';
      } catch {
        if (request !== generation || disposed) return false;
        enabled = false;
      }
      changed(state());
      return enabled;
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      if (master) {
        master.gain.cancelScheduledValues(context.currentTime);
        master.gain.setValueAtTime(volume, context.currentTime);
      }
      if (volume === 0) silence();
      changed(state());
    },
    play(batch, listener = null) {
      if (!enabled || disposed || context?.state !== 'running') return;
      const nowWall = wallTime(),
        stalled = lastWall !== null && nowWall - lastWall > 100;
      lastWall = nowWall;
      if (volume === 0) return;
      try {
        graph();
        updateContinuous(drives, batch.drives ?? [], AUDIO_POLICY.motorVoices, listener, 'drive');
        updateContinuous(
          contacts,
          batch.contacts ?? [],
          AUDIO_POLICY.contactVoices,
          listener,
          'contact',
        );
        const latest = batch.tick,
          interval = batch.interval;
        const events = stalled
          ? []
          : (batch.impacts ?? [])
              .filter(
                (e) =>
                  Number.isFinite(e.impulse) &&
                  e.impulse > 0.01 &&
                  Number.isFinite(latest) &&
                  Number.isFinite(e.tick) &&
                  interval > 0 &&
                  (latest - e.tick) * interval <= AUDIO_POLICY.maxAge &&
                  e.tick <= latest,
              )
              .map((e) => ({ ...e, mix: spatialMix(e.position, listener) }))
              .sort(
                (a, b) => b.mix.gain * Math.log1p(b.impulse) - a.mix.gain * Math.log1p(a.impulse),
              )
              .slice(0, AUDIO_POLICY.impactsPerFrame);
        for (const event of events) {
          if (impacts.size >= AUDIO_POLICY.impactVoices) break;
          const at =
              context.currentTime +
              Math.max(0, AUDIO_POLICY.horizon - (latest - event.tick) * interval),
            tone = impactTone(event.materials);
          const voice = makeVoice(impacts, ++starts, at),
            gain = Math.min(0.04, 0.008 * Math.log1p(event.impulse)) * event.mix.gain;
          voice.pan.pan.value = event.mix.pan;
          voice.bus.gain.setValueAtTime(gain, at);
          voice.bus.gain.exponentialRampToValueAtTime(0.00001, at + 0.12);
          const resonant = layer(voice, tone.type, tone.frequency, at),
            attack = layer(voice, 'noise', tone.frequency * 2, at);
          resonant.gain.gain.setValueAtTime(0.8, at);
          attack.gain.gain.setValueAtTime(0.2, at);
          attack.gain.gain.linearRampToValueAtTime(0, at + 0.025);
          resonant.source.frequency.exponentialRampToValueAtTime(tone.frequency * 0.5, at + 0.12);
          for (const source of voice.sources) source.stop(at + 0.13);
        }
      } catch {
        enabled = false;
        generation++;
        problem = 'Sound unavailable. Try Sound on.';
        for (const group of groups) {
          for (const voice of group.values()) {
            for (const source of voice.sources)
              try {
                source.stop();
              } catch {}
            voice.cleanup();
          }
          group.clear();
        }
        master?.disconnect();
        compressor?.disconnect();
        ceiling?.disconnect();
        master = compressor = ceiling = noise = undefined;
        changed(state());
      }
    },
    stop: silence,
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      generation++;
      silence();
      context?.removeEventListener?.('statechange', contextChanged);
      for (const group of groups) {
        for (const voice of group.values()) voice.cleanup();
        group.clear();
      }
      master?.disconnect();
      compressor?.disconnect();
      ceiling?.disconnect();
      void context?.close();
      changed(state());
    },
  };
}
