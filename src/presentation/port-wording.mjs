export function portLabel(part, port) {
  if (port.kind === 'power') return 'Power';
  if (port.kind === 'signal')
    return port.direction === 'input' ? 'Control input' : 'Control output';
  if (port.kind === 'spring') return 'Slide · spring';
  if (port.kind === 'fixed')
    return port.id === 'mount' ? 'Mount' : `Mount · ${port.id.replace(/([A-Z])/g, ' $1')}`;
  if (part.type === 'gripWheel') return 'Wheel axle';
  if (part.type === 'poweredMotor') return 'Drive shaft';
  if (part.type === 'poweredHinge') return 'Steering output';
  if (part.type === 'wheelHub') return port.id === 'steering' ? 'Steering input' : 'Wheel axle';
  return port.id === 'shaft' ? 'Axle' : `Axle · ${port.id}`;
}
export function portPurpose(part, port) {
  if (port.kind === 'spring')
    return 'Attaches the carriage to its guide. Slides along this axis; does not swivel. Disconnecting removes both the guide constraint and spring force.';
  if (port.kind === 'fixed')
    return (
      'Bolts two parts together. They cannot move or turn relative to each other.' +
      (part.type === 'gripWheel'
        ? ' Bolting this wheel to the chassis or motor housing stops it spinning independently.'
        : '')
    );
  if (port.kind === 'power')
    return 'Carries electrical power. This wire does not hold parts together. More than one wire can share this port.';
  if (port.kind === 'signal')
    return (
      'Carries control commands. This wire does not hold parts together.' +
      (part.type === 'poweredMotor'
        ? ' Optional: without a signal, the motor uses its Drive setting.'
        : '')
    );
  if (part.type === 'poweredHinge' && port.kind === 'shaft')
    return 'Turns the attached hub using motor torque. Connect the hub steering input here.';
  if (part.type === 'wheelHub' && port.kind === 'shaft')
    return port.id === 'steering'
      ? 'Attach to a powered hinge. The hub follows its steering angle.'
      : 'Attach a wheel here. It spins freely while the hub steers.';
  if (part.type === 'gripWheel')
    return 'Connect to a motor or bearing to attach a turning wheel. This connection holds the wheel too; no separate fixed mount is needed.';
  if (part.type === 'poweredMotor')
    return 'Attaches a wheel or axle and drives its rotation relative to the motor housing. Mount the motor housing separately.';
  return 'Connects an axle. A bearing lets the attached axle turn relative to its housing.';
}
