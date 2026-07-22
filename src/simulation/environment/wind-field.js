import { standardAtmosphere } from "./atmosphere.js";

const smoothstep = (minimum, maximum, value) => {
  const x = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return x * x * (3 - 2 * x);
};

/**
 * Deterministic Earth-like wind field in SI units.
 *
 * The field combines a logarithmic surface boundary layer, Northern Hemisphere
 * Ekman veering, a 10.5 km jet stream, and density-scaled spatial turbulence.
 * It is engine-neutral so every physical runtime and telemetry client samples
 * the same atmosphere rather than maintaining demo-specific wind formulas.
 */
export function sampleWindVelocity(
  position,
  { enabled = true, elapsedSeconds = 0 } = {},
) {
  if (!enabled) return { x: 0, y: 0, z: 0 };
  const altitude = Math.max(0, Number(position?.y) || 0),
    x = Number(position?.x) || 0,
    z = Number(position?.z) || 0,
    roughnessLengthM = 0.12,
    vonKarman = 0.41,
    frictionVelocity = 0.34,
    boundarySpeed =
      altitude < 1800
        ? (frictionVelocity / vonKarman) *
          Math.log(
            (Math.max(2, altitude) + roughnessLengthM) / roughnessLengthM,
          )
        : 7.8,
    veer = smoothstep(0, 2200, altitude),
    direction = (1 - veer) * ((28 * Math.PI) / 180),
    jetSpeed = 31 * Math.exp(-0.5 * Math.pow((altitude - 10500) / 2600, 2)),
    backgroundSpeed = boundarySpeed + jetSpeed,
    densityRatio = standardAtmosphere(altitude).density / 1.225,
    turbulenceAmplitude =
      1.65 * Math.sqrt(Math.max(0, densityRatio)) * Math.exp(-altitude / 6500),
    phaseX = x * 0.0017 + elapsedSeconds * 0.31,
    phaseZ = z * 0.0013 - elapsedSeconds * 0.23,
    gustX =
      turbulenceAmplitude *
      (0.62 * Math.sin(phaseZ) + 0.38 * Math.sin(phaseX * 0.47 + 1.8)),
    gustZ =
      turbulenceAmplitude *
      (0.58 * Math.cos(phaseX) - 0.42 * Math.cos(phaseZ * 0.53 - 0.9)),
    vertical =
      turbulenceAmplitude * 0.08 * Math.sin(phaseX * 0.7 + phaseZ * 0.9);
  return {
    x: Math.cos(direction) * backgroundSpeed + gustX,
    y: vertical,
    z: Math.sin(direction) * backgroundSpeed + gustZ,
  };
}
