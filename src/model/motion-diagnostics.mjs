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
export function motorShaftSpeed(frame, node) {
  const bp = frame.metadata.blueprint,
    part = bp.parts[node],
    edge = bp.connections.find(
      (c) => c.kind === 'shaft' && (c.a.part === part?.id || c.b.part === part?.id),
    );
  if (!edge) return null;
  const other = edge.a.part === part.id ? edge.b.part : edge.a.part,
    rotor = frame.physics[bp.parts.findIndex((p) => p.id === other)],
    housing = frame.physics[node];
  if (!rotor || !housing) return null;
  const [x, y, z, w] = housing.rotation,
    axis = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
  return axis.reduce(
    (sum, value, i) => sum + (rotor.angularVelocity[i] - housing.angularVelocity[i]) * value,
    0,
  );
}
export function diagnoseMotion(frame) {
  const bp = frame.metadata.blueprint,
    issues = [],
    live = frame.metadata.mode !== 'build';
  const rejected = new Set(
    (frame.metadata.connections ?? []).filter((c) => c.reasonCode !== 'OK').map((c) => c.id),
  );
  const admitted = { ...bp, connections: bp.connections.filter((c) => !rejected.has(c.id)) };
  const add = (code, part, port, title, action, evidence) =>
    issues.push({ code, partId: part.id, port, title, action, evidence });
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
        `${owner.name} is commanding Stop`,
        source
          ? 'Choose Forward or Reverse on this receiver. It controls the motor instead of the motor’s Drive setting.'
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
  return issues;
}
