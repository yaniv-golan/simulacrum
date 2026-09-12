import { rotateVector } from './transforms.mjs';
import { immutableCopy } from './observation.mjs';
/** Independent delivery-fixture measurement; none of these values reaches the controller. */
export function measureDelivery(attempt, spec) {
  const row = attempt.samples.at(-1);
  if (!row || attempt.incompleteReason)
    return { available: false, reason: attempt.incompleteReason ?? 'No completed samples' };
  const bp = attempt.blueprint,
    body = (id) => row.physics[bp.parts.findIndex((p) => p.id === id)];
  const cargo = body(spec.roles.cargo),
    carrier = body(spec.roles.carrier),
    vehicle = body(spec.roles.vehicle),
    marker = body(spec.roles.marker),
    left = body(spec.roles.left),
    right = body(spec.roles.right);
  if (!cargo || !carrier || !vehicle || !marker || !left || !right || !vehicle.velocity)
    return { available: false, reason: 'Delivery fixture measurements unavailable' };
  const local = (point, reference) =>
    rotateVector(
      [
        -reference.rotation[0],
        -reference.rotation[1],
        -reference.rotation[2],
        reference.rotation[3],
      ],
      point.position.map((v, i) => v - reference.position[i]),
    );
  const packageOffset = local(cargo, carrier),
    bayOffset = local(vehicle, marker),
    speed = Math.hypot(...vehicle.velocity);
  const packageRetained =
    Math.abs(packageOffset[0]) <= 0.08 &&
    Math.abs(packageOffset[2]) <= 0.04 &&
    Math.abs(packageOffset[1] - 0.065) <= 0.02;
  const packageBayOffset = local(cargo, marker),
    leftOffset = local(left, marker),
    rightOffset = local(right, marker);
  const packageInBay =
    packageBayOffset[0] >= Math.min(leftOffset[0], rightOffset[0]) + 0.04 &&
    packageBayOffset[0] <= Math.max(leftOffset[0], rightOffset[0]) - 0.04 &&
    packageBayOffset[2] >= Math.max(leftOffset[2], rightOffset[2]) - 0.18 &&
    packageBayOffset[2] <= Math.min(leftOffset[2], rightOffset[2]) + 0.18 &&
    packageBayOffset[2] < -0.04;
  const upright = rotateVector(vehicle.rotation, [0, 1, 0])[1] > 0.9;
  const stoppedInBay =
    packageInBay && upright && Math.abs(bayOffset[1] - 0.08) < 0.04 && speed < 0.1;
  return {
    available: true,
    packageRetained,
    packageInBay,
    stoppedInBay,
    speed,
    markerDistance: Math.hypot(...bayOffset),
    stoppingDistance: speed < 0.1 ? Math.hypot(...bayOffset) : null,
    bayContactTicks: attempt.bayContactsAvailable === true ? attempt.bayContactTicks : null,
    bayContactImpulseNs: attempt.bayContactsAvailable === true ? attempt.bayContactImpulseNs : null,
    seconds: row.tick / 120,
    packageOffset,
    bayOffset,
    delivered: packageRetained && stoppedInBay,
  };
}

/** Explicit experiment binding; this evaluator never supplies controller observations. */
export function createDeliveryEvaluator(input) {
  const spec = immutableCopy(input);
  if (
    spec.version !== 1 ||
    spec.kind !== 'delivery' ||
    !spec.roles ||
    Object.keys(spec.roles).sort().join() !== 'cargo,carrier,left,marker,right,vehicle' ||
    !Object.values(spec.roles).every((x) => typeof x === 'string' && x.length <= 80) ||
    (spec.obstacles !== undefined &&
      (!Array.isArray(spec.obstacles) ||
        spec.obstacles.length > 32 ||
        !spec.obstacles.every((id) => typeof id === 'string' && id.length <= 80)))
  )
    throw Error('Invalid delivery evaluation binding');
  return (attempt, frame) => {
    const previous =
      attempt.evaluation?.spec && JSON.stringify(attempt.evaluation.spec) === JSON.stringify(spec)
        ? attempt.evaluation
        : null;
    const bay = new Set(
      [spec.roles.marker, spec.roles.left, spec.roles.right, ...(spec.obstacles ?? [])]
        .map((id) => attempt.blueprint.parts.findIndex((p) => p.id === id))
        .filter((i) => i >= 0),
    );
    const contacts = frame.contacts.rows.filter(
      (r) =>
        r.a >= 0 &&
        r.b >= 0 &&
        r.a < attempt.blueprint.parts.length &&
        r.b < attempt.blueprint.parts.length &&
        bay.has(r.a) !== bay.has(r.b),
    );
    const fresh = (previous?.sampleTick ?? -1) < frame.tick;
    const ticks =
      (previous?.contactTicks ?? 0) + (fresh && contacts.some((r) => r.distance <= 0) ? 1 : 0);
    const impulse =
      (previous?.contactImpulseNs ?? 0) +
      (fresh
        ? contacts.reduce(
            (sum, r) => sum + (r.normalImpulse ? Math.hypot(...r.normalImpulse) : 0),
            0,
          )
        : 0);
    const available = (previous?.contactsAvailable ?? true) && frame.contacts.available;
    const outcome = measureDelivery(
      {
        ...attempt,
        samples: [{ tick: frame.tick, physics: frame.physics }],
        bayContactTicks: ticks,
        bayContactImpulseNs: impulse,
        bayContactsAvailable: available,
      },
      spec,
    );
    return immutableCopy({
      spec,
      measurement: {
        tick: frame.tick,
        physics: frame.physics.map((b) => ({
          position: b.position,
          rotation: b.rotation,
          velocity: b.velocity,
        })),
      },
      sampleTick: frame.tick,
      contactTicks: ticks,
      contactImpulseNs: impulse,
      contactsAvailable: available,
      outcome,
    });
  };
}

/** Recompute physical outcome from its saved completed measurement; accumulated contacts are recorded evidence. */
export function admitAttemptEvaluation(attempt) {
  const e = attempt.evaluation;
  if (e === null || e === undefined) return;
  createDeliveryEvaluator(e.spec);
  if (
    Object.keys(e).sort().join() !==
      'contactImpulseNs,contactTicks,contactsAvailable,measurement,outcome,sampleTick,spec' ||
    !Number.isSafeInteger(e.sampleTick) ||
    e.sampleTick < 0 ||
    !Number.isSafeInteger(e.contactTicks) ||
    e.contactTicks < 0 ||
    e.contactTicks > e.sampleTick ||
    !Number.isFinite(e.contactImpulseNs) ||
    e.contactImpulseNs < 0 ||
    typeof e.contactsAvailable !== 'boolean' ||
    !e.measurement ||
    e.measurement.tick !== e.sampleTick ||
    !Array.isArray(e.measurement.physics) ||
    e.measurement.physics.length > 8192 ||
    !e.measurement.physics.every(
      (b) =>
        b &&
        [
          ['position', 3],
          ['rotation', 4],
          ['velocity', 3],
        ].every(
          ([key, size]) =>
            Array.isArray(b[key]) && b[key].length === size && b[key].every(Number.isFinite),
        ),
    )
  )
    throw Error('Invalid saved evaluation');
  const expected = measureDelivery(
    {
      ...attempt,
      incompleteReason: null,
      samples: [e.measurement],
      bayContactsAvailable: e.contactsAvailable,
      bayContactTicks: e.contactTicks,
      bayContactImpulseNs: e.contactImpulseNs,
    },
    e.spec,
  );
  if (JSON.stringify(expected) !== JSON.stringify(e.outcome))
    throw Error('Saved outcome does not match its measurement');
}
