const STEFAN_BOLTZMANN = 5.670374419e-8;

export function createThermalState(material, mass, temperatureK = 288.15) {
  return {
    ...material,
    temperatureK,
    heatFlux: 0,
    heatLoadMJ: 0,
    health: 1,
    initialMass: mass,
    remainingMass: mass,
    ablatedMass: 0,
    consumed: false,
  };
}

export function thermalMass(state) {
  return Math.max(0.001, state.remainingMass);
}

/**
 * Integrates material heating and ablation from energy conservation. The
 * caller supplies the incident flux calculated by the aerodynamic system;
 * this function owns only material response and emits presentation-neutral
 * state.
 */
export function advanceThermalState(
  state,
  {
    dt,
    incidentHeatFlux,
    directHeatPowerW = 0,
    surfaceArea,
    atmosphereTemperatureK,
    absorption = 0.5,
  },
) {
  const area = Math.max(0.001, surfaceArea),
    radiativeCooling =
      state.emissivity *
      STEFAN_BOLTZMANN *
      area *
      (state.temperatureK ** 4 - atmosphereTemperatureK ** 4),
    heatPower =
      incidentHeatFlux * area * absorption +
      Math.max(0, directHeatPowerW) -
      radiativeCooling;

  state.heatFlux = incidentHeatFlux;
  state.heatLoadMJ += (Math.max(0, heatPower) * dt) / 1e6;
  let thermalEnergy = heatPower * dt,
    mass = thermalMass(state);

  if (state.ablative && thermalEnergy > 0) {
    const sensibleEnergy = Math.max(
        0,
        mass *
          state.specificHeat *
          (state.pyrolysisTemperatureK - state.temperatureK),
      ),
      absorbedSensible = Math.min(thermalEnergy, sensibleEnergy);
    state.temperatureK +=
      absorbedSensible / Math.max(1, mass * state.specificHeat);
    thermalEnergy -= absorbedSensible;
    if (
      thermalEnergy > 0 &&
      state.temperatureK >= state.pyrolysisTemperatureK
    ) {
      const ablatedMass = Math.min(
        state.remainingMass,
        thermalEnergy / state.heatOfAblationJkg,
      );
      state.remainingMass -= ablatedMass;
      state.ablatedMass += ablatedMass;
    }
  } else {
    state.temperatureK +=
      thermalEnergy / Math.max(1, mass * state.specificHeat);
  }

  state.temperatureK = Math.max(atmosphereTemperatureK, state.temperatureK);
  const temperatureC = state.temperatureK - 273.15;
  state.health = Math.max(
    0,
    Math.min(
      1,
      1 - Math.max(0, temperatureC - 80) / Math.max(1, state.heatLimit - 80),
    ),
  );
  state.consumed = Boolean(
    state.ablative && state.remainingMass / state.initialMass <= 0.01,
  );

  return {
    heatPower,
    temperatureC,
    remainingFraction: Math.max(
      0,
      Math.min(1, state.remainingMass / state.initialMass),
    ),
    consumed: state.consumed,
    exceededLimit: !state.ablative && temperatureC >= state.heatLimit,
  };
}
