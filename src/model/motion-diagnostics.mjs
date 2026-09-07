import { motorShaftSpeed } from './motor-shaft-speed.mjs';
export { motorShaftSpeed } from './motor-shaft-speed.mjs';
import { CATALOG } from './catalog.mjs';
import { rotateVector } from './transforms.mjs';
/** Explanations derived only from the authored graph and completed telemetry. */
function connected(blueprint, start, kind) {
  const seen = new Set([start]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of blueprint.connections)
      if (edge.kind === kind && (seen.has(edge.a.part) || seen.has(edge.b.part)))
        for (const end of [edge.a, edge.b])
          if (!seen.has(end.part)) {
            seen.add(end.part);
            changed = true;
          }
  }
  return seen;
}
export function diagnoseMotion(frame) {
  const bp = frame.metadata.blueprint,
    issues = [],
    live = frame.metadata.mode !== 'build';
  const rejected = new Set(
    (frame.metadata.connections ?? []).filter((c) => c.reasonCode !== 'OK').map((c) => c.id),
  );
  const admitted = { ...bp, connections: bp.connections.filter((c) => !rejected.has(c.id)) };
  const add = (code, part, port, title, action, evidence) => {
    if (
      !issues.some(
        (issue) =>
          issue.code === code &&
          issue.partId === part.id &&
          issue.port === port &&
          issue.title === title,
      )
    )
      issues.push({ code, partId: part.id, port, title, action, evidence });
  };
  for (const edge of bp.connections.filter((c) => c.kind === 'fixed' && rejected.has(c.id))) {
    const part = bp.parts.find((p) => p.id === edge.a.part),
      other = bp.parts.find((p) => p.id === edge.b.part);
    add(
      'MOUNT_ALIGNMENT',
      part,
      edge.a.port,
      `${part.name} and ${other.name} are not attached by this mount`,
      'Disconnect and reconnect this mount to align its endpoints.',
      'The compiler rejected this mount; it does not hold these parts together.',
    );
  }
  for (const [node, part] of bp.parts.entries()) {
    if (part.type !== 'poweredMotor') continue;
    const shaft = bp.connections.find(
      (c) => c.kind === 'shaft' && (c.a.part === part.id || c.b.part === part.id),
    );
    const powerGroup = connected(bp, part.id, 'power'),
      cells = bp.parts.filter((p) => p.type === 'powerCell' && powerGroup.has(p.id));
    if (!shaft)
      add(
        'MISSING_AXLE',
        part,
        'shaft',
        `${part.name} has no driven axle`,
        'Connect its Drive shaft to a wheel or axle.',
        'No shaft connection is present.',
      );
    else {
      const otherId = shaft.a.part === part.id ? shaft.b.part : shaft.a.part,
        other = bp.parts.find((p) => p.id === otherId);
      if (connected(admitted, part.id, 'fixed').has(otherId))
        add(
          'RIGIDLY_LOCKED',
          other,
          'mount',
          `${other.name} is bolted to the motor housing`,
          'Disconnect the rigid mount path. Keep the axle connection so it can turn.',
          'A path of rigid mounts joins both sides of the rotating joint.',
        );
      const alignment = frame.metadata.connections?.find((c) => c.id === shaft.id);
      if (alignment && alignment.reasonCode !== 'OK')
        add(
          'AXLE_ALIGNMENT',
          part,
          'shaft',
          `${part.name} needs its axle checked`,
          'Disconnect and reconnect the shaft to align it.',
          `Connection reports ${alignment.reasonCode}.`,
        );
    }
    if (!cells.length)
      add(
        'MISSING_POWER',
        part,
        'power',
        `${part.name} has no power connection`,
        'Wire a Power Cell to its Power port. A mount does not carry electricity.',
        'No cell is connected through power wires.',
      );
    for (const cell of cells) {
      const reading = frame.power?.cells?.find((c) => bp.parts[c.node]?.id === cell.id);
      if (reading?.energyJ <= 0)
        add(
          'EMPTY_CELL',
          cell,
          'power',
          `${cell.name} is empty`,
          'Return to Build to recharge. Increase capacity if the next run needs to last longer.',
          `${reading.energyJ} J remaining.`,
        );
    }
    const signalGroup = connected(bp, part.id, 'signal'),
      source = frame.power?.sources?.find((s) => signalGroup.has(bp.parts[s.node]?.id));
    const signalEdge = bp.connections.some(
      (c) => c.kind === 'signal' && (c.a.part === part.id || c.b.part === part.id),
    );
    const duty = source?.duty ?? (!signalEdge ? part.parameters.defaultDuty : undefined);
    if (duty === 0) {
      const owner = source ? bp.parts[source.node] : part;
      add(
        'COMMAND_OFF',
        owner,
        source ? 'signal' : null,
        `${owner.name} has zero drive (coasting)`,
        source
          ? 'Use this receiver’s keyboard controls to apply drive. Zero output lets the motor coast; it is not a brake.'
          : 'Set Drive setting above or below zero.',
        source ? 'Connected control source reports a zero command.' : 'Drive setting is 0.',
      );
    }
    const motor = frame.power?.motors?.find((m) => m.node === node),
      speed = motorShaftSpeed(frame, node);
    if (
      live &&
      frame.tick >= 120 &&
      motor?.reasonCode === 'OK' &&
      speed !== null &&
      Math.abs(speed) < 0.5 &&
      Math.abs(motor.current) > 0.01 &&
      !issues.some(
        (i) =>
          i.code === 'RIGIDLY_LOCKED' && shaft && [shaft.a.part, shaft.b.part].includes(i.partId),
      )
    )
      add(
        'SLOW_UNDER_POWER',
        part,
        'shaft',
        `${part.name} is powered but barely turning`,
        'Check whether the wheel is trapped or touching the housing, then inspect the load and motor rating.',
        `${speed.toFixed(2)} rad/s relative shaft speed, ${motor.current.toFixed(2)} A. These readings alone do not identify the cause.`,
      );
  }
  const stalled = bp.parts.filter((p) =>
    issues.some((issue) => issue.code === 'SLOW_UNDER_POWER' && issue.partId === p.id),
  );
  const peer = (part, kind) => {
    const edge = admitted.connections.find(
      (c) => c.kind === kind && [c.a.part, c.b.part].includes(part.id),
    );
    return edge
      ? bp.parts.find((p) => p.id === (edge.a.part === part.id ? edge.b.part : edge.a.part))
      : null;
  };
  for (let i = 0; i < stalled.length; i++)
    for (let j = i + 1; j < stalled.length; j++) {
      const a = stalled[i],
        b = stalled[j],
        owner = peer(a, 'signal');
      if (
        !owner ||
        owner.type !== 'commandReceiver' ||
        peer(b, 'signal')?.id !== owner.id ||
        peer(a, 'shaft')?.type !== 'gripWheel' ||
        peer(b, 'shaft')?.type !== 'gripWheel' ||
        !connected(admitted, a.id, 'fixed').has(b.id)
      )
        continue;
      const axis = (part) =>
        rotateVector(frame.physics[bp.parts.indexOf(part)].rotation, [
          part.parameters.inputPolarity ?? 1,
          0,
          0,
        ]);
      const first = axis(a),
        second = axis(b),
        dot = first.reduce((sum, value, k) => sum + value * second[k], 0);
      if (dot < -0.99)
        add(
          'OPPOSED_DRIVES',
          b,
          'signal',
          `${a.name} and ${b.name} have opposing drive directions`,
          'If these wheels should roll in the same direction, enable Reverse direction on one motor. Otherwise check clearance and load.',
          'Both stalled wheel motors share a receiver and rigid assembly; their command-adjusted shaft axes oppose. This is a possible cause, not proof of the fault.',
        );
    }
  return issues;
}
