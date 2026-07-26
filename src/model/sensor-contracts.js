export const SENSOR_PART_DEFINITIONS = Object.freeze({
  receiver: [{ key: "command", label: "Remote command", unit: "scalar" }],
  navsensor: [
    { key: "altitude", label: "Altitude", unit: "m" },
    { key: "speed", label: "Ground speed", unit: "m/s" },
    { key: "position_x", label: "Position X", unit: "m" },
    { key: "position_z", label: "Position Z", unit: "m" },
    { key: "velocity_x", label: "Velocity X", unit: "m/s" },
    { key: "velocity_z", label: "Velocity Z", unit: "m/s" },
    { key: "wind_x", label: "Wind X", unit: "m/s" },
    { key: "wind_z", label: "Wind Z", unit: "m/s" },
  ],
  rangesensor: [
    { key: "proximity_detected", label: "Body detected", unit: "bool" },
    { key: "proximity_range_m", label: "Surface range", unit: "m" },
    {
      key: "proximity_range_rate_mps",
      label: "Range rate",
      unit: "m/s",
    },
    {
      key: "proximity_relative_velocity_x",
      label: "Relative velocity X",
      unit: "m/s",
    },
    {
      key: "proximity_relative_velocity_y",
      label: "Relative velocity Y",
      unit: "m/s",
    },
    {
      key: "proximity_relative_velocity_z",
      label: "Relative velocity Z",
      unit: "m/s",
    },
  ],
  sensor: [{ key: "rotation_rpm", label: "Shaft rotation", unit: "rpm" }],
  imu: [
    { key: "imu_roll_deg", label: "Roll", unit: "deg" },
    { key: "imu_pitch_deg", label: "Pitch", unit: "deg" },
    { key: "imu_yaw_deg", label: "Yaw", unit: "deg" },
    { key: "imu_rate_x", label: "Angular rate X", unit: "rad/s" },
    { key: "imu_rate_y", label: "Angular rate Y", unit: "rad/s" },
    { key: "imu_rate_z", label: "Angular rate Z", unit: "rad/s" },
    { key: "imu_accel_x", label: "Acceleration X", unit: "m/s²" },
    { key: "imu_accel_y", label: "Acceleration Y", unit: "m/s²" },
    { key: "imu_accel_z", label: "Acceleration Z", unit: "m/s²" },
  ],
  contactsensor: [
    { key: "contact", label: "Contact state", unit: "bool" },
    { key: "contact_force_n", label: "Contact force", unit: "N" },
    { key: "water_contact", label: "Water contact", unit: "bool" },
  ],
  thermalprobe: [
    { key: "temperature_c", label: "Temperature", unit: "°C" },
    { key: "heat_flux_kw_m2", label: "Heat flux", unit: "kW/m²" },
  ],
  pressureprobe: [
    { key: "static_pressure_pa", label: "Static pressure", unit: "Pa" },
    { key: "dynamic_pressure_pa", label: "Dynamic pressure", unit: "Pa" },
    { key: "air_density", label: "Air density", unit: "kg/m³" },
  ],
  tirepressureprobe: [
    {
      key: "tire_pressure_absolute_pa",
      label: "Tire absolute pressure",
      unit: "Pa",
    },
    {
      key: "tire_pressure_gauge_pa",
      label: "Tire gauge pressure",
      unit: "Pa",
    },
    {
      key: "tire_gas_temperature_k",
      label: "Tire gas temperature",
      unit: "K",
    },
  ],
  loadcell: [
    { key: "load_n", label: "Attachment load", unit: "N" },
    { key: "load_ratio", label: "Rated-load ratio", unit: "ratio" },
  ],
});

export function isSensorPart(part) {
  return Boolean(SENSOR_PART_DEFINITIONS[part?.type]);
}

export function sensorDefinitionsForPart(part) {
  return SENSOR_PART_DEFINITIONS[part?.type] || null;
}
