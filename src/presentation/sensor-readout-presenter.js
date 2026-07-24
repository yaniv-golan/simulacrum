/** Creates the selected rotation-sensor readout projection. */
export function createSensorReadoutPresenter(model, view) {
  return function presentSensorReadout() {
    const sensor = model
        .parts()
        .find(
          (part) => part.id === model.selectedId() && part.type === "sensor",
        ),
      readout = view.query("#sensor-live-rpm");
    if (sensor && readout)
      readout.textContent = `MEASURED SHAFT SPEED · ${(sensor.sensorValueRpm || 0).toFixed(1)} RPM`;
  };
}
