import {
  SENSOR_DEFINITIONS,
  SENSOR_SCHEMA_VERSION,
  admitSensorReading,
} from '../model/sensors.mjs';
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
export const rotateSensor = (q, v) => {
  const t = cross(q.slice(0, 3), v).map((x) => 2 * x);
  return add(
    v,
    add(
      t.map((x) => x * q[3]),
      cross(q.slice(0, 3), t),
    ),
  );
};
const inverse = (q) => [-q[0], -q[1], -q[2], q[3]];
/** This sampling owner may read physics. Policies receive only connected channel records. */
export function sampleSensor(sensor, context) {
  const { tick, dt, bodies, gravity, powered, previous } = context,
    kind = sensor.kind ?? 'rotation',
    definition = SENSOR_DEFINITIONS[kind];
  if (!definition || !Number.isFinite(dt) || dt <= 0) throw Error('INVALID_SENSOR_CONFIGURATION');
  const result = {
    node: sensor.node,
    schemaVersion: SENSOR_SCHEMA_VERSION,
    tick,
    channels: Object.fromEntries(
      Object.keys(definition).map((k) => [k, { status: powered ? 'unavailable' : 'no-power' }]),
    ),
  };
  const set = (name, value) => {
    if (Number.isFinite(value))
      result.channels[name] = { status: 'ok', value: value === 0 ? 0 : value };
  };
  if (!powered) return admitSensorReading(result, kind);
  const body = bodies[sensor.body ?? sensor.node];
  if (!body) return admitSensorReading(result, kind);
  const q = body.rotation,
    local = (v) => rotateSensor(inverse(q), v);
  if (kind === 'rotation') set('angularSpeed', dot(local(body.angularVelocity), sensor.axis));
  if (kind === 'linearMotion') {
    const velocity = local(
      context.pointVelocity
        ? context.pointVelocity({ body: sensor.body, origin: sensor.origin ?? [0, 0, 0] })
        : add(
            body.velocity,
            cross(body.angularVelocity, rotateSensor(q, sensor.origin ?? [0, 0, 0])),
          ),
    );
    ['X', 'Y', 'Z'].forEach((a, i) => set('velocity' + a, velocity[i]));
  }
  if (kind === 'tilt') {
    const g = local(gravity),
      w = local(body.angularVelocity);
    if (Math.hypot(...g) > 1e-12) {
      if (Math.hypot(g[2], g[1]) > 1e-12) set('tiltX', Math.atan2(-g[2], -g[1]));
      if (Math.hypot(g[0], g[1]) > 1e-12) set('tiltZ', Math.atan2(g[0], -g[1]));
    }
    ['X', 'Y', 'Z'].forEach((a, i) => set('angularVelocity' + a, w[i]));
  }
  if (kind === 'jointAngle' && sensor.joint >= 0) {
    const joint = context.joint(sensor.joint);
    const relative = (joint.angle - (sensor.zero ?? 0)) * (sensor.sign ?? 1);
    set('angle', Math.atan2(Math.sin(relative), Math.cos(relative)));
    set('angularSpeed', joint.speed * (sensor.sign ?? 1));
  }
  if (kind === 'travel') {
    const joint = context.joints?.[sensor.joint];
    if (joint) {
      const a = bodies[joint.a],
        b = bodies[joint.b],
        ra = rotateSensor(a.rotation, joint.anchorA),
        rb = rotateSensor(b.rotation, joint.anchorB),
        axis = rotateSensor(a.rotation, joint.axisA),
        gap = sub(add(b.position, rb), add(a.position, ra));
      const length = dot(gap, axis),
        speed =
          dot(gap, cross(a.angularVelocity, axis)) +
          dot(
            axis,
            sub(
              add(b.velocity, cross(b.angularVelocity, rb)),
              add(a.velocity, cross(a.angularVelocity, ra)),
            ),
          );
      if (length >= 0) {
        set('length', length);
        set('speed', speed);
      }
    }
  }
  if (kind === 'range') {
    const origin = add(body.position, rotateSensor(q, sensor.origin ?? [0, 0, 0])),
      axis = rotateSensor(q, sensor.axis),
      hit = context.ray({ body: sensor.body, origin, axis, range: sensor.range });
    result.channels.distance = { status: 'no-return' };
    result.channels.closingSpeed = { status: 'initializing' };
    if (hit && hit.distance >= 0 && hit.distance <= sensor.range) {
      set('distance', hit.distance);
      // Surface identity is checkpoint history only, never a policy channel.
      result.history = { surface: hit.surface, distance: hit.distance };
      if (
        previous?.tick === tick - 1 &&
        previous.history?.surface === hit.surface &&
        previous.channels.distance.status === 'ok'
      )
        set('closingSpeed', (previous.history.distance - hit.distance) / dt);
    }
  }
  if (kind === 'contact') {
    const c = context.contact(sensor);
    if (c.available !== false) {
      set('touching', c.touching ? 1 : 0);
      set('normalLoad', c.normalImpulse / dt);
    }
  }
  if (kind === 'target') {
    const target = bodies[sensor.target];
    if (target) {
      const delta = sub(target.position, body.position),
        distance = Math.hypot(...delta);
      if (distance <= sensor.range) {
        set('distance', distance);
        set(
          'speed',
          distance > 1e-12 ? dot(delta, sub(body.velocity, target.velocity)) / distance : 0,
        );
      }
    }
  }
  return admitSensorReading(result, kind);
}
