// @ts-check
import { DT } from '../../model/tick.mjs';
/** @typedef {{x:number,y:number,z:number}} XYZ
 * @typedef {{handle:number}} Collider
 * @typedef {{normal():XYZ,numContacts():number,numSolverContacts():number,
 * contactAppliedNormalImpulse(i:number):number|undefined,
 * contactAppliedFrictionImpulse(i:number):XYZ|undefined,
 * contactAppliedTwistImpulse(i:number):XYZ|undefined,
 * contactAppliedFrictionGroupSize(i:number):number,
 * localContactPoint1(i:number):XYZ,localContactPoint2(i:number):XYZ,contactDist(i:number):number}} Manifold
 * @typedef {{integrationParameters:{maxCcdSubsteps:number},
 * getRigidBody(handle:number):{collider(i:number):Collider},getCollider(handle:number):Collider,
 * contactPairsWith(c:Collider,fn:(other:Collider)=>void):void,
 * contactPair(a:Collider,b:Collider,fn:(m:Manifold,flipped:boolean)=>void):void}} ContactReader
 */
/** @param {number} value */
function canonicalZero(value) {
  return value === 0 ? 0 : value;
}
/** @param {XYZ} value @returns {[number,number,number]} */
function array(value) {
  // JSON transports normalize negative zero; completed numeric samples must agree.
  return vector(value.x, value.y, value.z);
}
/** @param {number} x @param {number} y @param {number} z @returns {[number,number,number]} */
function vector(x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
    throw new Error('non-finite contact diagnostic');
  return [canonicalZero(x), canonicalZero(y), canonicalZero(z)];
}
/** @param {readonly number[]} value @param {number} factor @returns {[number,number,number]} */
function scale(value, factor) {
  return vector(value[0] * factor, value[1] * factor, value[2] * factor);
}
/** No live query objects escape this copied, validated completed sample.
 * @param {ContactReader} candidate @param {number[]} mapping
 * @returns {Omit<import('../../model/boundaries.js').ContactSample,'sampleTick'>} */
export function readContacts(candidate, mapping) {
  const indices = new Map(
    mapping.map((handle, i) => [candidate.getRigidBody(handle).collider(0).handle, i]),
  );
  /** @type {import('../../model/boundaries.js').ContactObservation[]} */
  const rows = [];
  let available = candidate.integrationParameters.maxCcdSubsteps === 1;
  let failed = false;
  /** @type {unknown} */
  let failure;
  /** Capture even falsy throws; callbacks must return normally for native cleanup.
   * @param {unknown} error */
  const reject = (error) => {
    if (!failed) {
      failed = true;
      failure = error;
    }
  };
  for (const [handle, a] of indices) {
    const collider = candidate.getCollider(handle);
    candidate.contactPairsWith(collider, (other) => {
      if (failed) return;
      try {
        const b = indices.get(other.handle);
        if (b === undefined) throw new Error('unmapped contact collider');
        if (a >= b) return;
        candidate.contactPair(collider, other, (manifold, flipped) => {
          if (failed) return;
          try {
            const count = manifold.numContacts();
            if (!Number.isInteger(count) || count < 0) throw new Error('invalid contact count');
            if (count > 4096 - rows.length)
              throw new Error('contact observation capacity exceeded');
            // An empty manifold has no contact normal. Its solver availability still matters.
            if (count === 0) {
              available &&= manifold.numSolverContacts() === 0;
              return;
            }
            const direction = array(manifold.normal());
            if (Math.abs(Math.hypot(...direction) - 1) > 1e-5)
              throw new Error('invalid contact normal');
            const normal = scale(direction, flipped ? -1 : 1);
            const impulses = [];
            let solvedCount = 0;
            for (let point = 0; point < count; point++) {
              const impulse = manifold.contactAppliedNormalImpulse(point);
              impulses.push(impulse);
              if (Number.isFinite(impulse)) solvedCount++;
            }
            // Geometric manifolds may contain unselected points. A manifold with
            // solver contacts but no current writeback is unavailable, never zero support.
            const processed = solvedCount > 0 || manifold.numSolverContacts() === 0;
            available &&= processed;
            let groupedPoints = 0;
            /** @param {XYZ | undefined} value */
            const onB = (value) => {
              if (!value) return null;
              const result = array(value);
              if (!flipped) for (let i = 0; i < 3; i++) result[i] = canonicalZero(-result[i]);
              return result;
            };
            for (let point = 0; point < count; point++) {
              const impulse = impulses[point],
                solved = impulse !== undefined;
              const friction = manifold.contactAppliedFrictionImpulse(point);
              const twist = manifold.contactAppliedTwistImpulse(point);
              const groupSize = canonicalZero(manifold.contactAppliedFrictionGroupSize(point));
              groupedPoints += groupSize;
              if (
                (solved && (!Number.isFinite(impulse) || impulse < 0)) ||
                !!friction !== !!twist ||
                !!friction !== groupSize > 0 ||
                (friction && !solved) ||
                !Number.isInteger(groupSize) ||
                groupSize > 4
              )
                throw new Error('invalid contact diagnostic');
              const distance = manifold.contactDist(point);
              if (!Number.isFinite(distance)) throw new Error('non-finite contact diagnostic');
              rows.push({
                a,
                b,
                localPointA: array(
                  flipped ? manifold.localContactPoint2(point) : manifold.localContactPoint1(point),
                ),
                localPointB: array(
                  flipped ? manifold.localContactPoint1(point) : manifold.localContactPoint2(point),
                ),
                distance: canonicalZero(distance),
                normal,
                normalImpulse: solved ? scale(normal, impulse) : null,
                frictionImpulse: onB(friction),
                pureTwistImpulse: onB(twist),
                frictionGroupSize: groupSize,
                solved,
                available: processed,
              });
            }
            if (groupedPoints !== solvedCount)
              throw new Error('incomplete contact friction groups');
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
    if (failed) throw failure;
  }
  const keys = new Map();
  /** @param {import('../../model/boundaries.js').ContactObservation} row */
  const key = (row) => {
    if (!keys.has(row)) keys.set(row, JSON.stringify(row));
    return keys.get(row);
  };
  rows.sort((a, b) => {
    const pair = a.a - b.a || a.b - b.b;
    if (pair) return pair;
    const ak = key(a),
      bk = key(b);
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  return { intervalSeconds: DT, available, rows };
}
