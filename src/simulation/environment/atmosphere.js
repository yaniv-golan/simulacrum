const STANDARD_ATMOSPHERE_LAYERS = [
  [11000, -0.0065],
  [20000, 0],
  [32000, 0.001],
  [47000, 0.0028],
  [51000, 0],
  [71000, -0.0028],
  [84852, -0.002],
  [120000, 0],
];

export function standardAtmosphere(altitudeM) {
  const gasConstant = 287.05287,
    gamma = 1.4,
    gravity = 9.80665;
  let pressure = 101325,
    temperature = 288.15,
    baseAltitude = 0;
  const target = Math.max(0, altitudeM);
  for (const [topAltitude, lapseRate] of STANDARD_ATMOSPHERE_LAYERS) {
    const layerTop = Math.min(target, topAltitude),
      height = layerTop - baseAltitude;
    if (height > 0) {
      if (Math.abs(lapseRate) < 1e-12)
        pressure *= Math.exp((-gravity * height) / (gasConstant * temperature));
      else {
        const nextTemperature = temperature + lapseRate * height;
        pressure *= Math.pow(
          nextTemperature / temperature,
          -gravity / (gasConstant * lapseRate),
        );
        temperature = nextTemperature;
      }
    }
    baseAltitude = layerTop;
    if (target <= topAltitude) break;
  }
  const density = pressure / (gasConstant * temperature);
  return {
    temperature,
    pressure,
    density,
    speedOfSound: Math.sqrt(gamma * gasConstant * temperature),
  };
}

export function projectedBoxArea(size, direction) {
  return (
    Math.abs(direction.x) * size.y * size.z +
    Math.abs(direction.y) * size.x * size.z +
    Math.abs(direction.z) * size.x * size.y
  );
}
