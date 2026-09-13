import { immutableCopy } from './observation.mjs';
const channel = (unit, frame, scale) => ({ unit, frame, scale });
/** Versioned measurement contracts shared by authoring, training and execution. */
export const SENSOR_DEFINITIONS = immutableCopy({
  camera: {}, // Image bytes and asynchronous readiness are not numeric controller inputs.
  rotation: { angularSpeed: channel('rad/s', 'authored-axis', 20) },
  travel: { length: channel('m', 'joint-axis', 1), speed: channel('m/s', 'joint-axis', 2) },
  range: { distance: channel('m', 'sensor-ray', 4), closingSpeed: channel('m/s', 'sensor-ray', 2) },
  linearMotion: Object.fromEntries(
    ['X', 'Y', 'Z'].map((a) => ['velocity' + a, channel('m/s', 'sensor-local', 2)]),
  ),
  tilt: {
    ...Object.fromEntries(
      ['X', 'Z'].map((a) => ['tilt' + a, channel('rad', 'gravity-relative', Math.PI)]),
    ),
    ...Object.fromEntries(
      ['X', 'Y', 'Z'].map((a) => ['angularVelocity' + a, channel('rad/s', 'sensor-local', 20)]),
    ),
  },
  jointAngle: {
    angle: channel('rad', 'joint-zero', Math.PI),
    angularSpeed: channel('rad/s', 'joint-axis', 20),
  },
  contact: {
    touching: channel('boolean', 'pad-face', 1),
    normalLoad: channel('N', 'pad-face', 100),
  },
  // Historical paired-target semantics remain explicitly distinct from occluding range.
  target: {
    distance: channel('m', 'paired-centres', 4),
    speed: channel('m/s', 'paired-centres', 2),
  },
});
export const SENSOR_LIMITS = Object.freeze({ count: 64, rayTests: 8192 });
export const SENSOR_SUPPLY = Object.freeze({ resistance: 1000, minVoltage: 1 });
export const SENSOR_SCHEMA_VERSION = 1;
export const SENSOR_STATUSES = Object.freeze([
  'ok',
  'no-power',
  'no-return',
  'initializing',
  'unavailable',
  'disconnected',
]);
export function channelDefinition(kind, name) {
  const result = SENSOR_DEFINITIONS[kind ?? 'rotation']?.[name];
  if (!result) throw Error('INVALID_SENSOR_CHANNEL');
  return result;
}
export function admitSensorReading(reading, kind) {
  const definition = SENSOR_DEFINITIONS[kind ?? 'rotation'];
  if (
    !definition ||
    !reading ||
    reading.schemaVersion !== SENSOR_SCHEMA_VERSION ||
    !Number.isSafeInteger(reading.tick) ||
    reading.tick < 0 ||
    !Number.isSafeInteger(reading.node) ||
    reading.node < 0 ||
    !reading.channels ||
    Object.keys(reading.channels).sort().join() !== Object.keys(definition).sort().join()
  )
    throw Error('INVALID_SENSOR_READING');
  const keys = Object.keys(reading).sort().join();
  if (
    keys !== 'channels,node,schemaVersion,tick' &&
    keys !== 'channels,history,node,schemaVersion,tick'
  )
    throw Error('INVALID_SENSOR_READING');
  if (
    reading.history &&
    (kind !== 'range' ||
      Object.keys(reading.history).sort().join() !== 'distance,surface' ||
      !Number.isSafeInteger(reading.history.surface) ||
      reading.history.surface < 0 ||
      !Number.isFinite(reading.history.distance) ||
      reading.history.distance < 0 ||
      reading.channels.distance.status !== 'ok' ||
      reading.history.distance !== reading.channels.distance.value)
  )
    throw Error('INVALID_SENSOR_READING');
  for (const [name, sample] of Object.entries(reading.channels)) {
    if (
      !sample ||
      !SENSOR_STATUSES.includes(sample.status) ||
      Object.keys(sample).sort().join() !== (sample.status === 'ok' ? 'status,value' : 'status') ||
      (sample.status === 'ok' &&
        (!Number.isFinite(sample.value) ||
          (definition[name].unit === 'boolean' && ![0, 1].includes(sample.value))))
    )
      throw Error('INVALID_SENSOR_READING');
  }
  return immutableCopy(reading);
}
