/** Browser evidence for continued rolling, including curved paths; not Course advance. */
export function finalRollingIntervals(samples) {
  if (samples.length !== 11) throw Error('rolling sampling coverage requires eleven frames');
  return samples.slice(1).map((sample, i) => {
    const previous = samples[i],
      gap = sample.tick - previous.tick;
    if (gap < 90 || gap > 150) throw Error(`rolling sampling coverage gap: ${gap} ticks`);
    const a = previous.physics[0].position,
      b = sample.physics[0].position;
    const distance = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (!(distance > 0.5)) throw Error(`rolling movement stopped: ${distance}m in ${gap} ticks`);
    return distance;
  });
}
