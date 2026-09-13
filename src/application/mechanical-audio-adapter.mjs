import { compileAssembly } from '../model/assembly.mjs';
import { MATERIALS } from '../model/catalog.mjs';
import { motorShaftSpeed } from '../model/motor-shaft-speed.mjs';
import { rotateVector } from '../model/transforms.mjs';
import {
  completedPoint,
  createCompletedPointReader,
  linearCoordinateSpeed,
  finiteVector,
  validMotion,
  subtract,
  dot,
  cross,
} from '../model/completed-motion.mjs';

/** Both witnesses, both completed bodies; geometry admission is canonical primitive data. */
export function contactMotion(a, b, row, shapeA, shapeB, readPoint = completedPoint) {
  if (!finiteVector(row.normal) || Math.abs(Math.hypot(...row.normal) - 1) > 1e-5) return null;
  const A = readPoint(a, row.localPointA),
    B = readPoint(b, row.localPointB);
  if (!A || !B) return null;
  const relative = subtract(A.velocity, B.velocity),
    normalSpeed = dot(relative, row.normal);
  const slipSpeedMS = Math.hypot(...relative.map((v, i) => v - normalSpeed * row.normal[i]));
  const omega = subtract(a.angularVelocity, b.angularVelocity);
  const rates = [
    [shapeA, a],
    [shapeB, b],
  ].flatMap(([shape, body]) => {
    if (!shape || shape.collision === false || !finiteVector(shape.halfExtents)) return [];
    if (shape.shape === 'sphere')
      return [Math.hypot(...cross(omega, row.normal)) * shape.halfExtents[0]];
    if (shape.shape !== 'cylinder') return [];
    const axis = readPoint.axis?.(body) ?? rotateVector(body.rotation, [1, 0, 0]);
    if (Math.abs(dot(axis, row.normal)) > 0.5) return [];
    return [Math.abs(dot(omega, axis)) * shape.halfExtents[1]];
  });
  return {
    position: A.position.map((v, i) => (v + B.position[i]) / 2),
    slipSpeedMS,
    rollingSpeedMS: rates.length ? Math.max(...rates) : null,
  };
}

/** Cache canonical compilation per workshop epoch; no live physics and no publication changes.
 * Workshop core always compiles with BUILD_ENVIRONMENT. Custom session configurations are
 * not this adapter's input; unrecognized body provenance cannot invent contact texture.
 */
export function createMechanicalAudioAdapter() {
  let epoch,
    compiled = null,
    previousTick = -1;
  const witnesses = new Map();
  const materials = Object.fromEntries(
    Object.entries(MATERIALS).map(([key, value]) => [value.handle, key]),
  );
  return {
    read(frame, nextEpoch) {
      if (epoch !== nextEpoch || frame.tick !== previousTick + 1) witnesses.clear();
      previousTick = frame.tick;
      if (epoch !== nextEpoch || !compiled) {
        epoch = nextEpoch;
        try {
          compiled = compileAssembly(frame.metadata.blueprint);
        } catch {
          compiled = null;
        }
      }
      const packet = {
        epoch: nextEpoch,
        tick: frame.tick,
        interval: frame.contacts?.intervalSeconds,
        available: !!compiled && frame.contacts?.available === true,
        drives: [],
        contacts: [],
        separations: [],
      };
      if (!compiled) return packet;
      const { bodies, power, joints } = compiled.configuration;
      for (const drive of power.motors) {
        const measured = frame.power?.motors.find((m) => m.node === drive.node),
          body = frame.physics[drive.body];
        if (!measured || !validMotion(body)) continue;
        const common = {
          emitterKey: String(drive.node),
          position: [...body.position],
          currentA: measured.current,
          currentScaleA: drive.currentLimit,
        };
        if (drive.coordinate === 'linear')
          packet.drives.push({
            ...common,
            coordinate: 'linear',
            speedMS: linearCoordinateSpeed(frame.physics, joints[drive.joint]),
            forceN: measured.torque,
          });
        else
          packet.drives.push({
            ...common,
            coordinate: 'rotation',
            speedRadS: drive.rotor < 0 ? null : motorShaftSpeed(frame, drive.node),
            torqueNm: measured.torque,
          });
      }
      if (!packet.available || !(packet.interval > 0)) return packet;
      const pairs = new Map(),
        readPoint = createCompletedPointReader();
      for (const row of frame.contacts.rows) {
        const a = bodies[row.a],
          b = bodies[row.b];
        if (a?.collision === false || b?.collision === false) continue;
        const key = [row.a, row.b].sort((x, y) => x - y).join(':');
        const impulse = finiteVector(row.normalImpulse) ? Math.hypot(...row.normalImpulse) : 0;
        if (!row.solved || !row.available || !Number.isFinite(row.distance) || impulse <= 0)
          continue;
        const motion = contactMotion(
          frame.physics[row.a],
          frame.physics[row.b],
          row,
          a,
          b,
          readPoint,
        );
        const known = !!a && !!b;
        const frictionEligibility = !known
          ? 'unknown'
          : a.friction === 0 || b.friction === 0
            ? 'zero'
            : a.friction > 0 && b.friction > 0
              ? 'positive'
              : 'unknown';
        const pair = pairs.get(key) ?? {
          pairKey: key,
          position: motion?.position ?? [0, 0, 0],
          normalImpulseNs: 0,
          normalLoadN: 0,
          slipSpeedMS: 0,
          rollingSpeedMS: !known || motion?.rollingSpeedMS == null ? null : 0,
          materialPair: [row.a, row.b]
            .map((i) => materials[compiled.mapping[i]?.materialHandle] ?? 'surface')
            .sort(),
          geometryClass: known && motion?.rollingSpeedMS != null ? 'curved' : 'unclassified',
          frictionEligibility,
          frictionResponseNs: 0,
          valid: !!motion,
          distance: row.distance,
          patches: [],
        };
        pair.valid &&= !!motion;
        pair.normalImpulseNs += impulse;
        pair.normalLoadN += impulse / packet.interval;
        pair.slipSpeedMS += (motion?.slipSpeedMS ?? 0) * impulse;
        if (pair.rollingSpeedMS !== null)
          pair.rollingSpeedMS += (motion?.rollingSpeedMS ?? 0) * impulse;
        if (row.frictionGroupSize > 0 && finiteVector(row.frictionImpulse))
          pair.frictionResponseNs =
            pair.frictionResponseNs === null
              ? null
              : pair.frictionResponseNs + Math.hypot(...row.frictionImpulse);
        else if (row.frictionGroupSize !== 0) pair.frictionResponseNs = null;
        pair.patches.push({ a: row.localPointA, b: row.localPointB, impulse });
        pairs.set(key, pair);
        witnesses.set(key, { row, tick: frame.tick });
      }
      for (const [key, witness] of witnesses) {
        if (pairs.has(key)) continue;
        if (frame.tick - witness.tick > 4) {
          witnesses.delete(key);
          continue;
        }
        const row = witness.row,
          A = readPoint(frame.physics[row.a], row.localPointA),
          B = readPoint(frame.physics[row.b], row.localPointB);
        if (
          A &&
          B &&
          dot(subtract(B.position, A.position), row.normal) > 0.00005 &&
          dot(subtract(B.velocity, A.velocity), row.normal) > 0
        )
          packet.separations.push(key);
      }
      packet.contacts = [...pairs.values()];
      for (const pair of packet.contacts) {
        pair.slipSpeedMS /= pair.normalImpulseNs;
        if (pair.rollingSpeedMS !== null) pair.rollingSpeedMS /= pair.normalImpulseNs;
      }
      return packet;
    },
    reset() {
      epoch = undefined;
      compiled = null;
      witnesses.clear();
      previousTick = -1;
    },
  };
}
