/** Adapts application environment state to the presentation control contract. */
export function createEnvironmentPresentationModel(state, windAt) {
  return {
    get timeOfDay() {
      return state.timeOfDay;
    },
    set timeOfDay(value) {
      state.timeOfDay = value;
    },
    get windEnabled() {
      return state.windEnabled;
    },
    set windEnabled(value) {
      state.windEnabled = value;
    },
    get spaceBlend() {
      return state.spaceBlend;
    },
    set spaceBlend(value) {
      state.spaceBlend = value;
    },
    get sunElevationDeg() {
      return state.sunElevationDeg;
    },
    set sunElevationDeg(value) {
      state.sunElevationDeg = value;
    },
    windAt,
  };
}
